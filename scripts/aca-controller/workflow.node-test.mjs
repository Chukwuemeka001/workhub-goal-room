import test from "node:test";
import assert from "node:assert/strict";
import { githubObservationDigest, githubTrustedTuple } from "./github.mjs";
import { baseDiffDigest, createCheckReceipt, createConnectedV3Envelope, createConnectedV4Envelope } from "./receipt.mjs";
import { admitExactPrHandoff, createExactPrHandoff, exactPrHandoffDigest } from "./workflow.mjs";

const PARENT="1".repeat(40),BASE="2".repeat(40),PARENT_TREE="3".repeat(40),BASE_TREE="4".repeat(40),SNAPSHOT="5".repeat(64);
const meta={etag:'"v1"',requestId:"req",date:"Tue, 01 Sep 2026 00:00:00 GMT",rateRemaining:"99",rateUsed:"1",rateReset:"1788220800"};
const output={sha256:"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",observedBytes:0,preview:"",truncated:false,limitExceeded:false};
const github={provider:"github-rest-v1",apiVersion:"2022-11-28",owner:"nousresearch",repository:"hermes-agent",pullNumber:7,repositoryId:11,repositoryNodeId:"R_base",pullNodeId:"PR_node",head:{sha:PARENT,repositoryId:11,repositoryNodeId:"R_base",name:"hermes-agent",owner:"nousresearch"},base:{sha:BASE,repositoryId:11,repositoryNodeId:"R_base",name:"hermes-agent",owner:"nousresearch"}};

function connected({head=PARENT,htmlUrl="https://attacker.example/phish"}={}){
 const row={path:"src/a.ts",status:"M",oldMode:"100644",newMode:"100644",oldBlob:"a".repeat(40),newBlob:"b".repeat(40),additions:1,deletions:0,binary:false};
 const diffDigest=baseDiffDigest({baseCommit:BASE,baseTree:BASE_TREE,snapshotDigest:SNAPSHOT,rows:[row],additions:1,deletions:0});
 const receipt=checkId=>createCheckReceipt({attemptId:"attempt",checkId,snapshotDigest:SNAPSHOT,parentCommit:PARENT,parentTree:PARENT_TREE,baseCommit:BASE,baseTree:BASE_TREE,manifestDigest:"6".repeat(64),contentManifestDigest:"7".repeat(64),diffDigest,lockfile:{blobId:"8".repeat(40),bytes:10,digest:"9".repeat(64)},imageId:`sha256:${"a".repeat(64)}`,imageLabels:{contract:"aca-sandbox/v1",spec:"b".repeat(64)},verifierSpecDigest:"b".repeat(64),policyVersion:"aca-isolation-v1",startedAt:"2026-09-01T00:00:00.000Z",finishedAt:"2026-09-01T00:01:00.000Z",state:"PASS",reason:"CHECK_PASSED",execution:"RUN",commands:(checkId==="unit"?["unit-vitest"]:["build-typescript","build-vite"]).map(commandId=>({commandId,exitCode:0,signal:null,timeout:false,outputLimit:false,stdout:output,stderr:output})),cleanup:"CONFIRMED"});
 const local=createConnectedV3Envelope({repository:{displayName:"repo",snapshotDigest:SNAPSHOT,parentCommit:PARENT,parentTree:PARENT_TREE,baseCommit:BASE,baseTree:BASE_TREE,manifestDigest:"6".repeat(64),contentManifestDigest:"7".repeat(64),diffDigest,diffRows:[row],changedPaths:["src/a.ts"],additions:1,deletions:0},qualification:{status:"QUALIFIED",policyVersion:"aca-isolation-v1",imageId:`sha256:${"a".repeat(64)}`,verifierSpecDigest:"b".repeat(64)},receipts:[receipt("unit"),receipt("build")]});
 const externalBase={schema:"github-external-observation/v1",provider:"github-rest-v1",apiVersion:"2022-11-28",repositoryId:11,repositoryNodeId:"R_base",owner:"nousresearch",repository:"hermes-agent",pull:{id:44,nodeId:"PR_node",number:7,htmlUrl,state:"open",draft:false,head:{sha:head,repositoryId:11,repositoryNodeId:"R_base",name:"hermes-agent",owner:"nousresearch"},base:{sha:BASE,repositoryId:11,repositoryNodeId:"R_base",name:"hermes-agent",owner:"nousresearch"}},attemptId:"external-attempt",startedAt:"2026-09-01T00:02:00.000Z",finishedAt:"2026-09-01T00:03:00.000Z",metadata:{pr:[meta,meta],checkPages:[meta],statusPages:[meta]},pageCounts:{checks:1,statuses:1},checkRuns:[],statuses:[],coverage:{implemented:["PULL_REQUEST_IDENTITY","CHECK_RUNS","LEGACY_STATUSES"],notObserved:["ISSUE_SPECIFICATION","REQUIRED_CHECK_POLICY","CODEOWNERS","REVIEWS","ATTESTATIONS","DEPLOYMENT","ROLLBACK"]},availability:"AVAILABLE",subject:head===PARENT?"PARENT_COMMIT_ONLY":"REMOTE_HEAD_DIFFERS",lifecycle:"NOT_OBSERVED",outcome:"NOT_OBSERVED",aggregate:{passed:0,failed:0,pending:0,total:0},authority:"NONE"};
 const external=Object.freeze({...externalBase,observationDigest:githubObservationDigest(externalBase)}),tuple=githubTrustedTuple(external),v4=createConnectedV4Envelope({local,external,github:tuple});
 return{v4,tuple};
}

test("exact PR handoff is deterministic, immutable, tuple-bound and excludes hostile provider URLs",()=>{
 const {v4,tuple}=connected(),value=createExactPrHandoff({connected:v4,github:tuple});
 assert.equal(value.schema,"aca-exact-pr-handoff/v1");
 assert.equal(value.pull.url,"https://github.com/nousresearch/hermes-agent/pull/7");
 assert.equal(JSON.stringify(value).includes("attacker.example"),false);
 assert.deepEqual(value.repository,{id:11,nodeId:"R_base",owner:"nousresearch",name:"hermes-agent"});
 assert.equal(value.relationship.candidateRelation,"PARENT_COMMIT_ONLY");
 assert.equal(value.relationship.candidateCoverage,"NOT_LOCAL_DIRTY_SNAPSHOT");
 assert.equal(value.writebackEligibility,"BLOCKED_LOCAL_SNAPSHOT_NOT_REMOTE");
 assert.equal(value.authority,"NONE");assert.equal(value.effect,"NOT_ATTEMPTED");assert.equal(value.effectCapability,"ABSENT");assert.equal(value.writeAuthorization,"ABSENT");
 assert.equal(value.sourceEnvelopeDigest,v4.envelopeDigest);assert.equal(value.handoffDigest,exactPrHandoffDigest(value));
 assert.deepEqual(createExactPrHandoff({connected:v4,github:tuple}),value);
 assert.equal(Object.isFrozen(value),true);assert.equal(Object.isFrozen(value.pull),true);
 assert.throws(()=>{value.pull.number=8},TypeError);
 assert.deepEqual(admitExactPrHandoff(value,{connected:v4,github:tuple}),{valid:true,handoff:value,authority:"NONE"});
 for(const forbidden of ["verified by GitHub","approved","safe to merge","required checks passed","candidate covered","native GitHub check"])assert.equal(JSON.stringify(value).toLowerCase().includes(forbidden.toLowerCase()),false);
});

test("remote-head-differs handoff names both subjects and remains blocked",()=>{
 const {v4,tuple}=connected({head:"c".repeat(40)}),value=createExactPrHandoff({connected:v4,github:tuple});
 assert.equal(value.relationship.candidateRelation,"REMOTE_HEAD_DIFFERS");
 assert.match(value.summary,/PR head c{40} differs from local parent 1{40}/);
 assert.match(value.summary,/neither covers local dirty snapshot 5{64}/);
 assert.equal(value.routing.decision,"REQUEST_EVIDENCE");
 assert.equal(value.writebackEligibility,"BLOCKED_LOCAL_SNAPSHOT_NOT_REMOTE");
});

test("handoff admission refuses source, tuple, field and digest substitution",()=>{
 const {v4,tuple}=connected(),value=createExactPrHandoff({connected:v4,github:tuple});
 const attempts=[
  [{...value,authority:"MERGE"},{connected:v4,github:tuple}],
  [{...value,pull:{...value.pull,url:"https://attacker.example/phish"}},{connected:v4,github:tuple}],
  [{...value,relationship:{...value.relationship,candidateCoverage:"EXACT"}},{connected:v4,github:tuple}],
  [{...value,handoffDigest:"0".repeat(64)},{connected:v4,github:tuple}],
  [value,{connected:v4,github:{...tuple,pullNumber:8}}],
 ];
 for(const [candidate,expected] of attempts)assert.deepEqual(admitExactPrHandoff(candidate,expected),{valid:false,code:"INVALID_EXACT_PR_HANDOFF",authority:"NONE"});
 const other=connected({head:"c".repeat(40)});assert.deepEqual(admitExactPrHandoff(value,{connected:other.v4,github:other.tuple}),{valid:false,code:"INVALID_EXACT_PR_HANDOFF",authority:"NONE"});
});

test("handoff admission rejects accessors and Proxies without executing getters or traps",()=>{
 const {v4,tuple}=connected(),value=createExactPrHandoff({connected:v4,github:tuple});
 let getterHits=0;const accessor=structuredClone(value);Object.defineProperty(accessor,"handoffDigest",{enumerable:true,configurable:true,get(){getterHits++;return value.handoffDigest}});
 assert.equal(admitExactPrHandoff(accessor,{connected:v4,github:tuple}).valid,false);assert.equal(getterHits,0,"closed admission must not execute accessors");
 let proxyTraps=0;const traps={get(target,key,receiver){proxyTraps++;return Reflect.get(target,key,receiver)},ownKeys(target){proxyTraps++;return Reflect.ownKeys(target)},getOwnPropertyDescriptor(target,key){proxyTraps++;return Reflect.getOwnPropertyDescriptor(target,key)}};
 const proxy=new Proxy(structuredClone(value),traps);assert.equal(admitExactPrHandoff(proxy,{connected:v4,github:tuple}).valid,false);assert.equal(proxyTraps,0,"closed admission must reject a Proxy before invoking traps");
 const nested=structuredClone(value);nested.repository=new Proxy(nested.repository,traps);assert.equal(admitExactPrHandoff(nested,{connected:v4,github:tuple}).valid,false);assert.equal(proxyTraps,0,"nested Proxy refusal must not invoke traps");
 const expando=structuredClone(v4);expando.external.checkRuns.extra=1;assert.equal(admitExactPrHandoff(value,{connected:expando,github:tuple}).valid,false,"array expando properties must be refused even though JSON serialization drops them");
});
