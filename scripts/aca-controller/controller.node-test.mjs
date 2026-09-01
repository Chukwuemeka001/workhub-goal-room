import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { EventEmitter } from "node:events";
import test from "node:test";
import { startFixtureQualificationController, startProductionController } from "./controller.mjs";
import { baseDiffDigest, createCheckReceipt, createConnectedV3Envelope } from "./receipt.mjs";

const request=(authority,path,options={})=>fetch(`http://${authority}${path}`,options);
const diffFixture=(baseCommit,baseTree,snapshotDigest)=>{const rows=[{path:"src/a.ts",status:"M",oldMode:"100644",newMode:"100644",oldBlob:"1".repeat(40),newBlob:"2".repeat(40),additions:1,deletions:0,binary:false}],additions=1,deletions=0;return{rows,changedPaths:["src/a.ts"],additions,deletions,diffDigest:baseDiffDigest({baseCommit,baseTree,snapshotDigest,rows,additions,deletions})}};
const rawStatus=(port,headers)=>new Promise((resolve,reject)=>{const req=httpRequest({host:"127.0.0.1",port,path:"/api/observe",method:"POST",headers},res=>{res.resume();res.on("end",()=>resolve(res.statusCode));});req.on("error",reject);req.end();});
async function productionHarness(t,behavior={}){const baseCommit="0c85cb08c9959394d074e13dd47eb6ed6cbc59e8",baseTree="69563100a8057bf4d06c731e2403585879859756",snapshotDigest="9".repeat(64),imageId=`sha256:${"7".repeat(64)}`,spec="8".repeat(64),output={sha256:"6".repeat(64),observedBytes:0,preview:"",truncated:false,limitExceeded:false};let calls=0;const shot={parentCommit:"1d2e93424da21574ab6cd59fb4f1959fecdb40db",parentTree:"a68d79bfb4ff810dfeb14a689d9131d053dc1360",baseCommit,baseTree,snapshotDigest,manifestDigest:"5".repeat(64),contentManifestDigest:"4".repeat(64),diff:diffFixture(baseCommit,baseTree,snapshotDigest),sealed:{outerDigest:"2".repeat(64),outerBytes:2048,sha256:"1".repeat(64)},cleanup:async()=>{}};const installRoot=await mkdtemp(join(tmpdir(),"aca-installed-fixture-"));t.after(()=>rm(installRoot,{recursive:true,force:true}));const config={schema:"aca-production-controller-config/v1",installRoot,repositoryRoot:behavior.repositoryRoot??"/trusted/repo",displayName:"repo",scratchParent:"/trusted/runtime/research",journalPath:"/trusted/runtime/research/journal.json",parentCommit:shot.parentCommit,baseCommit,baseTree,allowedPaths:["src/a.ts"],requiredOverlayPaths:["src/a.ts"],excludedPrefixes:[".hermes","node_modules","dist"],...(behavior.github?{github:behavior.github}:{}),lockfile:{blobId:"b".repeat(40),bytes:10,digest:"a".repeat(64)},docker:{dockerCli:"/trusted/docker",dockerConfig:"/trusted/docker-config",dockerHost:"unix:///trusted/docker.sock",authorizedSocket:"/trusted/docker.sock",imageId,expectedLabels:{"aca.contract":"aca-sandbox/v1","aca.spec":spec},policyVersion:"aca-isolation-v1",controllerNonce:"c".repeat(32)},verifierSpecDigest:spec};const adapters={verifyInstalledController:async()=>{},createDurableJournal:async()=>({records:()=>[],record:async()=>{},settle:async()=>{}}),createDockerCliIO:()=>({}),recoverJournal:async()=>({unresolved:[]}),qualifyDocker:async()=>({qualified:true,policyVersion:"aca-isolation-v1",imageId,labels:config.docker.expectedLabels,daemon:{daemonId:"daemon"}}),captureSnapshot:async()=>{calls++;return shot},revalidateSnapshot:async()=>{},createSnapshotTarStream:()=>{},runSnapshotChecks:behavior.run??(async()=>({state:"SETTLED",imageId,results:[{checkId:"unit",state:"PASS",reason:"CHECK_PASSED",execution:"RUN",exitCode:0,stdout:output,stderr:output},{checkId:"build",state:"PASS",reason:"CHECK_PASSED",execution:"RUN",exitCode:0,stdout:output,stderr:output}]})),...behavior.adapters};const service=await startProductionController(config,adapters);t.after(()=>service.close());return{service,get calls(){return calls;}};}

test("standalone controller serves only trusted UI and never imports hostile candidate host code",async t=>{
 const root=await mkdtemp(join(tmpdir(),"aca-hostile-"));t.after(()=>rm(root,{recursive:true,force:true}));const marker=join(root,"marker");
 await writeFile(join(root,"package.json"),JSON.stringify({scripts:{start:`touch ${marker}`}})); await writeFile(join(root,"vite.config.mjs"),`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(marker)},'x')`);
 const {service}=await productionHarness(t,{repositoryRoot:root});
 const response=await request(service.authority,"/");assert.equal(response.status,200);const html=await response.text();assert.match(html,/WorkHub Agent Change Assurance/);assert.match(html,/Content-Security-Policy/);await assert.rejects(()=>access(marker));
 assert.equal(service.host,"127.0.0.1");assert.match(service.authority,/^127\.0\.0\.1:\d+$/);assert.equal(JSON.stringify(service).includes(service.capability),false);
});

test("execution API enforces exact authority, origin, empty JSON, capability and fetch metadata",async t=>{
 const harness=await productionHarness(t);const service=harness.service;
 const html=await (await request(service.authority,"/")).text();const cap=/data-session="([0-9a-f]{64})"/.exec(html)?.[1];assert.ok(cap);
 const headers={Origin:`http://${service.authority}`,Host:service.authority,"Content-Type":"application/json","X-WorkHub-ACA-Session":cap,"Sec-Fetch-Site":"same-origin","Sec-Fetch-Mode":"cors","Sec-Fetch-Dest":"empty"};
 let r=await request(service.authority,"/api/observe",{method:"POST",headers,body:""});assert.equal(r.status,200);assert.equal((await r.json()).schema,"agent-change-assurance/connected-v3");assert.equal(harness.calls,1);
 const attacks=[
  {method:"OPTIONS",headers},
  {method:"POST",headers:{...headers,Origin:"null"},body:""},
  {method:"POST",headers:{...headers,Origin:"http://candidate.invalid"},body:""},
  {method:"POST",headers:{...headers,"X-Forwarded-Host":"evil"},body:""},
  {method:"POST",headers:{...headers,"X-WorkHub-ACA-Session":"0".repeat(64)},body:""},
  {method:"POST",headers:{...headers,"Sec-Fetch-Site":"cross-site"},body:""},
  {method:"POST",headers:{...headers,"Content-Type":"application/x-www-form-urlencoded"},body:""},
  {method:"POST",headers,body:"{}"},
 ];
 for(const a of attacks){r=await request(service.authority,"/api/observe",a);assert.ok(r.status>=400,`${a.method} ${JSON.stringify(a.headers)}`);}assert.ok(await rawStatus(service.port,{...headers,Host:`localhost:${service.port}`})>=400);assert.ok(await rawStatus(service.port,{...headers,"Sec-Fetch-Mode":"navigate"})>=400);assert.equal(harness.calls,1);
});

test("cancel API aborts the active generation and waits for controller cleanup settlement",async t=>{
 let signal;let settle;const {service}=await productionHarness(t,{run:async(_config,stage)=>{signal=stage.signal;return new Promise(resolve=>{settle=()=>resolve({state:"INDETERMINATE",reason:"CANCELLED",results:[]});});}});
 const cap=/data-session="([0-9a-f]{64})"/.exec(await(await request(service.authority,"/")).text())[1];const headers={Origin:`http://${service.authority}`,"Content-Type":"application/json","X-WorkHub-ACA-Session":cap};
 const pending=request(service.authority,"/api/observe",{method:"POST",headers,body:""});await new Promise(resolve=>setTimeout(resolve,20));
 const cancelling=request(service.authority,"/api/cancel",{method:"POST",headers,body:""});await new Promise(resolve=>setTimeout(resolve,20));assert.equal(signal.aborted,true);
 settle();const cancelResponse=await cancelling;assert.equal(cancelResponse.status,200);assert.deepEqual(await cancelResponse.json(),{state:"INDETERMINATE",reason:"CANCELLED",authority:"NONE"});await pending;
});

test("one active generation is BUSY and capability rotates across restart",async t=>{
 let release;const first=await productionHarness(t,{run:async()=>new Promise(resolve=>{release=()=>resolve({state:"SETTLED",results:[]});})});const service=first.service;const html=await(await request(service.authority,"/")).text();const cap=/data-session="([0-9a-f]{64})"/.exec(html)[1];const headers={Origin:`http://${service.authority}`,"Content-Type":"application/json","X-WorkHub-ACA-Session":cap};
 const pending=request(service.authority,"/api/observe",{method:"POST",headers,body:""});await new Promise(r=>setTimeout(r,20));const busy=await request(service.authority,"/api/observe",{method:"POST",headers,body:""});assert.equal(busy.status,409);release();await pending;
 await service.close();const next=(await productionHarness(t)).service;const nextCap=/data-session="([0-9a-f]{64})"/.exec(await(await request(next.authority,"/")).text())[1];assert.notEqual(nextCap,cap);
});

test("production entrypoint recovers before listen and returns its own exact trusted-base connected-v3 envelope",async t=>{
 const events=[];const baseCommit="0c85cb08c9959394d074e13dd47eb6ed6cbc59e8",baseTree="69563100a8057bf4d06c731e2403585879859756",snapshotDigest="9".repeat(64),imageId=`sha256:${"7".repeat(64)}`,spec="8".repeat(64);
 const shot={parentCommit:"1d2e93424da21574ab6cd59fb4f1959fecdb40db",parentTree:"a68d79bfb4ff810dfeb14a689d9131d053dc1360",baseCommit,baseTree,snapshotDigest,manifestDigest:"5".repeat(64),contentManifestDigest:"4".repeat(64),diff:diffFixture(baseCommit,baseTree,snapshotDigest),sealed:{outerDigest:"2".repeat(64),outerBytes:2048,sha256:"1".repeat(64)},cleanup:async()=>events.push("scratch-cleanup")};
 const output={sha256:"6".repeat(64),observedBytes:0,preview:"",truncated:false,limitExceeded:false};
 const config={schema:"aca-production-controller-config/v1",installRoot:"/trusted/installed",repositoryRoot:"/trusted/repo",displayName:"repo",scratchParent:"/trusted/runtime/research",journalPath:"/trusted/runtime/research/journal.json",parentCommit:shot.parentCommit,baseCommit,baseTree,allowedPaths:["src/a.ts"],requiredOverlayPaths:["src/a.ts"],excludedPrefixes:[".hermes","node_modules","dist"],lockfile:{blobId:"b".repeat(40),bytes:10,digest:"a".repeat(64)},docker:{dockerCli:"/trusted/docker",dockerConfig:"/trusted/docker-config",dockerHost:"unix:///trusted/docker.sock",authorizedSocket:"/trusted/docker.sock",imageId,expectedLabels:{"aca.contract":"aca-sandbox/v1","aca.spec":spec},policyVersion:"aca-isolation-v1",controllerNonce:"c".repeat(32)},verifierSpecDigest:spec};
 const makeReceipt=input=>Object.freeze({schema:"aca-check-receipt/v1",...input,receiptDigest:`${input.checkId==="unit"?"d":"e"}`.repeat(64)});
 const adapters={verifyInstalledController:async()=>events.push("verify-install"),createDurableJournal:async()=>({records:()=>[{resource:"container"}],record:async()=>{},settle:async()=>{}}),createDockerCliIO:()=>({}),recoverJournal:async records=>{events.push(`recover:${records.length}`);return{unresolved:[]}},qualifyDocker:async()=>{events.push("qualify");return{qualified:true,policyVersion:"aca-isolation-v1",imageId,labels:config.docker.expectedLabels,daemon:{daemonId:"daemon"}}},captureSnapshot:async options=>{events.push(`capture:${options.baseCommit}:${options.baseTree}`);return shot},revalidateSnapshot:async()=>{events.push("source")},createSnapshotTarStream:()=>{},runSnapshotChecks:async()=>({state:"SETTLED",imageId,results:[{checkId:"unit",state:"PASS",reason:"CHECK_PASSED",execution:"RUN",exitCode:0,stdout:output,stderr:output},{checkId:"build",state:"PASS",reason:"CHECK_PASSED",execution:"RUN",exitCode:0,stdout:output,stderr:output}]}),createCheckReceipt:makeReceipt,createConnectedV3Envelope:input=>Object.freeze({schema:"agent-change-assurance/connected-v3",authority:"NONE",repository:input.repository,qualification:input.qualification,receipts:input.receipts,envelopeDigest:"f".repeat(64)}),admitConnectedV3Envelope:value=>Object.freeze({valid:true,envelope:value})};
 const service=await startProductionController(config,adapters);t.after(()=>service.close());assert.deepEqual(events.slice(0,3),["verify-install","recover:1","qualify"]);
 const html=await(await request(service.authority,"/")).text(),cap=/data-session="([0-9a-f]{64})"/.exec(html)[1],headers={Origin:`http://${service.authority}`,"Content-Type":"application/json","X-WorkHub-ACA-Session":cap};const response=await request(service.authority,"/api/observe",{method:"POST",headers,body:""});assert.equal(response.status,200);const envelope=await response.json();assert.equal(envelope.schema,"agent-change-assurance/connected-v3");assert.equal(envelope.repository.baseCommit,baseCommit);assert.equal(envelope.repository.baseTree,baseTree);assert.equal(envelope.receipts.length,2);assert.deepEqual(envelope.receipts.map(row=>row.checkId),["unit","build"]);assert.ok(events.indexOf("scratch-cleanup")<events.findIndex(row=>row.startsWith?.("receipt:"))||!events.some(row=>row.startsWith?.("receipt:")));
});

test("production response refuses a fully re-digested authority mutation before browser rendering",async t=>{
 const changedBase="6".repeat(40),changedTree="7".repeat(40);
 const harness=await productionHarness(t,{adapters:{createConnectedV3Envelope:input=>{
  const receipts=input.receipts.map(receipt=>{const{schema,receiptDigest,...body}=receipt;return createCheckReceipt({...body,baseCommit:changedBase,baseTree:changedTree});});
  return createConnectedV3Envelope({repository:{...input.repository,baseCommit:changedBase,baseTree:changedTree},qualification:input.qualification,receipts});
 }}});
 const html=await(await request(harness.service.authority,"/")).text(),cap=/data-session="([0-9a-f]{64})"/.exec(html)[1],headers={Origin:`http://${harness.service.authority}`,"Content-Type":"application/json","X-WorkHub-ACA-Session":cap};
 const response=await request(harness.service.authority,"/api/observe",{method:"POST",headers,body:""});
 assert.equal(response.status,500);assert.equal((await response.json()).code,"CONTROLLER_FAILURE");
});

test("production keeps completed outcomes and applies run terminal only to missing truthful results",async t=>{const cases=[
 {name:"pass-timeout",terminal:"TIMEOUT",results:[{checkId:"unit",state:"PASS",reason:"CHECK_PASSED",execution:"RUN",exitCode:0}],expected:[["PASS","CHECK_PASSED","RUN"],["INDETERMINATE","TIMEOUT","RUN"]]},
 {name:"pass-cancelled",terminal:"CANCELLED",results:[{checkId:"unit",state:"PASS",reason:"CHECK_PASSED",execution:"RUN",exitCode:0}],expected:[["PASS","CHECK_PASSED","RUN"],["INDETERMINATE","CANCELLED","NOT_RUN"]]},
 {name:"fail-source-moved",terminal:"SOURCE_MOVED",results:[{checkId:"unit",state:"FAIL",reason:"CHECK_FAILED",execution:"RUN",exitCode:1}],expected:[["FAIL","CHECK_FAILED","RUN"],["INDETERMINATE","SOURCE_MOVED","NOT_RUN"]]},
 {name:"run-not-run",terminal:"TIMEOUT",results:[{checkId:"unit",state:"PASS",reason:"CHECK_PASSED",execution:"RUN",exitCode:0},{checkId:"build",state:"INDETERMINATE",reason:"TIMEOUT",execution:"RUN"}],expected:[["PASS","CHECK_PASSED","RUN"],["INDETERMINATE","TIMEOUT","RUN"]]},
 {name:"pass-cli-unresolved",terminal:"CLEANUP_UNRESOLVED",results:[{checkId:"unit",state:"PASS",reason:"CHECK_PASSED",execution:"RUN",exitCode:0},{checkId:"build",state:"INDETERMINATE",reason:"CLEANUP_UNRESOLVED",execution:"RUN",cliExited:false}],expected:[["PASS","CHECK_PASSED","RUN"],["INDETERMINATE","CLEANUP_UNRESOLVED","RUN"]]},
 ];for(const item of cases){const harness=await productionHarness(t,{run:async()=>({state:"INDETERMINATE",reason:item.terminal,results:item.results})});const html=await(await request(harness.service.authority,"/")).text(),cap=/data-session="([0-9a-f]{64})"/.exec(html)[1],headers={Origin:`http://${harness.service.authority}`,"Content-Type":"application/json","X-WorkHub-ACA-Session":cap};const response=await request(harness.service.authority,"/api/observe",{method:"POST",headers,body:""});assert.equal(response.status,200,item.name);const envelope=await response.json();assert.deepEqual(envelope.receipts.map(r=>[r.state,r.reason,r.execution]),item.expected,item.name);}});

test("production entrypoint rejects an arbitrary execute callback instead of exposing host execution authority",async()=>{await assert.rejects(()=>startProductionController({schema:"aca-production-controller-config/v1",execute:async()=>({})},{}),/CONTROLLER_CONFIG_REFUSED/);});

test("installed UI source has exact terminal refusal and AbortError cancellation lifecycles",async()=>{const source=await readFile(new URL("./ui.js",import.meta.url),"utf8");assert.match(source,/REFUSED · Observation was not admitted; no executable result is attached\./);assert.match(source,/CANCELLED · Executable evidence invalidated; no candidate FAIL was produced\./);assert.match(source,/error\.name === "AbortError"/);});

test("installed UI renders only normalized connected-v4 GitHub parent-only evidence with no write controls",async()=>{const source=await readFile(new URL("./ui.js",import.meta.url),"utf8");assert.match(source,/agent-change-assurance\/connected-v4/);assert.match(source,/External evidence · GitHub read-only/);assert.match(source,/local dirty snapshot is not represented remotely/);assert.match(source,/Not observed by this tracer/);assert.doesNotMatch(source,/create comment|merge pull|rerun workflow|approve review/i);});
test("installed UI admits the normalized remote-head-differs subject without claiming candidate binding",async()=>{const source=await readFile(new URL("./ui.js",import.meta.url),"utf8");assert.match(source,/REMOTE_HEAD_DIFFERS/);assert.match(source,/Remote evidence does not represent the observed local candidate/);assert.doesNotMatch(source,/CLEAN_COMMIT_EXACT/);});

test("installed UI exposes four dimensions, exact summary truth, unavailable state and hostile-row styling",async()=>{const source=await readFile(new URL("./ui.js",import.meta.url),"utf8"),css=await readFile(new URL("./ui.css",import.meta.url),"utf8");for(const text of ["Availability:","Subject:","Lifecycle:","Outcome:","Failure is recorded external evidence","Pending records are neither pass nor fail","External evidence unavailable","No stale or partial external rows are displayed"])assert.ok(source.includes(text),text);for(const token of ["min-width:0","overflow-wrap:anywhere","word-break:break-word","max-height","overflow:auto","min-height:44px"])assert.ok(css.includes(token),token);});

test("an unresolved journal ambiguity parks subsequent dispatch as BUSY",async t=>{let parked=false;const harness=await productionHarness(t,{adapters:{createDockerCliIO:()=>({park:()=>{parked=true},isParked:()=>parked})},run:async(_config,_stage,io)=>{io.park();return{state:"INDETERMINATE",reason:"CLEANUP_UNRESOLVED",results:[]}}});const html=await(await request(harness.service.authority,"/")).text(),cap=/data-session="([0-9a-f]{64})"/.exec(html)[1],headers={Origin:`http://${harness.service.authority}`,"Content-Type":"application/json","X-WorkHub-ACA-Session":cap};let response=await request(harness.service.authority,"/api/observe",{method:"POST",headers,body:""});assert.equal(response.status,200);response=await request(harness.service.authority,"/api/observe",{method:"POST",headers,body:""});assert.equal(response.status,409);assert.equal((await response.json()).code,"BUSY");});

test("production startup refuses to listen or qualify while durable unresolved CLI custody is parked",async t=>{let qualified=0,parked=false;const marker={kind:"unresolved_cli",attemptId:"attempt",checkId:"unit",creationNonce:"creation",containerId:"f".repeat(64),recordedAt:"2026-09-01T00:00:00.000Z",reason:"CLI_EXTINCTION_UNPROVEN"};await assert.rejects(()=>productionHarness(t,{adapters:{createDurableJournal:async()=>({records:()=>[marker]}),createDockerCliIO:()=>({park:()=>{parked=true},isParked:()=>parked}),recoverJournal:async records=>{assert.deepEqual(records,[marker]);parked=true;return{unresolved:[marker]}},qualifyDocker:async()=>{qualified++;throw new Error("QUALIFICATION_MUST_NOT_RUN")}}}),/RECOVERY_UNRESOLVED/);assert.equal(parked,true);assert.equal(qualified,0);});

test("test-only fixture qualification composes one atomic local plus external connected-v4 generation",async t=>{
 const local={schema:"agent-change-assurance/connected-v3",authority:"NONE",repository:{snapshotDigest:"9".repeat(64),parentCommit:"1".repeat(40),baseCommit:"2".repeat(40)},evaluatorSnapshot:{evidence:[]}};
 const external={schema:"github-external-observation/v1",authority:"NONE",subject:"PARENT_COMMIT_ONLY"};let calls=[];
 const service=await startFixtureQualificationController({localEngine:{observe:async()=>{calls.push("local");return local}},githubEngine:{observe:async({local:binding})=>{calls.push(`external:${binding.snapshotDigest}`);return external}},compose:(a,b)=>({schema:"agent-change-assurance/connected-v4",authority:"NONE",local:a,external:b})});t.after(()=>service.close());
 const html=await(await request(service.authority,"/")).text(),cap=/data-session="([0-9a-f]{64})"/.exec(html)[1],headers={Origin:`http://${service.authority}`,"Content-Type":"application/json","X-WorkHub-ACA-Session":cap};const response=await request(service.authority,"/api/observe",{method:"POST",headers,body:""});assert.equal(response.status,200);assert.equal((await response.json()).schema,"agent-change-assurance/connected-v4");assert.deepEqual(calls,["local","external:"+"9".repeat(64)]);assert.equal(response.headers.get("x-workhub-aca-admission"),"connected-v4-exact");
});

test("controller refusal channels never expose provider secrets, raw paths, or hostile diagnostics",async t=>{
 const local={schema:"agent-change-assurance/connected-v3",authority:"NONE",repository:{snapshotDigest:"9".repeat(64),parentCommit:"1".repeat(40),baseCommit:"2".repeat(40)},evaluatorSnapshot:{evidence:[]}};
 const service=await startFixtureQualificationController({localEngine:{observe:async()=>local},githubEngine:{observe:async()=>{throw new Error("token-canary /Users/private/provider-body")}},compose:()=>{throw new Error("unreachable")}});t.after(()=>service.close());
 const html=await(await request(service.authority,"/")).text(),cap=/data-session="([0-9a-f]{64})"/.exec(html)[1],headers={Origin:`http://${service.authority}`,"Content-Type":"application/json","X-WorkHub-ACA-Session":cap};const response=await request(service.authority,"/api/observe",{method:"POST",headers,body:""}),body=await response.text();assert.equal(response.status,500);assert.equal(body.includes("token-canary"),false);assert.equal(body.includes("/Users/private"),false);assert.deepEqual(JSON.parse(body),{code:"CONTROLLER_FAILURE",authority:"NONE"});
});

test("live startup failure after credential acquisition destroys transport and wipes retained token before listen",async t=>{
 const github={provider:"github-rest-v1",apiOrigin:"https://api.github.com",owner:"nousresearch",repository:"hermes-agent",pullNumber:7,apiVersion:"2022-11-28",credentialFd:9,permissionAttestation:"READ_ONLY_DECLARED",deadlines:{connectMs:1000,headerMs:2000,bodyMs:3000,overallMs:5000},limits:{perPage:100,maxPages:10,maxRows:1000,bodyBytes:1048576,aggregateBytes:8388608}};
 let reads=0,closes=0,destroys=0;const token=Buffer.from("fixture-secret");
 await assert.rejects(()=>productionHarness(t,{github,adapters:{acquireGithubCredential:async(_config,{readFd,closeFd})=>{reads++;await readFd(9);await closeFd(9);return token},readCredentialFd:async()=>Buffer.from("fixture-secret\n"),closeCredentialFd:async()=>{closes++},createGithubTransport:()=>({request:async()=>{},destroy(){destroys++;token.fill(0)}}),createGithubEngine:()=>({observe:async()=>{}}),createDurableJournal:async()=>{throw new Error("JOURNAL_STARTUP_FAILED")}}}),/JOURNAL_STARTUP_FAILED/);
 assert.equal(reads,1);assert.equal(closes,1);assert.equal(destroys,1);assert.equal(token.every(byte=>byte===0),true);
});

test("bind/listen failure destroys the initialized live connector and emits no service",async t=>{
 const github={provider:"github-rest-v1",apiOrigin:"https://api.github.com",owner:"nousresearch",repository:"hermes-agent",pullNumber:7,apiVersion:"2022-11-28",credentialFd:9,permissionAttestation:"READ_ONLY_DECLARED",deadlines:{connectMs:1000,headerMs:2000,bodyMs:3000,overallMs:5000},limits:{perPage:100,maxPages:10,maxRows:1000,bodyBytes:1048576,aggregateBytes:8388608}};
 let destroys=0;const token=Buffer.from("fixture-secret"),server=new EventEmitter();server.listen=()=>queueMicrotask(()=>server.emit("error",Object.assign(new Error("private-bind-path"),{code:"EADDRINUSE"})));server.close=callback=>callback?.();
 await assert.rejects(()=>productionHarness(t,{github,adapters:{acquireGithubCredential:async()=>token,createGithubTransport:()=>({request:async()=>{},destroy(){destroys++;token.fill(0)}}),createGithubEngine:()=>({observe:async()=>{}}),createHttpServer:()=>server}}),/EADDRINUSE|private-bind-path/);
 assert.equal(destroys,1);assert.equal(token.every(byte=>byte===0),true);
});

test("fixture controller retains settled v3 for bounded external refusal with no rows",async()=>{
 const local={schema:"agent-change-assurance/connected-v3",authority:"NONE",repository:{snapshotDigest:"9".repeat(64),parentCommit:"1".repeat(40),baseCommit:"2".repeat(40)},evaluatorSnapshot:{evidence:[]}};
 for(const code of ["PERMISSION_REFUSED","PAGINATION_REFUSED","REMOTE_SUBJECT_MOVED"]){const service=await startFixtureQualificationController({localEngine:{observe:async()=>local},githubEngine:{observe:async()=>{throw Object.assign(new Error(code),{code})}},compose:()=>{throw new Error("unreachable")}});const html=await(await request(service.authority,"/")).text(),cap=/data-session="([0-9a-f]{64})"/.exec(html)[1],headers={Origin:`http://${service.authority}`,"Content-Type":"application/json","X-WorkHub-ACA-Session":cap},response=await request(service.authority,"/api/observe",{method:"POST",headers,body:""}),body=await response.json();assert.equal(response.status,200);assert.equal(body.schema,"agent-change-assurance/external-unavailable-v1");assert.deepEqual(body.external,{availability:"UNAVAILABLE",subject:"UNKNOWN",lifecycle:"NOT_OBSERVED",outcome:"NOT_OBSERVED",reason:code,checkRuns:[],statuses:[],authority:"NONE"});assert.equal(body.local.schema,"agent-change-assurance/connected-v3");await service.close()}
});

test("fixture cancellation dominates a concurrent bounded provider refusal",async t=>{
 const local={schema:"agent-change-assurance/connected-v3",authority:"NONE",repository:{snapshotDigest:"9".repeat(64),parentCommit:"1".repeat(40),baseCommit:"2".repeat(40)},evaluatorSnapshot:{evidence:[]}};
 let composeCalls=0,entered;const atExternal=new Promise(resolve=>{entered=resolve});
 const service=await startFixtureQualificationController({localEngine:{observe:async()=>local},githubEngine:{observe:async({signal})=>{entered();await new Promise(resolve=>signal.addEventListener("abort",resolve,{once:true}));throw Object.assign(new Error("PERMISSION_REFUSED"),{code:"PERMISSION_REFUSED"})}},compose:()=>{composeCalls++;return{}}});t.after(()=>service.close());
 const html=await(await request(service.authority,"/")).text(),cap=/data-session="([0-9a-f]{64})"/.exec(html)[1],headers={Origin:`http://${service.authority}`,"Content-Type":"application/json","X-WorkHub-ACA-Session":cap};
 const pending=request(service.authority,"/api/observe",{method:"POST",headers,body:""});await atExternal;
 const cancelled=await request(service.authority,"/api/cancel",{method:"POST",headers,body:""});assert.equal(cancelled.status,200);
 const response=await pending,body=await response.text();assert.equal(response.status,500);assert.deepEqual(JSON.parse(body),{code:"CANCELLED",authority:"NONE"});assert.equal(body.includes("external-unavailable"),false);assert.equal(composeCalls,0);
});

// The production path must not settle external evidence for a cancelled generation even when a supplied
// engine ignores the abort and returns. The trusted tuple and both v4 composition seams are counted, so a
// missing fence is visible as a real call, not merely as a rendered response.
test("cancellation after the external engine returns refuses trusted tuple, v4 composition and any v4 response",async t=>{
 const github={provider:"github-rest-v1",apiOrigin:"https://api.github.com",owner:"nousresearch",repository:"hermes-agent",pullNumber:7,apiVersion:"2022-11-28",credentialFd:9,permissionAttestation:"READ_ONLY_DECLARED",deadlines:{connectMs:1000,headerMs:2000,bodyMs:3000,overallMs:5000},limits:{perPage:100,maxPages:10,maxRows:1000,bodyBytes:1048576,aggregateBytes:8388608}};
 const external={schema:"github-external-observation/v1",authority:"NONE",subject:"PARENT_COMMIT_ONLY",checkRuns:[],statuses:[]};
 let observed=0,tuples=0,composed=0,admitted=0,entered;const atExternal=new Promise(resolve=>{entered=resolve});
 const harness=await productionHarness(t,{github,adapters:{
  acquireGithubCredential:async()=>Buffer.from("fixture-secret"),
  createGithubTransport:()=>({request:async()=>{},destroy(){}}),
  createGithubEngine:()=>({observe:async({signal})=>{observed++;entered();await new Promise(resolve=>signal.addEventListener("abort",resolve,{once:true}));return external},trustedTuple:()=>{tuples++;return{}}}),
  createConnectedV4Envelope:()=>{composed++;return{schema:"agent-change-assurance/connected-v4",authority:"NONE"}},
  admitConnectedV4Envelope:()=>{admitted++;return{valid:true,envelope:{schema:"agent-change-assurance/connected-v4",authority:"NONE"}}},
 }});
 const service=harness.service,html=await(await request(service.authority,"/")).text(),cap=/data-session="([0-9a-f]{64})"/.exec(html)[1],headers={Origin:`http://${service.authority}`,"Content-Type":"application/json","X-WorkHub-ACA-Session":cap};
 const pending=request(service.authority,"/api/observe",{method:"POST",headers,body:""});
 await atExternal;
 const cancelled=await request(service.authority,"/api/cancel",{method:"POST",headers,body:""});
 assert.equal(cancelled.status,200);assert.deepEqual(await cancelled.json(),{state:"INDETERMINATE",reason:"CANCELLED",authority:"NONE"});
 const response=await pending,body=await response.text();
 assert.equal(response.status,500);assert.deepEqual(JSON.parse(body),{code:"CANCELLED",authority:"NONE"});assert.equal(body.includes("connected-v4"),false);
 assert.equal(observed,1);assert.equal(tuples,0,"no trusted tuple may be taken for a cancelled generation");assert.equal(composed,0);assert.equal(admitted,0);
});

// Cancellation also dominates a concurrent bounded provider refusal: a cancelled generation must not
// settle even the zero-row external-unavailable projection.
test("cancellation concurrent with external refusal returns CANCELLED, not external unavailable",async t=>{
 const github={provider:"github-rest-v1",apiOrigin:"https://api.github.com",owner:"nousresearch",repository:"hermes-agent",pullNumber:7,apiVersion:"2022-11-28",credentialFd:9,permissionAttestation:"READ_ONLY_DECLARED",deadlines:{connectMs:1000,headerMs:2000,bodyMs:3000,overallMs:5000},limits:{perPage:100,maxPages:10,maxRows:1000,bodyBytes:1048576,aggregateBytes:8388608}};
 let entered;const atExternal=new Promise(resolve=>{entered=resolve});
 const harness=await productionHarness(t,{github,adapters:{
  acquireGithubCredential:async()=>Buffer.from("fixture-secret"),createGithubTransport:()=>({request:async()=>{},destroy(){}}),
  createGithubEngine:()=>({observe:async({signal})=>{entered();await new Promise(resolve=>signal.addEventListener("abort",resolve,{once:true}));throw Object.assign(new Error("PERMISSION_REFUSED"),{code:"PERMISSION_REFUSED"})}}),
 }});
 const service=harness.service,html=await(await request(service.authority,"/")).text(),cap=/data-session="([0-9a-f]{64})"/.exec(html)[1],headers={Origin:`http://${service.authority}`,"Content-Type":"application/json","X-WorkHub-ACA-Session":cap};
 const pending=request(service.authority,"/api/observe",{method:"POST",headers,body:""});await atExternal;
 const cancelled=await request(service.authority,"/api/cancel",{method:"POST",headers,body:""});assert.equal(cancelled.status,200);
 const response=await pending,body=await response.text();assert.equal(response.status,500);assert.deepEqual(JSON.parse(body),{code:"CANCELLED",authority:"NONE"});assert.equal(body.includes("external-unavailable"),false);
});

test("local source movement refuses the whole observation without retaining v3",async t=>{
 const local={schema:"agent-change-assurance/connected-v3",authority:"NONE",repository:{snapshotDigest:"9".repeat(64),parentCommit:"1".repeat(40),baseCommit:"2".repeat(40)},evaluatorSnapshot:{evidence:[]}},code="LOCAL_SOURCE_MOVED",service=await startFixtureQualificationController({localEngine:{observe:async()=>local},githubEngine:{observe:async()=>{throw Object.assign(new Error(code),{code})}},compose:()=>{throw new Error("unreachable")}});t.after(()=>service.close());const html=await(await request(service.authority,"/")).text(),cap=/data-session="([0-9a-f]{64})"/.exec(html)[1],headers={Origin:`http://${service.authority}`,"Content-Type":"application/json","X-WorkHub-ACA-Session":cap},response=await request(service.authority,"/api/observe",{method:"POST",headers,body:""}),body=await response.json();assert.equal(response.status,500);assert.deepEqual(body,{code,authority:"NONE"});assert.equal(JSON.stringify(body).includes("connected-v3"),false);
});
