import { createHash } from "node:crypto";
import { admitGithubObservation } from "./github.mjs";

const DIGEST = /^[0-9a-f]{64}$/;
const IMAGE = /^sha256:[0-9a-f]{64}$/;
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const CHECK_COMMANDS = Object.freeze({ unit: ["unit-vitest"], build: ["build-typescript", "build-vite"] });
export const RECEIPT_TAXONOMY = Object.freeze({
  TIMEOUT: Object.freeze({ executions: Object.freeze(["RUN"]), cleanup: "CONFIRMED", flag: "timeout" }),
  CANCELLED: Object.freeze({ executions: Object.freeze(["RUN", "NOT_RUN"]), cleanup: "CONFIRMED" }),
  OUTPUT_LIMIT: Object.freeze({ executions: Object.freeze(["RUN"]), cleanup: "CONFIRMED", flag: "outputLimit" }),
  RUNNER_INFRASTRUCTURE: Object.freeze({ executions: Object.freeze(["RUN"]), cleanup: "CONFIRMED" }),
  DOCKER_FAILURE: Object.freeze({ executions: Object.freeze(["RUN", "NOT_RUN"]), cleanup: "CONFIRMED" }),
  SOURCE_MOVED: Object.freeze({ executions: Object.freeze(["RUN", "NOT_RUN"]), cleanup: "CONFIRMED" }),
  CLEANUP_UNRESOLVED: Object.freeze({ executions: Object.freeze(["RUN", "NOT_RUN"]), cleanup: "UNRESOLVED" }),
  IMAGE_POLICY_MISMATCH: Object.freeze({ executions: Object.freeze(["RUN", "NOT_RUN"]), cleanup: "CONFIRMED" }),
});
const fail = () => { throw new Error("RECEIPT_REFUSED"); };
const plain = value => value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const deepFreeze = value => { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; };
const canonical = value => Array.isArray(value)
  ? value.map(canonical)
  : plain(value)
    ? Object.fromEntries(Object.keys(value).filter(key => value[key] !== undefined && key !== "receiptDigest" && key !== "envelopeDigest").sort().map(key => [key, canonical(value[key])]))
    : value;
export const receiptDigest = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export const baseDiffDigest = ({ baseCommit, baseTree, snapshotDigest, rows, additions, deletions }) => createHash("sha256").update(JSON.stringify(canonical({ schema: "aca-base-snapshot-diff/v2", baseCommit, baseTree, snapshotDigest, rows, additions, deletions }))).digest("hex");
const privatePath = value => /\/(?:Users|home)\/|[A-Za-z]:\\|file:\/\//.test(value);
const outputOk = value => exact(value, ["sha256", "observedBytes", "preview", "truncated", "limitExceeded"]) && DIGEST.test(value.sha256) && Number.isSafeInteger(value.observedBytes) && value.observedBytes >= 0 && typeof value.preview === "string" && Buffer.byteLength(value.preview) <= 4096 && typeof value.truncated === "boolean" && typeof value.limitExceeded === "boolean" && !privatePath(value.preview);

export function createCheckReceipt(input) {
  const ids = CHECK_COMMANDS[input?.checkId];
  const inputKeys = ["attemptId", "checkId", "snapshotDigest", "parentCommit", "parentTree", "baseCommit", "baseTree", "manifestDigest", "contentManifestDigest", "diffDigest", "lockfile", "imageId", "imageLabels", "verifierSpecDigest", "policyVersion", "startedAt", "finishedAt", "state", "reason", "execution", "commands", "cleanup"];
  if (!exact(input, inputKeys) || !ids || typeof input.attemptId !== "string" || Buffer.byteLength(input.attemptId) > 128 || !DIGEST.test(input.snapshotDigest)
    || ![input.parentCommit, input.parentTree, input.baseCommit, input.baseTree].every(value => SHA.test(value))
    || ![input.manifestDigest, input.contentManifestDigest, input.diffDigest, input.verifierSpecDigest, input.lockfile?.digest].every(value => DIGEST.test(value))
    || !exact(input.lockfile, ["blobId", "bytes", "digest"]) || !SHA.test(input.lockfile?.blobId) || !Number.isSafeInteger(input.lockfile?.bytes) || input.lockfile.bytes < 0 || !IMAGE.test(input.imageId)
    || !exact(input.imageLabels, ["contract", "spec"]) || input.imageLabels.contract !== "aca-sandbox/v1" || input.imageLabels.spec !== input.verifierSpecDigest
    || input.policyVersion !== "aca-isolation-v1" || !Number.isFinite(Date.parse(input.startedAt)) || !Number.isFinite(Date.parse(input.finishedAt)) || Date.parse(input.finishedAt) < Date.parse(input.startedAt)
    || !Array.isArray(input.commands) || input.commands.length !== ids.length || !["CONFIRMED", "UNRESOLVED"].includes(input.cleanup) || !["RUN", "NOT_RUN"].includes(input.execution) || !["PASS", "FAIL", "INDETERMINATE"].includes(input.state)) fail();

  let failed = false;
  let infrastructure = false;
  for (let index = 0; index < ids.length; index++) {
    const command = input.commands[index];
    if (!exact(command, ["commandId", "exitCode", "signal", "timeout", "outputLimit", "stdout", "stderr"]) || command.commandId !== ids[index] || !(command.exitCode === null || Number.isSafeInteger(command.exitCode)) || !(command.signal === null || typeof command.signal === "string")
      || typeof command.timeout !== "boolean" || typeof command.outputLimit !== "boolean" || !outputOk(command.stdout) || !outputOk(command.stderr)) fail();
    failed ||= (command.exitCode !== null && command.exitCode !== 0) || command.signal !== null;
    infrastructure ||= command.timeout || command.outputLimit;
  }
  const terminal = RECEIPT_TAXONOMY[input.reason];
  const coherent = input.state === "PASS"
    ? input.reason === "CHECK_PASSED" && input.execution === "RUN" && input.cleanup === "CONFIRMED" && !failed && !infrastructure && input.commands.every(command => command.exitCode === 0 && command.signal === null)
    : input.state === "FAIL"
      ? input.reason === "CHECK_FAILED" && input.execution === "RUN" && input.cleanup === "CONFIRMED" && failed && !infrastructure
      : terminal && terminal.executions.includes(input.execution) && input.cleanup === terminal.cleanup
        && (terminal.flag ? input.commands.some(command => command[terminal.flag] === true) : !infrastructure)
        && (input.execution !== "NOT_RUN" || input.commands.every(command => command.exitCode === null && command.signal === null));
  if (!coherent) fail();
  const value = { schema: "aca-check-receipt/v1", ...input };
  return Object.freeze({ ...value, receiptDigest: receiptDigest(value) });
}

export function createConnectedV3Envelope(input) {
  const repositoryKeys = ["displayName", "snapshotDigest", "parentCommit", "parentTree", "baseCommit", "baseTree", "manifestDigest", "contentManifestDigest", "diffDigest", "diffRows", "changedPaths", "additions", "deletions"];
  if (!exact(input, ["repository", "qualification", "receipts"]) || !exact(input.repository, repositoryKeys) || !exact(input.qualification, ["status", "policyVersion", "imageId", "verifierSpecDigest"]) || input.qualification.status !== "QUALIFIED" || !Array.isArray(input.receipts) || input.receipts.length !== 2
    || !Array.isArray(input.repository.diffRows) || input.repository.diffRows.length !== input.repository.changedPaths.length || input.repository.diffRows.some((row, index) => !exact(row, ["path", "status", "oldMode", "newMode", "oldBlob", "newBlob", "additions", "deletions", "binary"]) || row.path !== input.repository.changedPaths[index] || !["A", "D", "M"].includes(row.status) || ![row.oldMode, row.newMode].every(mode => /^(?:000000|100644|100755)$/.test(mode)) || !(row.oldBlob === null || SHA.test(row.oldBlob)) || !(row.newBlob === null || SHA.test(row.newBlob)) || !Number.isSafeInteger(row.additions) || row.additions < 0 || !Number.isSafeInteger(row.deletions) || row.deletions < 0 || typeof row.binary !== "boolean" || (row.binary && (row.additions !== 0 || row.deletions !== 0)))
    || input.repository.additions !== input.repository.diffRows.reduce((sum, row) => sum + row.additions, 0) || input.repository.deletions !== input.repository.diffRows.reduce((sum, row) => sum + row.deletions, 0)
    || input.repository.diffDigest !== baseDiffDigest({ baseCommit: input.repository.baseCommit, baseTree: input.repository.baseTree, snapshotDigest: input.repository.snapshotDigest, rows: input.repository.diffRows, additions: input.repository.additions, deletions: input.repository.deletions })
    || input.receipts[0].checkId !== "unit" || input.receipts[1].checkId !== "build" || input.receipts.some((receipt, index) => receipt.receiptDigest !== receiptDigest(receipt) || receipt.attemptId !== input.receipts[0].attemptId || (index && receipt.snapshotDigest !== input.receipts[0].snapshotDigest)
      || [["snapshotDigest", "snapshotDigest"], ["parentCommit", "parentCommit"], ["parentTree", "parentTree"], ["baseCommit", "baseCommit"], ["baseTree", "baseTree"], ["manifestDigest", "manifestDigest"], ["contentManifestDigest", "contentManifestDigest"], ["diffDigest", "diffDigest"]].some(([repositoryKey, receiptKey]) => input.repository[repositoryKey] !== receipt[receiptKey])
      || [["policyVersion", "policyVersion"], ["imageId", "imageId"], ["verifierSpecDigest", "verifierSpecDigest"]].some(([qualificationKey, receiptKey]) => input.qualification[qualificationKey] !== receipt[receiptKey]))) fail();
  const receipts = input.receipts;
  const passed = receipts.filter(receipt => receipt.state === "PASS").length;
  const failed = receipts.filter(receipt => receipt.state === "FAIL").length;
  const indeterminate = 2 - passed - failed;
  const completed = passed + failed;
  const completeness = completed === 2 ? "complete" : completed === 1 ? "partial" : "absent";
  const aggregate = {
    passed,
    failed,
    indeterminate,
    complete: completed === 2,
    sentence: `${passed} of 2 required checks passed; ${failed} failed; ${indeterminate} indeterminate; executable evidence is ${completeness}; ${indeterminate ? "missing/indeterminate requirements remain" : "no missing/indeterminate requirements"}.`,
  };
  const evidence = receipts.filter(receipt => receipt.state === "PASS" || receipt.state === "FAIL").map(receipt => ({ kind: receipt.checkId, subjectSha: receipt.snapshotDigest, status: receipt.state, producer: "local_tool", independent: false }));
  const repository = input.repository;
  const evaluatorSnapshot = { schemaVersion: "agent-change-assurance/v1", provenance: { label: "Qualified local Docker sandbox" }, repository: repository.displayName, expectedCandidateSha: repository.snapshotDigest, reviewedCandidateSha: repository.snapshotDigest, baseSha: repository.baseCommit, changedPaths: repository.changedPaths, additions: repository.additions, deletions: repository.deletions, claims: [], evidence, requiredEvidenceKinds: ["unit", "build"] };
  const value = { schema: "agent-change-assurance/connected-v3", mode: "CONNECTED_LOCAL", repositoryIdentityBasis: "CUMULATIVE_DIRTY_SNAPSHOT", claimBasis: "NOT_OBSERVED", evidenceBasis: "QUALIFIED_LOCAL_SANDBOX", authority: "NONE", repository, qualification: input.qualification, receipts, checks: receipts.map(receipt => ({ checkId: receipt.checkId, state: receipt.state, reason: receipt.reason, execution: receipt.execution, receiptDigest: receipt.receiptDigest })), aggregate, evaluatorSnapshot, githubCi: "NOT_OBSERVED_BY_THIS_LOCAL_VERIFIER" };
  return Object.freeze({ ...value, envelopeDigest: receiptDigest(value) });
}

export function admitConnectedV3Envelope(input, expected = undefined) {
  try {
    if (!plain(input) || input.schema !== "agent-change-assurance/connected-v3" || !Array.isArray(input.receipts) || input.receipts.length !== 2) fail();
    const receipts = input.receipts.map(receipt => {
      const { schema, receiptDigest: suppliedDigest, ...body } = receipt;
      if (schema !== "aca-check-receipt/v1") fail();
      const rebuilt = createCheckReceipt(body);
      if (suppliedDigest !== rebuilt.receiptDigest || JSON.stringify(receipt) !== JSON.stringify(rebuilt)) fail();
      return rebuilt;
    });
    const rebuilt = createConnectedV3Envelope({ repository: input.repository, qualification: input.qualification, receipts });
    if (JSON.stringify(input) !== JSON.stringify(rebuilt)) fail();
    if (expected && (!exact(expected, ["repository", "qualification", "lockfile"])
      || ["snapshotDigest", "parentCommit", "parentTree", "baseCommit", "baseTree", "manifestDigest", "contentManifestDigest", "diffDigest"].some(key => rebuilt.repository[key] !== expected.repository[key])
      || ["policyVersion", "imageId", "verifierSpecDigest"].some(key => rebuilt.qualification[key] !== expected.qualification[key])
      || rebuilt.receipts.some(receipt => JSON.stringify(receipt.lockfile) !== JSON.stringify(expected.lockfile)))) fail();
    return Object.freeze({ valid: true, envelope: rebuilt });
  } catch {
    return Object.freeze({ valid: false, code: "INVALID_CONNECTED_OBSERVATION", authority: "NONE" });
  }
}

export function createConnectedV4Envelope(input) {
  if (!exact(input, ["local", "external", "github"])) fail();
  const localAdmission = admitConnectedV3Envelope(input.local); if (!localAdmission.valid) fail();
  const local = localAdmission.envelope, external = structuredClone(input.external);
  const github=structuredClone(input.github);if(!exact(github,["provider","apiVersion","owner","repository","pullNumber","repositoryId","repositoryNodeId","pullNodeId","head","base"]))fail();
  const externalAdmission=admitGithubObservation(external,{local:{snapshotDigest:local.repository.snapshotDigest,parentCommit:local.repository.parentCommit,baseCommit:local.repository.baseCommit,trackedState:"DIRTY"},config:github,trusted:github});if(!externalAdmission.valid)fail();
  const remoteHeadRelation=external.pull?.head?.sha===local.repository.parentCommit?"EXACT_LOCAL_PARENT":"DIFFERENT",remoteBaseRelation=external.pull?.base?.sha===local.repository.baseCommit?"EXACT_LOCAL_BASE":"DIFFERENT",candidateRelation=remoteHeadRelation==="EXACT_LOCAL_PARENT"?"PARENT_COMMIT_ONLY":"REMOTE_HEAD_DIFFERS";
  if (!plain(external) || external.schema !== "github-external-observation/v1" || external.authority !== "NONE" || external.availability !== "AVAILABLE" || external.subject !== candidateRelation || !SHA.test(external.pull?.head?.sha) || !SHA.test(external.pull?.base?.sha)
    || !Array.isArray(external.checkRuns) || !Array.isArray(external.statuses)
    || [...external.checkRuns, ...external.statuses].some(row => !plain(row) || Object.hasOwn(row, "required") || Object.hasOwn(row, "independent")) || !DIGEST.test(external.observationDigest)) fail();
  const relationships = { remoteBaseRelation, remoteHeadRelation, candidateRelation };
  const decision = local.aggregate.failed > 0 || external.aggregate?.failed > 0 ? "ESCALATE" : "REQUEST_EVIDENCE";
  const value = { schema: "agent-change-assurance/connected-v4", mode: "CONNECTED_LOCAL", authority: "NONE", local, external, relationships, externalAggregate: external.aggregate, externalCoverage: external.coverage, evaluatorSnapshot: local.evaluatorSnapshot, externalCandidateEvidence: [], routing: { decision, reason: external.aggregate?.failed > 0 ? "EXTERNAL_FAILURE_OBSERVED" : local.aggregate.failed > 0 ? "LOCAL_FAILURE_OBSERVED" : "EVIDENCE_REQUIRED" } };
  return deepFreeze({ ...value, envelopeDigest: receiptDigest(value) });
}
export function admitConnectedV4Envelope(input, github) {
  try {
    if (!plain(input) || input.schema !== "agent-change-assurance/connected-v4" || input.authority !== "NONE" || !Array.isArray(input.externalCandidateEvidence) || input.externalCandidateEvidence.length || input.routing?.decision === "FAST_TRACK") fail();
    const rebuilt = createConnectedV4Envelope({ local: input.local, external: input.external, github });
    if (JSON.stringify(input) !== JSON.stringify(rebuilt)) fail();
    return deepFreeze({ valid: true, envelope: rebuilt, authority: "NONE" });
  } catch { return deepFreeze({ valid: false, code: "INVALID_CONNECTED_OBSERVATION", authority: "NONE" }); }
}
