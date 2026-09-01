import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { admitConnectedV4Envelope, baseDiffDigest, createCheckReceipt, createConnectedV3Envelope, createConnectedV4Envelope, receiptDigest } from "./receipt.mjs";

const d = value => value.repeat(64).slice(0, 64);
const output = Object.freeze({ sha256: d("9"), observedBytes: 2, preview: "ok", truncated: false, limitExceeded: false });
const diffRows = Object.freeze([{ path: "src/a.ts", status: "M", oldMode: "100644", newMode: "100644", oldBlob: "6".repeat(40), newBlob: "7".repeat(40), additions: 1, deletions: 0, binary: false }]);
const binding = Object.freeze({
  attemptId: "attempt",
  snapshotDigest: d("a"),
  parentCommit: "1".repeat(40),
  parentTree: "2".repeat(40),
  baseCommit: "3".repeat(40),
  baseTree: "4".repeat(40),
  manifestDigest: d("b"),
  contentManifestDigest: d("c"),
  diffDigest: baseDiffDigest({ baseCommit: "3".repeat(40), baseTree: "4".repeat(40), snapshotDigest: d("a"), rows: diffRows, additions: 1, deletions: 0 }),
  lockfile: { blobId: "5".repeat(40), bytes: 10, digest: d("e") },
  imageId: `sha256:${d("f")}`,
  imageLabels: { contract: "aca-sandbox/v1", spec: d("8") },
  verifierSpecDigest: d("8"),
  policyVersion: "aca-isolation-v1",
});
const command = (commandId, patch = {}) => ({ commandId, exitCode: 0, signal: null, timeout: false, outputLimit: false, stdout: output, stderr: output, ...patch });
const receipt = (checkId, state = "PASS") => createCheckReceipt({
  ...binding,
  checkId,
  startedAt: "2026-09-01T00:00:00.000Z",
  finishedAt: "2026-09-01T00:00:01.000Z",
  state,
  reason: state === "PASS" ? "CHECK_PASSED" : state === "FAIL" ? "CHECK_FAILED" : "TIMEOUT",
  execution: "RUN",
  commands: checkId === "unit"
    ? [command("unit-vitest", state === "FAIL" ? { exitCode: 1 } : state === "INDETERMINATE" ? { exitCode: null, timeout: true } : {})]
    : [command("build-typescript", state === "FAIL" ? { exitCode: 1 } : state === "INDETERMINATE" ? { exitCode: null, timeout: true } : {}), command("build-vite")],
  cleanup: "CONFIRMED",
});
const envelope = (unitState = "PASS", buildState = "PASS") => createConnectedV3Envelope({
  repository: { displayName: "repo", snapshotDigest: binding.snapshotDigest, parentCommit: binding.parentCommit, parentTree: binding.parentTree, baseCommit: binding.baseCommit, baseTree: binding.baseTree, manifestDigest: binding.manifestDigest, contentManifestDigest: binding.contentManifestDigest, diffDigest: binding.diffDigest, diffRows, changedPaths: ["src/a.ts"], additions: 1, deletions: 0 },
  qualification: { status: "QUALIFIED", policyVersion: binding.policyVersion, imageId: binding.imageId, verifierSpecDigest: binding.verifierSpecDigest },
  receipts: [receipt("unit", unitState), receipt("build", buildState)],
});
const observationDigest=value=>{const canonical=input=>Array.isArray(input)?input.map(canonical):input&&typeof input==="object"&&Object.getPrototypeOf(input)===Object.prototype?Object.fromEntries(Object.keys(input).filter(key=>key!=="observationDigest"&&input[key]!==undefined).sort().map(key=>[key,canonical(input[key])])):input;return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")};
const externalObservation=({head=binding.parentCommit,base=binding.baseCommit,checkRuns=[{runId:1,headSha:head,outcome:"ALL_SUCCESS",lifecycle:"TERMINAL"}],statuses=[],aggregate={passed:1,failed:0,pending:0,total:1}}={})=>{const normalizedChecks=checkRuns.map((row,index)=>({runId:row.runId,nodeId:`CR_${row.runId}`,suiteId:20,appId:30+index,appSlug:"actions",name:"build",headSha:row.headSha,status:row.lifecycle==="PENDING"?"in_progress":"completed",conclusion:row.lifecycle==="PENDING"?null:row.outcome==="ALL_SUCCESS"?"success":row.outcome==="HAS_FAILURE"?"failure":"neutral",startedAt:"2026-09-01T00:00:00Z",completedAt:row.lifecycle==="PENDING"?null:"2026-09-01T00:01:00Z",detailsUrl:"https://github.com/nousresearch/hermes-agent/actions/runs/1",externalId:null,lifecycle:row.lifecycle,outcome:row.outcome})),normalizedStatuses=statuses.map((row,index)=>({statusId:row.statusId??100+index,creatorId:60+index,creatorLogin:"bot",context:`ci/${index}`,subjectSha:row.subjectSha??head,state:row.lifecycle==="PENDING"?"pending":row.outcome==="ALL_SUCCESS"?"success":"failure",targetUrl:"https://example.test/build",description:"ok",createdAt:"2026-09-01T00:00:00Z",updatedAt:"2026-09-01T00:01:00Z",lifecycle:row.lifecycle,outcome:row.outcome})),all=[...normalizedChecks,...normalizedStatuses],lifecycle=!all.length?"NOT_OBSERVED":all.every(row=>row.lifecycle==="TERMINAL")?"TERMINAL":all.every(row=>row.lifecycle==="PENDING")?"PENDING":"MIXED",outcome=!all.length?"NOT_OBSERVED":aggregate.failed?"HAS_FAILURE":all.every(row=>row.outcome==="ALL_SUCCESS")?"ALL_SUCCESS":"NO_FAILURE_OBSERVED",side=(sha)=>({sha,repositoryId:11,repositoryNodeId:"R_base",name:"hermes-agent",owner:"nousresearch"}),meta={etag:'"v1"',requestId:"req",date:"Tue, 01 Sep 2026 00:00:00 GMT",rateRemaining:"99",rateUsed:"1",rateReset:"1788220800"},value={schema:"github-external-observation/v1",provider:"github-rest-v1",apiVersion:"2022-11-28",repositoryId:11,repositoryNodeId:"R_base",owner:"nousresearch",repository:"hermes-agent",pull:{id:44,nodeId:"PR_node",number:7,htmlUrl:"https://github.com/nousresearch/hermes-agent/pull/7",state:"open",draft:false,head:side(head),base:side(base)},attemptId:"receipt-fixture",startedAt:"2026-09-01T00:00:00.000Z",finishedAt:"2026-09-01T00:00:01.000Z",metadata:{pr:[meta,meta],checkPages:[meta],statusPages:[meta]},pageCounts:{checks:1,statuses:1},authority:"NONE",availability:"AVAILABLE",subject:head===binding.parentCommit?"PARENT_COMMIT_ONLY":"REMOTE_HEAD_DIFFERS",checkRuns:normalizedChecks,statuses:normalizedStatuses,aggregate,lifecycle,outcome,coverage:{implemented:["PULL_REQUEST_IDENTITY","CHECK_RUNS","LEGACY_STATUSES"],notObserved:["ISSUE_SPECIFICATION","REQUIRED_CHECK_POLICY","CODEOWNERS","REVIEWS","ATTESTATIONS","DEPLOYMENT","ROLLBACK"]}};return{...value,observationDigest:observationDigest(value)}};
const trustedGithub=external=>({provider:external.provider,apiVersion:external.apiVersion,owner:external.owner,repository:external.repository,pullNumber:external.pull.number,repositoryId:external.repositoryId,repositoryNodeId:external.repositoryNodeId,pullNodeId:external.pull.nodeId,head:structuredClone(external.pull.head),base:structuredClone(external.pull.base)});

test("exactly two fixed receipts derive aggregate and non-independent local_tool evidence", () => {
  const value = envelope();
  assert.equal(value.aggregate.complete, true);
  assert.deepEqual(value.evaluatorSnapshot.evidence.map(row => [row.kind, row.status, row.producer, row.independent]), [["unit", "PASS", "local_tool", false], ["build", "PASS", "local_tool", false]]);
  assert.deepEqual(value.receipts.map(row => row.checkId), ["unit", "build"]);
});

test("envelope refuses a fully re-digested repository or qualification authority mutation", () => {
  const unit = receipt("unit");
  const build = receipt("build");
  const repository = { displayName: "repo", snapshotDigest: binding.snapshotDigest, parentCommit: binding.parentCommit, parentTree: binding.parentTree, baseCommit: binding.baseCommit, baseTree: binding.baseTree, manifestDigest: binding.manifestDigest, contentManifestDigest: binding.contentManifestDigest, diffDigest: binding.diffDigest, diffRows, changedPaths: ["src/a.ts"], additions: 1, deletions: 0 };
  const qualification = { status: "QUALIFIED", policyVersion: binding.policyVersion, imageId: binding.imageId, verifierSpecDigest: binding.verifierSpecDigest };
  for (const [name, mutatedRepository, mutatedQualification] of [
    ["snapshot", { ...repository, snapshotDigest: "0".repeat(64) }, qualification],
    ["base", { ...repository, baseCommit: "6".repeat(40), baseTree: "7".repeat(40) }, qualification],
    ["image", repository, { ...qualification, imageId: `sha256:${"0".repeat(64)}` }],
    ["spec", repository, { ...qualification, verifierSpecDigest: "0".repeat(64) }],
  ]) assert.throws(() => createConnectedV3Envelope({ repository: mutatedRepository, qualification: mutatedQualification, receipts: [unit, build] }), /RECEIPT_REFUSED/, name);
});

test("receipt rejects impossible state/exit/cleanup/order and private path preview", () => {
  const base = { ...receipt("unit"), receiptDigest: undefined };
  for (const patch of [
    { cleanup: "UNRESOLVED" },
    { commands: [command("unit-vitest", { exitCode: 1 })] },
    { commands: [command("wrong")] },
    { commands: [command("unit-vitest", { stdout: { ...output, preview: "/Users/private/secret" } })] },
  ]) assert.throws(() => createCheckReceipt({ ...base, ...patch }), /RECEIPT_REFUSED/);
});

test("all 3x3 unit/build states use completed PASS-or-FAIL evidence completeness and exact honest sentences", () => {
  for (const unitState of ["PASS", "FAIL", "INDETERMINATE"]) {
    for (const buildState of ["PASS", "FAIL", "INDETERMINATE"]) {
      const value = envelope(unitState, buildState);
      const expectedPass = [unitState, buildState].filter(state => state === "PASS").length;
      const expectedFail = [unitState, buildState].filter(state => state === "FAIL").length;
      assert.deepEqual([value.aggregate.passed, value.aggregate.failed, value.aggregate.indeterminate], [expectedPass, expectedFail, 2 - expectedPass - expectedFail]);
      const expectedIndeterminate=2-expectedPass-expectedFail,completed=expectedPass+expectedFail,completeness=completed===2?"complete":completed===1?"partial":"absent";
      assert.equal(value.aggregate.complete, completed === 2);
      assert.equal(value.aggregate.sentence,`${expectedPass} of 2 required checks passed; ${expectedFail} failed; ${expectedIndeterminate} indeterminate; executable evidence is ${completeness}; ${expectedIndeterminate?"missing/indeterminate requirements remain":"no missing/indeterminate requirements"}.`);
      assert.deepEqual(value.evaluatorSnapshot.evidence.map(row => row.status), [unitState, buildState].filter(state => state !== "INDETERMINATE"));
    }
  }
});

test("one closed infrastructure taxonomy admits every exact RUN/NOT_RUN terminal combination and rejects cross-products",()=>{
 const cases=[
  ["TIMEOUT","RUN","CONFIRMED",{timeout:true}],
  ["CANCELLED","RUN","CONFIRMED",{}],["CANCELLED","NOT_RUN","CONFIRMED",{}],
  ["OUTPUT_LIMIT","RUN","CONFIRMED",{outputLimit:true}],
  ["RUNNER_INFRASTRUCTURE","RUN","CONFIRMED",{}],
  ["DOCKER_FAILURE","RUN","CONFIRMED",{}],["DOCKER_FAILURE","NOT_RUN","CONFIRMED",{}],
  ["SOURCE_MOVED","RUN","CONFIRMED",{}],["SOURCE_MOVED","NOT_RUN","CONFIRMED",{}],
  ["CLEANUP_UNRESOLVED","RUN","UNRESOLVED",{}],["CLEANUP_UNRESOLVED","NOT_RUN","UNRESOLVED",{}],
  ["IMAGE_POLICY_MISMATCH","RUN","CONFIRMED",{}],["IMAGE_POLICY_MISMATCH","NOT_RUN","CONFIRMED",{}],
 ];
 for(const[reason,execution,cleanup,flags]of cases){const commands=[command("unit-vitest",{exitCode:null,...flags})];assert.doesNotThrow(()=>createCheckReceipt({...binding,checkId:"unit",startedAt:"2026-09-01T00:00:00.000Z",finishedAt:"2026-09-01T00:00:01.000Z",state:"INDETERMINATE",reason,execution,commands,cleanup}),`${reason}/${execution}`);}
 for(const bad of [
  {reason:"TIMEOUT",execution:"NOT_RUN",cleanup:"CONFIRMED",flags:{}},
  {reason:"OUTPUT_LIMIT",execution:"NOT_RUN",cleanup:"CONFIRMED",flags:{outputLimit:true}},
  {reason:"CLEANUP_UNRESOLVED",execution:"RUN",cleanup:"CONFIRMED",flags:{}},
  {reason:"DOCKER_FAILURE",execution:"RUN",cleanup:"UNRESOLVED",flags:{}},
 ])assert.throws(()=>createCheckReceipt({...binding,checkId:"unit",startedAt:"2026-09-01T00:00:00.000Z",finishedAt:"2026-09-01T00:00:01.000Z",state:"INDETERMINATE",reason:bad.reason,execution:bad.execution,commands:[command("unit-vitest",{exitCode:null,...bad.flags})],cleanup:bad.cleanup}),/RECEIPT_REFUSED/);
});

test("connected-v4 composes and re-admits v3 with parent-only external rows, zero candidate evidence and monotonic routing",()=>{
 const v3=envelope();
 const external=externalObservation();
 const github=trustedGithub(external),v4=createConnectedV4Envelope({local:v3,external,github});
 assert.equal(v4.schema,"agent-change-assurance/connected-v4");assert.equal(v4.relationships.candidateRelation,"PARENT_COMMIT_ONLY");assert.equal(v4.routing.decision,"REQUEST_EVIDENCE");assert.deepEqual(v4.evaluatorSnapshot.evidence,v3.evaluatorSnapshot.evidence);assert.equal(v4.externalCandidateEvidence.length,0);assert.equal(v4.authority,"NONE");
 assert.equal(admitConnectedV4Envelope(v4,github).valid,true);
 for(const mutate of [x=>x.authority="MERGE",x=>x.routing.decision="FAST_TRACK",x=>x.externalCandidateEvidence.push({}),x=>x.relationships.candidateRelation="CLEAN_COMMIT_EXACT",x=>x.external.checkRuns[0].required=true]){const copy=structuredClone(v4);mutate(copy);copy.envelopeDigest="0".repeat(64);assert.equal(admitConnectedV4Envelope(copy,github).valid,false)}
});

test("connected-v4 derives exact/different base and head relationships while routing never lowers or fast-tracks",()=>{
 const otherHead="6".repeat(40),otherBase="7".repeat(40);
 for(const [head,base,expected] of [[binding.parentCommit,binding.baseCommit,["EXACT_LOCAL_BASE","EXACT_LOCAL_PARENT","PARENT_COMMIT_ONLY"]],[binding.parentCommit,otherBase,["DIFFERENT","EXACT_LOCAL_PARENT","PARENT_COMMIT_ONLY"]],[otherHead,binding.baseCommit,["EXACT_LOCAL_BASE","DIFFERENT","REMOTE_HEAD_DIFFERS"]],[otherHead,otherBase,["DIFFERENT","DIFFERENT","REMOTE_HEAD_DIFFERS"]]]){
  const local=envelope();const external=externalObservation({head,base,checkRuns:[{runId:1,headSha:head,outcome:"ALL_SUCCESS",lifecycle:"TERMINAL"}]});
  const github=trustedGithub(external),v4=createConnectedV4Envelope({local,external,github});assert.deepEqual(Object.values(v4.relationships),expected);assert.equal(v4.routing.decision,"REQUEST_EVIDENCE");assert.equal(v4.externalCandidateEvidence.length,0);assert.equal(admitConnectedV4Envelope(v4,github).valid,true);
 }
 const emptyExternal=externalObservation({head:otherHead,base:otherBase,checkRuns:[],aggregate:{passed:0,failed:0,pending:0,total:0}}),escalated=createConnectedV4Envelope({local:envelope("FAIL","PASS"),external:emptyExternal,github:trustedGithub(emptyExternal)});assert.equal(escalated.routing.decision,"ESCALATE");assert.notEqual(escalated.routing.decision,"FAST_TRACK");
});

test("connected-v4 refuses a synchronized fully re-digested aggregate substitution",()=>{
 const external=externalObservation(),github=trustedGithub(external),value=createConnectedV4Envelope({local:envelope(),external,github}),copy=structuredClone(value);copy.external.aggregate={passed:0,failed:1,pending:0,total:1};copy.external.outcome="HAS_FAILURE";copy.external.observationDigest=observationDigest(copy.external);copy.externalAggregate=copy.external.aggregate;copy.routing={decision:"ESCALATE",reason:"EXTERNAL_FAILURE_OBSERVED"};copy.envelopeDigest=receiptDigest(copy);assert.equal(admitConnectedV4Envelope(copy,github).valid,false);
});

test("connected-v4 refuses synchronized coordinate, repository and subject substitution against retained tuple",()=>{
 const external=externalObservation(),github=trustedGithub(external),value=createConnectedV4Envelope({local:envelope(),external,github});
 for(const mutate of [x=>{x.owner="attacker";x.repository="substitute";x.pull.number=999},x=>{x.repositoryId=999;x.pull.base.repositoryId=999},x=>{x.pull.head.sha="9".repeat(40);x.checkRuns[0].headSha=x.pull.head.sha;x.subject="REMOTE_HEAD_DIFFERS"}]){const copy=structuredClone(value);mutate(copy.external);copy.external.observationDigest=observationDigest(copy.external);copy.envelopeDigest=receiptDigest(copy);assert.equal(admitConnectedV4Envelope(copy,github).valid,false)}
});
