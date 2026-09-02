import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  GITHUB_FAILURES,
  admitPublicDnsResults,
  acquireGithubCredential,
  admitGithubObservation,
  buildGithubRoutes,
  createClosedGithubHttpsAdapter,
  createFixtureGithubEngine,
  parseHostileJson,
  validateGithubStartup,
} from "./github.mjs";

const SHA = "1".repeat(40), BASE = "2".repeat(40), SNAPSHOT = "3".repeat(64);
const config = Object.freeze({
  provider: "github-rest-v1", apiOrigin: "https://api.github.com", owner: "nousresearch", repository: "hermes-agent", pullNumber: 7,
  apiVersion: "2022-11-28", credentialFd: 9, permissionAttestation: "READ_ONLY_DECLARED",
  deadlines: { connectMs: 1000, headerMs: 2000, bodyMs: 3000, overallMs: 5000 },
  limits: { perPage: 100, maxPages: 10, maxRows: 1000, bodyBytes: 1048576, aggregateBytes: 8388608 },
});
const pr = (patch={}) => ({ id: 44, node_id: "PR_node", number: 7, html_url: "https://github.com/nousresearch/hermes-agent/pull/7", state: "open", draft: false,
  base: { sha: BASE, repo: { id: 11, node_id: "R_base", name: "hermes-agent", owner: { login: "nousresearch" } } },
  head: { sha: SHA, repo: { id: 11, node_id: "R_base", name: "hermes-agent", owner: { login: "nousresearch" } } }, ...patch });
const check = (id=10, patch={}) => ({ id, node_id:`CR_${id}`, name:"build", head_sha:SHA, status:"completed", conclusion:"success", started_at:"2026-09-01T00:00:00Z", completed_at:"2026-09-01T00:01:00Z", details_url:"https://github.com/nousresearch/hermes-agent/actions/runs/1", external_id:null, check_suite:{id:20}, app:{id:30,slug:"actions"}, ...patch });
const status = (id=50, patch={}) => ({ id, state:"success", context:"ci/build", sha:SHA, target_url:"https://example.test/build", description:"ok", created_at:"2026-09-01T00:00:00Z", updated_at:"2026-09-01T00:01:00Z", creator:{id:60,login:"bot"}, ...patch });
const response = (body, {etag='"v1"', link, requestId="req", date="Tue, 01 Sep 2026 00:00:00 GMT", statusCode=200}={}) => ({ status:statusCode, headers:{"content-type":"application/json; charset=utf-8",...(etag?{etag}:{}),...(link?{link}:{}),"x-github-request-id":requestId,date,"x-ratelimit-remaining":"99","x-ratelimit-used":"1","x-ratelimit-reset":"1788220800"}, body:statusCode===304?Buffer.alloc(0):Buffer.from(JSON.stringify(body)) });
const local = Object.freeze({ snapshotDigest:SNAPSHOT, parentCommit:SHA, baseCommit:BASE, trackedState:"DIRTY" });
const validCoordinate=()=>({method:"GET",origin:config.apiOrigin,path:"/repos/nousresearch/hermes-agent/pulls/7",headers:{Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"workhub-agent-change-assurance/4"}});

function fixtureQueue(overrides={}) {
  const routes=buildGithubRoutes(config,SHA); const queue=[
    response(pr()), response({total_count:2,check_runs:[check(11),check(10,{app:{id:31,slug:"other"}})]}), response(null,{statusCode:304}),
    response([status(51),status(50,{creator:{id:61,login:"other"}})]), response(null,{statusCode:304}), response(pr(),{requestId:"volatile-2",date:"Tue, 01 Sep 2026 00:00:01 GMT"}),
  ];
  return { routes, queue, ...overrides };
}

test("startup modes and exact coordinates are closed",()=>{
  assert.deepEqual(validateGithubStartup(undefined),{mode:"DISABLED_PROVIDER_FREE",externalStatus:"EXTERNAL_CONNECTOR_UNAVAILABLE"});
  assert.throws(()=>validateGithubStartup({...config,apiOrigin:"https://evil.test"}),/GITHUB_CONFIG_REFUSED/);
  assert.throws(()=>validateGithubStartup({...config,owner:"x/y"}),/GITHUB_CONFIG_REFUSED/);
  assert.throws(()=>validateGithubStartup({...config,extra:true}),/GITHUB_CONFIG_REFUSED/);
  assert.equal(validateGithubStartup(config).mode,"LIVE_ENABLED");
  const routes=buildGithubRoutes(config,SHA); assert.deepEqual(routes,{pr:"/repos/nousresearch/hermes-agent/pulls/7",checks:`/repos/nousresearch/hermes-agent/commits/${SHA}/check-runs?filter=all&per_page=100&page=1`,statuses:`/repos/nousresearch/hermes-agent/commits/${SHA}/statuses?per_page=100&page=1`});
});

test("DNS admission pins only public results and refuses private, loopback, link-local and multicast",()=>{
 assert.deepEqual(admitPublicDnsResults([{address:"140.82.114.5",family:4}]),{address:"140.82.114.5",family:4});
 for(const address of ["127.0.0.1","10.0.0.1","169.254.1.1","192.168.1.1","224.0.0.1","::1","fc00::1","fe80::1"])assert.throws(()=>admitPublicDnsResults([{address,family:address.includes(":")?6:4}]),/DNS_FAILURE/);
});

test("fake credential descriptor is read once, closed, bounded and never leaked",async()=>{
  const events=[]; const token=await acquireGithubCredential(config,{readFd:async fd=>{events.push(`read:${fd}`);return Buffer.from("token-canary\n")},closeFd:async fd=>events.push(`close:${fd}`)});
  assert.deepEqual(events,["read:9","close:9"]); assert.equal(token.toString(),"token-canary"); token.fill(0);
  for(const bytes of [Buffer.from(""),Buffer.from("a\nb\n"),Buffer.alloc(4097,97)]) await assert.rejects(()=>acquireGithubCredential(config,{readFd:async()=>bytes,closeFd:async()=>{}}),/AUTH_UNAVAILABLE/);
  const closeFailure=Buffer.from("close-canary\n");await assert.rejects(()=>acquireGithubCredential(config,{readFd:async()=>closeFailure,closeFd:async()=>{throw new Error("/Users/private/fd")}}),error=>error.code==="AUTH_UNAVAILABLE"&&error.message==="AUTH_UNAVAILABLE");assert.equal(closeFailure.every(byte=>byte===0),true);
  await assert.rejects(()=>acquireGithubCredential(config,{readFd:async()=>{throw new Error("/Users/private/fd")},closeFd:async()=>{}}),error=>error.code==="AUTH_UNAVAILABLE"&&error.message==="AUTH_UNAVAILABLE");
});

test("hostile raw JSON rejects duplicate keys, malformed UTF-8, prototype keys and trailing bytes",()=>{
  assert.deepEqual(parseHostileJson(Buffer.from('{"a":1}')),{a:1});
  for(const bytes of [Buffer.from('{"a":1,"a":2}'),Buffer.from('{"__proto__":{}}'),Buffer.from('{"a":1}x'),Buffer.from([0xc3,0x28])]) assert.throws(()=>parseHostileJson(bytes),/REMOTE_SCHEMA_REFUSED/);
});

test("fixture engine performs only frozen GET coordinates and derives immutable rows and four dimensions",async()=>{
  const fx=fixtureQueue(); const calls=[]; const engine=createFixtureGithubEngine(config,{request:async request=>{calls.push(request);return fx.queue.shift()},attemptId:()=>"attempt-1",now:(()=>{let n=0;return()=>`2026-09-01T00:00:0${n++}.000Z`})()});
  const value=await engine.observe({local});
  assert.equal(value.schema,"github-external-observation/v1"); assert.equal(value.subject,"PARENT_COMMIT_ONLY"); assert.equal(value.availability,"AVAILABLE"); assert.equal(value.lifecycle,"TERMINAL"); assert.equal(value.outcome,"ALL_SUCCESS");
  assert.deepEqual(value.checkRuns.map(x=>[x.appId,x.suiteId,x.name,x.runId]),[[30,20,"build",11],[31,20,"build",10]]);
  assert.deepEqual(value.statuses.map(x=>[x.context,x.creatorId,x.statusId]),[["ci/build",60,51],["ci/build",61,50]]);
  assert.equal(calls.every(x=>x.method==="GET"&&x.body===undefined&&x.origin==="https://api.github.com"),true); assert.equal(calls.length,6);
  assert.equal(JSON.stringify(value).includes("token-canary"),false); assert.equal(Object.isFrozen(value.checkRuns[0]),true);
  assert.equal((await admitGithubObservation(value,{local,config})).valid,true);
});

test("normalization covers all check conclusions and legacy states without truthiness",async()=>{
  const rows=[
    check(1,{status:"queued",conclusion:null,started_at:null,completed_at:null}), check(2,{status:"in_progress",conclusion:null,completed_at:null}),
    ...["success","failure","timed_out","cancelled","action_required","startup_failure","stale","neutral","skipped"].map((conclusion,index)=>check(10+index,{conclusion})),
  ];
  const statuses=["pending","success","failure","error"].map((state,index)=>status(70+index,{state,context:`c${index}`}));
  const fx=fixtureQueue({queue:[response(pr()),response({total_count:rows.length,check_runs:rows}),response(null,{statusCode:304}),response(statuses),response(null,{statusCode:304}),response(pr())]});
  const value=await createFixtureGithubEngine(config,{request:async()=>fx.queue.shift(),attemptId:()=>"a",now:()=>"2026-09-01T00:00:00.000Z"}).observe({local});
  assert.equal(value.aggregate.passed,2); assert.equal(value.aggregate.failed,8); assert.equal(value.aggregate.pending,3); assert.equal(value.lifecycle,"MIXED"); assert.equal(value.outcome,"HAS_FAILURE");
});

test("pagination is exact and volatile headers may change while stable movement refuses",async()=>{
  const next=`<https://api.github.com/repos/nousresearch/hermes-agent/commits/${SHA}/check-runs?filter=all&per_page=100&page=2>; rel="next", <https://api.github.com/repos/nousresearch/hermes-agent/commits/${SHA}/check-runs?filter=all&per_page=100&page=2>; rel="last"`;
  const page1=response({total_count:2,check_runs:[check(1)]},{etag:null,link:next}), page2=response({total_count:2,check_runs:[check(2)]},{etag:null});
  const queue=[response(pr()),page1,page2,page1,{...page2,headers:{...page2.headers,"x-github-request-id":"different"}},response([]),response([]),response(pr(),{requestId:"different"})];
  const value=await createFixtureGithubEngine(config,{request:async()=>queue.shift(),attemptId:()=>"a",now:()=>"2026-09-01T00:00:00.000Z"}).observe({local}); assert.equal(value.checkRuns.length,2);
  for(const badLink of [
    `<https://evil.test/x?page=2>; rel="next"`,
    `<https://api.github.com/repos/nousresearch/hermes-agent/commits/${SHA}/check-runs?filter=all&per_page=100&page=3>; rel="next"`,
    `<https://api.github.com/repos/nousresearch/hermes-agent/commits/${SHA}/check-runs?filter=all&per_page=100&page=2>; rel="next", <https://api.github.com/x>; rel="next"`,
  ]) { const q=[response(pr()),response({total_count:1,check_runs:[check()]},{link:badLink})]; await assert.rejects(()=>createFixtureGithubEngine(config,{request:async()=>q.shift(),attemptId:()=>"a",now:()=>"2026-09-01T00:00:00.000Z"}).observe({local}),error=>error.code==="PAGINATION_REFUSED"); }
  const moved=[response(pr()),response({total_count:1,check_runs:[check()]}),response({total_count:1,check_runs:[check(99)]})];
  await assert.rejects(()=>createFixtureGithubEngine(config,{request:async()=>moved.shift(),attemptId:()=>"a",now:()=>"2026-09-01T00:00:00.000Z"}).observe({local}),error=>error.code==="REMOTE_SUBJECT_MOVED");
});

test("movement, cancellation, response faults, duplicate identity, wrong subject and redaction use closed taxonomy",async()=>{
  assert.deepEqual(new Set(GITHUB_FAILURES).size,GITHUB_FAILURES.length);
  const matrices=[
    [[response(pr()),response({total_count:2,check_runs:[check(),check()]})],"REMOTE_SCHEMA_REFUSED"],
    [[response(pr()),response({total_count:1,check_runs:[check(1,{head_sha:BASE})]})],"REMOTE_SCHEMA_REFUSED"],

    [[{...response(pr()),status:500}],"REMOTE_SERVER_FAILURE"],
  ];
  for(const [queue,code] of matrices) await assert.rejects(()=>createFixtureGithubEngine(config,{request:async()=>queue.shift(),attemptId:()=>"token-canary",now:()=>"2026-09-01T00:00:00.000Z"}).observe({local}),error=>error.code===code&&!String(error.message).includes("token-canary"));
  const controller=new AbortController();controller.abort(); await assert.rejects(()=>createFixtureGithubEngine(config,{request:async()=>response(pr()),attemptId:()=>"a",now:()=>"2026-09-01T00:00:00.000Z"}).observe({local,signal:controller.signal}),error=>error.code==="CANCELLED");
  let localCalls=0; const fx=fixtureQueue(); await assert.rejects(()=>createFixtureGithubEngine(config,{request:async()=>fx.queue.shift(),attemptId:()=>"a",now:()=>"2026-09-01T00:00:00.000Z",revalidateLocal:async()=>{localCalls++;throw new Error("moved")}}).observe({local}),error=>error.code==="LOCAL_SOURCE_MOVED"); assert.equal(localCalls,1);
});

// Cancellation is only truthful if it discards the whole observation. This deterministic cut completes
// every provider read, parks the engine inside the final local revalidation, aborts, and only then
// releases: no observation, no trusted tuple and no admitted external evidence may survive the abort.
test("cancellation while the final local revalidation is paused discards the whole external observation",async()=>{
  const fx=fixtureQueue(),controller=new AbortController();let revalidations=0,entered,released;
  const atCut=new Promise(resolve=>{entered=resolve}),release=new Promise(resolve=>{released=resolve});
  const engine=createFixtureGithubEngine(config,{request:async()=>fx.queue.shift(),attemptId:()=>"a",now:()=>"2026-09-01T00:00:00.000Z",revalidateLocal:async()=>{revalidations++;entered();await release}});
  const pending=engine.observe({local,signal:controller.signal});
  await atCut; assert.equal(fx.queue.length,0,"the cut happens after every provider read and revalidation");
  controller.abort(); released();
  const settled=await pending.then(value=>({value}),error=>({error}));
  assert.equal(settled.value,undefined,"a cancelled cut settles no observation");
  assert.equal(settled.error?.code,"CANCELLED"); assert.equal(settled.error?.message,"CANCELLED"); assert.equal(revalidations,1);
  assert.throws(()=>engine.trustedTuple(settled.value),error=>error.code==="REMOTE_SCHEMA_REFUSED","no trusted tuple survives a cancelled cut");
  const ax=fixtureQueue(),aborting=new AbortController();
  await assert.rejects(()=>createFixtureGithubEngine(config,{request:async()=>ax.queue.shift(),attemptId:()=>"a",now:()=>"2026-09-01T00:00:00.000Z",revalidateLocal:async()=>{aborting.abort();throw new Error("moved")}}).observe({local,signal:aborting.signal}),error=>error.code==="CANCELLED","an aborted revalidation failure is cancellation, not local movement");
});

test("admission rejects fully re-digested authority, candidate-binding and requiredness forgeries",async()=>{
  const fx=fixtureQueue();const engine=createFixtureGithubEngine(config,{request:async()=>fx.queue.shift(),attemptId:()=>"a",now:()=>"2026-09-01T00:00:00.000Z"});const value=await engine.observe({local});
  for(const mutate of [x=>x.authority="MERGE",x=>x.subject="CURRENT_REMOTE_HEAD",x=>x.checkRuns[0].required=true,x=>x.checkRuns[0].independent=true,x=>x.repositoryId=999]) { const copy=structuredClone(value);mutate(copy);copy.observationDigest=engine.digest(copy);assert.equal((await admitGithubObservation(copy,{local,config})).valid,false); }
});

test("dirty observations derive the full remote base/head matrix and can never become clean-commit exact",async()=>{
  const otherHead="4".repeat(40),otherBase="5".repeat(40);
  for(const [head,base,subject] of [[SHA,BASE,"PARENT_COMMIT_ONLY"],[SHA,otherBase,"PARENT_COMMIT_ONLY"],[otherHead,BASE,"REMOTE_HEAD_DIFFERS"],[otherHead,otherBase,"REMOTE_HEAD_DIFFERS"]]){
    const remote=pr({head:{...pr().head,sha:head},base:{...pr().base,sha:base}});
    const queue=[response(remote),response({total_count:1,check_runs:[check(1,{head_sha:head})]}),response(null,{statusCode:304}),response([status(2,{sha:head})]),response(null,{statusCode:304}),response(remote)];
    const engine=createFixtureGithubEngine(config,{request:async()=>queue.shift(),attemptId:()=>"matrix",now:()=>"2026-09-01T00:00:00.000Z"});
    const value=await engine.observe({local});
    assert.equal(value.subject,subject,`${head===SHA?"same":"different"} head / ${base===BASE?"same":"different"} base`);
    assert.equal((await admitGithubObservation(value,{local,config})).valid,true);
    const forged=structuredClone(value);forged.subject="CLEAN_COMMIT_EXACT";forged.observationDigest=engine.digest(forged);
    assert.equal((await admitGithubObservation(forged,{local,config})).valid,false);
  }
});

function timedRequest(kind){
  return (_options,respond)=>{const req=new EventEmitter(),socket=new EventEmitter();req.end=()=>queueMicrotask(()=>{req.emit("socket",socket);if(kind!=="connect")queueMicrotask(()=>{socket.emit("secureConnect");if(kind==="header"||kind==="overall")return;const res=new EventEmitter();res.statusCode=200;res.headers={"content-type":"application/json"};respond(res);if(kind==="success")queueMicrotask(()=>{res.emit("data",Buffer.from("{}"));res.emit("end")})})});req.destroy=error=>queueMicrotask(()=>req.emit("error",error));return req;};
}

test("closed transport has distinct connect/header/body/overall monotonic deadlines and cancellation wins races",async()=>{
  const tiny={...config,deadlines:{connectMs:15,headerMs:15,bodyMs:15,overallMs:80}};
  for(const [kind,code] of [["connect","CONNECT_TIMEOUT"],["header","RESPONSE_TIMEOUT"],["body","RESPONSE_TIMEOUT"]]){
    const adapter=createClosedGithubHttpsAdapter(tiny,Buffer.from("secret-canary"),{lookup:async()=>[{address:"140.82.114.5",family:4}],requestImpl:timedRequest(kind)});
    await assert.rejects(()=>adapter.request(validCoordinate()),error=>error.code===code&&error.message===code&&!JSON.stringify(error).includes("secret-canary"));adapter.destroy();
  }
  const overall={...config,deadlines:{connectMs:50,headerMs:50,bodyMs:50,overallMs:10}};
  const adapter=createClosedGithubHttpsAdapter(overall,Buffer.from("secret-canary"),{lookup:async()=>[{address:"140.82.114.5",family:4}],requestImpl:timedRequest("overall")});
  await assert.rejects(()=>adapter.request(validCoordinate()),error=>error.code==="RESPONSE_TIMEOUT");adapter.destroy();
  const controller=new AbortController(),cancelled=createClosedGithubHttpsAdapter(config,Buffer.from("secret-canary"),{lookup:async()=>[{address:"140.82.114.5",family:4}],requestImpl:timedRequest("header")});
  const pending=cancelled.request(validCoordinate(),{signal:controller.signal});controller.abort();await assert.rejects(()=>pending,error=>error.code==="CANCELLED");cancelled.destroy();
});

test("DNS admission refuses representative non-global IPv4 and IPv6 special-use families",()=>{
 for(const address of ["100.64.0.1","192.0.0.1","192.0.2.1","192.31.196.1","192.52.193.1","192.175.48.1","198.18.0.1","198.51.100.1","203.0.113.1","240.0.0.1","::ffff:140.82.114.5","64:ff9b::1","100::1","2001:2::1","2001:db8::1","2002::1","3ffe::1"])
  assert.throws(()=>admitPublicDnsResults([{address,family:address.includes(":")?6:4}]),/DNS_FAILURE/,address);
});

test("terminal check pagination count equals stable total on first and revalidation passes",async()=>{
 for(const [name,queue] of [
  ["undercount",[response(pr()),response({total_count:2,check_runs:[check(1)]})]],
  ["overcount",[response(pr()),response({total_count:1,check_runs:[check(1),check(2)]})]],
  ["second-pass undercount",[response(pr()),response({total_count:2,check_runs:[check(1),check(2)]},{etag:null}),response({total_count:2,check_runs:[check(1)]},{etag:null})]],
 ]) await assert.rejects(()=>createFixtureGithubEngine(config,{request:async()=>queue.shift(),attemptId:()=>"a",now:()=>"2026-09-01T00:00:00.000Z"}).observe({local}),error=>["PAGINATION_REFUSED","REMOTE_SUBJECT_MOVED"].includes(error.code),name);
});

test("admission rejects re-digested impossible row, metadata, coverage and ordering semantics",async()=>{
 const fx=fixtureQueue(),engine=createFixtureGithubEngine(config,{request:async()=>fx.queue.shift(),attemptId:()=>"a",now:()=>"2026-09-01T00:00:00.000Z"}),value=await engine.observe({local});
 const trusted=engine.trustedTuple(value);for(const mutate of [x=>{x.checkRuns[0].outcome="HAS_FAILURE"},x=>{x.checkRuns[0].unknown=true},x=>{x.checkRuns.reverse()},x=>{x.metadata.checkPages[0].unknown="x"},x=>{x.pageCounts.checks=99},x=>{x.coverage.implemented.reverse()},x=>{x.pull.head.repositoryId=999},x=>{x.pull.extra=true}]){const copy=structuredClone(value);mutate(copy);copy.observationDigest=engine.digest(copy);assert.equal(admitGithubObservation(copy,{local,config,trusted}).valid,false);}
});

const collectionPath=(kind,page,{head=SHA,owner="nousresearch",repository="hermes-agent"}={})=>`/repos/${owner}/${repository}/commits/${head}/${kind}?${kind==="check-runs"?"filter=all&":""}per_page=100&page=${page}`;
const PR_PATH="/repos/nousresearch/hermes-agent/pulls/7";
const FAMILIES=Object.freeze(["check-runs","statuses"]);
// Byte-exact scripted responder. `reply(path)` returns {status,contentType,headers,body}; a Buffer body is
// emitted verbatim so duplicate-key and malformed-UTF-8 PR bodies stay byte-exact on the wire.
function scriptedRequest(reply){
 return (options,respond)=>{const req=new EventEmitter(),socket=new EventEmitter();
  req.end=()=>queueMicrotask(()=>{req.emit("socket",socket);queueMicrotask(()=>{socket.emit("secureConnect");
   const spec=reply(options.path)??{},res=new EventEmitter();res.statusCode=spec.status??200;res.headers={"content-type":spec.contentType??"application/json",...(spec.headers??{})};respond(res);
   queueMicrotask(()=>{const body=Buffer.isBuffer(spec.body)?spec.body:spec.body===undefined?Buffer.alloc(0):Buffer.from(JSON.stringify(spec.body));if(body.length)res.emit("data",body);res.emit("end")})})});
  req.destroy=error=>queueMicrotask(()=>req.emit("error",error));return req};
}
function scriptedAdapter(reply,supplied=config){
 const seen=[],impl=(options,respond)=>{seen.push(options.path);return scriptedRequest(reply)(options,respond)};
 return {seen,adapter:createClosedGithubHttpsAdapter(supplied,Buffer.from("secret-canary"),{lookup:async()=>[{address:"140.82.114.5",family:4}],requestImpl:impl})};
}

test("closed transport admits only canonical integer pages 1..10 before requestImpl",async()=>{
 const {seen,adapter}=scriptedAdapter(path=>path===PR_PATH?{body:pr()}:{});
 await adapter.request(validCoordinate());seen.length=0;
 const admitted=[];for(let page=1;page<=10;page++)for(const kind of ["check-runs","statuses"])admitted.push(collectionPath(kind,page));
 for(const path of admitted)await adapter.request({...validCoordinate(),path});
 assert.deepEqual(seen,admitted);
 const refused=[
  collectionPath("check-runs",0),collectionPath("statuses",0),
  collectionPath("check-runs",11),collectionPath("statuses",11),collectionPath("check-runs",100),
  collectionPath("check-runs","999999999999999999999999"),collectionPath("statuses","999999999999999999999999"),
  collectionPath("check-runs","9007199254740993"),collectionPath("check-runs",Number.MAX_SAFE_INTEGER),
  collectionPath("check-runs","010"),collectionPath("statuses","0000000001"),collectionPath("check-runs","01"),
  collectionPath("check-runs","%31"),collectionPath("check-runs","%310"),collectionPath("check-runs","+1"),
  collectionPath("check-runs","%201"),collectionPath("check-runs","1%20"),collectionPath("check-runs",""),
  collectionPath("check-runs","1.0"),collectionPath("check-runs","1e0"),collectionPath("check-runs","0x1"),
  collectionPath("check-runs","-1"),collectionPath("check-runs","Infinity"),collectionPath("check-runs","NaN"),
  collectionPath("check-runs","1&page=2"),`${collectionPath("check-runs",10)}&extra=1`,`${collectionPath("check-runs",1)}#fragment`,
  collectionPath("check-runs",1,{head:`aBcdef${"0".repeat(34)}`}),collectionPath("check-runs",1,{head:"a".repeat(39)}),collectionPath("check-runs",1,{head:"a".repeat(41)}),
  collectionPath("check-runs",1,{owner:"other"}),collectionPath("check-runs",1,{repository:"other"}),
  `/repos/nousresearch/hermes-agent/commits/${SHA}/check%2Druns?filter=all&per_page=100&page=1`,
  `/repos/nousresearch/hermes-agent/commits/${SHA}/check-runs%3Ffilter=all&per_page=100&page=1`,
  `/repos/nousresearch/hermes-agent/commits/${SHA}/extra/check-runs?filter=all&per_page=100&page=1`,
 ];
 const before=seen.length;
 for(const path of refused)await assert.rejects(()=>adapter.request({...validCoordinate(),path}),error=>error.code==="PERMISSION_REFUSED",path);
 assert.equal(seen.length,before);
 adapter.destroy();
});

// Boundary literals are written independently of the implementation table, from the IANA IPv4/IPv6
// special-purpose registries plus multicast/reserved space. Both edges of every excluded prefix.
const IPV4_EXCLUDED=[["0.0.0.0","0.255.255.255"],["10.0.0.0","10.255.255.255"],["100.64.0.0","100.127.255.255"],["127.0.0.0","127.255.255.255"],["169.254.0.0","169.254.255.255"],["172.16.0.0","172.31.255.255"],["192.0.0.0","192.0.0.255"],["192.0.2.0","192.0.2.255"],["192.31.196.0","192.31.196.255"],["192.52.193.0","192.52.193.255"],["192.88.99.0","192.88.99.255"],["192.168.0.0","192.168.255.255"],["192.175.48.0","192.175.48.255"],["198.18.0.0","198.19.255.255"],["198.51.100.0","198.51.100.255"],["203.0.113.0","203.0.113.255"],["224.0.0.0","239.255.255.255"],["240.0.0.0","255.255.255.255"]];
const IPV6_EXCLUDED=[["::","::"],["::1","::1"],["::ffff:0:0","::ffff:ffff:ffff"],["64:ff9b::","64:ff9b::ffff:ffff"],["64:ff9b:1::","64:ff9b:1:ffff:ffff:ffff:ffff:ffff"],["100::","100::ffff:ffff:ffff:ffff"],["2001::","2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff"],["2001:db8::","2001:db8:ffff:ffff:ffff:ffff:ffff:ffff"],["2002::","2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],["2620:4f:8000::","2620:4f:8000:ffff:ffff:ffff:ffff:ffff"],["3ffe::","3ffe:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],["3fff::","3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff"],["5f00::","5f00:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],["fc00::","fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],["fe80::","febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],["ff00::","ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],["1000::","1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],["4000::","5eff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],["6000::","fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"]];
const refuseAddress=address=>assert.throws(()=>admitPublicDnsResults([{address,family:address.includes(":")?6:4}]),/DNS_FAILURE/,address);
const admitAddress=address=>assert.deepEqual(admitPublicDnsResults([{address,family:address.includes(":")?6:4}]),{address,family:address.includes(":")?6:4},address);

test("DNS admission refuses both boundaries of every non-globally-routable IPv4 and IPv6 prefix",()=>{
 for(const [low,high] of [...IPV4_EXCLUDED,...IPV6_EXCLUDED]){refuseAddress(low);refuseAddress(high);}
 for(const address of ["::ffff:0.0.0.0","::ffff:140.82.114.5","::ffff:255.255.255.255","64:ff9b::8.8.8.8","fe80::1%en0","2001:db8::1"])refuseAddress(address);
 assert.throws(()=>admitPublicDnsResults([{address:"8.8.8.8",family:6}]),/DNS_FAILURE/);
 assert.throws(()=>admitPublicDnsResults([{address:"2606:4700:4700::1111",family:4}]),/DNS_FAILURE/);
});

test("DNS admission still admits representative globally-routable addresses on both sides of every excluded edge",()=>{
 for(const address of ["1.1.1.1","8.8.8.8","9.9.9.9","140.82.114.5","9.255.255.255","11.0.0.0","100.63.255.255","100.128.0.0","126.255.255.255","128.0.0.0","169.253.255.255","169.255.0.0","172.15.255.255","172.32.0.0","191.255.255.255","192.0.1.0","192.0.3.0","192.31.195.255","192.31.197.0","192.52.192.255","192.52.194.0","192.88.98.255","192.88.100.0","192.167.255.255","192.169.0.0","192.175.47.255","192.175.49.0","198.17.255.255","198.20.0.0","198.51.99.255","198.51.101.0","203.0.112.255","203.0.114.0","223.255.255.255"])admitAddress(address);
 for(const address of ["2000::","2001:200::","2001:4860:4860::8888","2001:db7:ffff:ffff:ffff:ffff:ffff:ffff","2001:db9::","2003::","2606:4700:4700::1111","2620:4f:7fff:ffff:ffff:ffff:ffff:ffff","2620:4f:8001::","3ffd:ffff:ffff:ffff:ffff:ffff:ffff:ffff","3fff:1000::","3fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"])admitAddress(address);
});

test("closed transport revalidates exact route grammars and never forwards caller authority headers",async()=>{
 const seen=[];const impl=(options,respond)=>{seen.push(options);return scriptedRequest(path=>path===PR_PATH?{body:pr()}:{})(options,respond)};
 const adapter=createClosedGithubHttpsAdapter(config,Buffer.from("secret-canary"),{lookup:async()=>[{address:"140.82.114.5",family:4}],requestImpl:impl});
 await adapter.request({method:"GET",origin:config.apiOrigin,path:"/repos/nousresearch/hermes-agent/pulls/7",headers:{Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"workhub-agent-change-assurance/4"}});
 assert.equal(seen[0].headers.Host,undefined);assert.equal(seen[0].headers.Authorization,"Bearer secret-canary");
 for(const coordinate of [{method:"GET",origin:config.apiOrigin,path:"/user/repos?visibility=private",headers:{}},{method:"GET",origin:config.apiOrigin,path:"/repos/nousresearch/hermes-agent/pulls/7",headers:{Host:"evil.invalid"}},{method:"GET",origin:config.apiOrigin,path:`/repos/nousresearch/hermes-agent/commits/${SHA}/check-runs?per_page=100&filter=all&page=1`,headers:{}}])await assert.rejects(()=>adapter.request(coordinate),error=>error.code==="PERMISSION_REFUSED");
 adapter.destroy();
});

// The lowest transport must not be a general "any commit in this repository" reader. Collection routes
// are admitted only for the head the adapter itself learned by strictly parsing and admitting the fixed
// PR identity response. There is no external head setter: these probes drive the public request seam only.
test("closed transport refuses commit routes until the fixed PR response binds a head, then admits only that head",async()=>{
 const {seen,adapter}=scriptedAdapter(path=>path===PR_PATH?{body:pr()}:{});
 for(const kind of FAMILIES)for(const page of [1,10])
  await assert.rejects(()=>adapter.request({...validCoordinate(),path:collectionPath(kind,page)}),error=>error.code==="PERMISSION_REFUSED"&&error.message==="PERMISSION_REFUSED",`unbound ${kind} page ${page}`);
 assert.deepEqual(seen,[],"no unbound commit route may reach requestImpl");

 await adapter.request(validCoordinate());
 assert.deepEqual(seen,[PR_PATH]);
 const admitted=[];for(let page=1;page<=10;page++)for(const kind of FAMILIES)admitted.push(collectionPath(kind,page));
 for(const path of admitted)await adapter.request({...validCoordinate(),path});
 const revalidation={...validCoordinate(),path:collectionPath("check-runs",1),headers:{...validCoordinate().headers,"If-None-Match":'"v1"'}};
 await adapter.request(revalidation);
 assert.deepEqual(seen,[PR_PATH,...admitted,collectionPath("check-runs",1)],"the exact admitted head reaches requestImpl for every family, page and revalidation");

 const before=seen.length;
 for(const kind of FAMILIES)for(const head of [BASE,"6".repeat(40),"0".repeat(40),"f".repeat(40),"a1b2c3d4e5".repeat(4)])
  await assert.rejects(()=>adapter.request({...validCoordinate(),path:collectionPath(kind,1,{head})}),error=>error.code==="PERMISSION_REFUSED",`substituted ${kind} head ${head}`);
 assert.equal(seen.length,before,"no substituted canonical lowercase SHA may reach requestImpl");
 adapter.destroy();
});

test("only strict PR identity admission authorizes a head; hostile PR responses never do",async()=>{
 const valid=JSON.stringify(pr());
 for(const [name,spec] of [
  ["truncated json",{body:Buffer.from(valid.slice(0,-3))}],
  ["duplicate top-level key",{body:Buffer.from(valid.replace('"id":44,','"id":44,"id":44,'))}],
  ["duplicate head key",{body:Buffer.from(valid.replace('"sha":"'+SHA+'"','"sha":"'+SHA+'","sha":"'+SHA+'"'))}],
  ["prototype key",{body:Buffer.from(valid.replace('{"id":44,','{"__proto__":{},"id":44,'))}],
  ["trailing bytes",{body:Buffer.from(`${valid}x`)}],
  ["malformed utf-8",{body:Buffer.from([0xc3,0x28])}],
  ["html shaped as json",{contentType:"text/html",body:Buffer.from("<html>1</html>")}],
  ["substituted pull number",{body:pr({number:8})}],
  ["substituted base repository",{body:pr({base:{sha:BASE,repo:{id:11,node_id:"R_base",name:"other-repo",owner:{login:"nousresearch"}}}})}],
  ["substituted base owner",{body:pr({base:{sha:BASE,repo:{id:11,node_id:"R_base",name:"hermes-agent",owner:{login:"attacker"}}}})}],
  ["noncanonical head sha",{body:pr({head:{...pr().head,sha:"A".repeat(40)}})}],
  ["missing head repository",{body:pr({head:{sha:SHA}})}],
  ["unknown pull state",{body:pr({state:"merged"})}],
  ["server failure",{status:500,body:pr()}],
  ["not found",{status:404,body:{message:"Not Found"}}],
 ]){
  const {seen,adapter}=scriptedAdapter(path=>path===PR_PATH?spec:{});
  await adapter.request(validCoordinate()).catch(()=>{});
  for(const kind of FAMILIES)for(const head of [SHA,"A".repeat(40).toLowerCase()])
   await assert.rejects(()=>adapter.request({...validCoordinate(),path:collectionPath(kind,1,{head})}),error=>error.code==="PERMISSION_REFUSED",`${name} / ${kind}`);
  assert.deepEqual(seen,[PR_PATH],`${name} authorized no commit route`);
  adapter.destroy();
 }
});

test("a moved or refused PR reread rebinds the transport and leaves no stale head authorization",async()=>{
 const MOVED="7".repeat(40);let spec={body:pr()};
 const {seen,adapter}=scriptedAdapter(path=>path===PR_PATH?spec:{});
 await adapter.request(validCoordinate());
 await adapter.request({...validCoordinate(),path:collectionPath("check-runs",1)});
 assert.deepEqual(seen,[PR_PATH,collectionPath("check-runs",1)]);

 spec={body:pr({head:{...pr().head,sha:MOVED}})};
 await adapter.request(validCoordinate());
 const afterMove=seen.length;
 for(const kind of FAMILIES)await assert.rejects(()=>adapter.request({...validCoordinate(),path:collectionPath(kind,1)}),error=>error.code==="PERMISSION_REFUSED",`stale ${kind}`);
 assert.equal(seen.length,afterMove,"the prior head must not survive PR head movement");
 for(const kind of FAMILIES)await adapter.request({...validCoordinate(),path:collectionPath(kind,1,{head:MOVED})});
 assert.deepEqual(seen.slice(afterMove),[collectionPath("check-runs",1,{head:MOVED}),collectionPath("statuses",1,{head:MOVED})]);

 spec={status:500,body:{}};
 await adapter.request(validCoordinate()).catch(()=>{});
 const afterFailure=seen.length;
 for(const head of [SHA,MOVED])for(const kind of FAMILIES)
  await assert.rejects(()=>adapter.request({...validCoordinate(),path:collectionPath(kind,1,{head})}),error=>error.code==="PERMISSION_REFUSED",`cleared ${kind} ${head}`);
 assert.equal(seen.length,afterFailure,"a refused PR reread clears prior authorization");
 adapter.destroy();
});

// Preservation: head binding is transparent to the exact controller composition, which hands the engine
// the transport's request method. One observe and one reobserve (including a moved remote head) still
// settle and re-admit, and every collection request carries the head of its own PR read.
test("the engine composed over the closed transport still settles observe, reobserve and moved-head reobserve",async()=>{
 const MOVED="8".repeat(40),specs=[],seen=[];
 const impl=(options,respond)=>{seen.push(options.path);return scriptedRequest(()=>specs.shift())(options,respond)};
 const adapter=createClosedGithubHttpsAdapter(config,Buffer.from("secret-canary"),{lookup:async()=>[{address:"140.82.114.5",family:4}],requestImpl:impl});
 const engine=createFixtureGithubEngine(config,{request:(coordinate,options)=>adapter.request(coordinate,options),attemptId:()=>"a",now:()=>"2026-09-01T00:00:00.000Z"});
 const remote=head=>pr({head:{...pr().head,sha:head}});
 // Strong validators force the engine's production conditional revalidation path. Exact 304 responses
 // must reach the engine, while the adapter must continue to refuse actual redirects.
 const validator='"v1"';
 const checkPage=head=>({headers:{etag:validator},body:{total_count:1,check_runs:[check(1,{head_sha:head})]}}),statusPage=head=>({headers:{etag:validator},body:[status(2,{sha:head})]});
 const notModified={status:304,headers:{etag:validator},body:Buffer.alloc(0)};
 const round=head=>[{body:remote(head)},checkPage(head),notModified,statusPage(head),notModified,{body:remote(head)}];
 const trace=head=>[PR_PATH,collectionPath("check-runs",1,{head}),collectionPath("check-runs",1,{head}),collectionPath("statuses",1,{head}),collectionPath("statuses",1,{head}),PR_PATH];

 specs.push(...round(SHA));
 const first=await engine.observe({local});
 assert.equal(first.pull.head.sha,SHA);assert.equal(first.subject,"PARENT_COMMIT_ONLY");assert.equal(first.outcome,"ALL_SUCCESS");
 assert.equal(admitGithubObservation(first,{local,config,trusted:engine.trustedTuple(first)}).valid,true);

 specs.push(...round(MOVED));
 const second=await engine.observe({local});
 assert.equal(second.pull.head.sha,MOVED);assert.equal(second.subject,"REMOTE_HEAD_DIFFERS");
 assert.equal(admitGithubObservation(second,{local,config,trusted:engine.trustedTuple(second)}).valid,true);

 assert.deepEqual(seen,[...trace(SHA),...trace(MOVED)],"every collection request carries the head of its own PR read");
 assert.equal(specs.length,0);
 specs.push({status:302,headers:{location:"https://example.test/redirect"},body:Buffer.alloc(0)});
 await assert.rejects(()=>engine.observe({local}),error=>error.code==="PERMISSION_REFUSED","actual redirects remain refused");
 assert.equal(seen.at(-1),PR_PATH);assert.equal(specs.length,0);
 adapter.destroy();
});
