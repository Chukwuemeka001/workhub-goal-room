import { evaluateConnectedAgentChange, type AgentChangeSnapshot, type ConnectedAssuranceResult } from "./agentChangeAssurance";
import { projectTouchedPathsLocalV1 } from "./pathPolicy";

const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const DIGEST = /^[0-9a-f]{64}$/;
const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_AGGREGATE_BYTES = 256 * 1024 * 1024;
const plain = (value: unknown): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const dense = (value: unknown): value is unknown[] => Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && Object.keys(value).length === value.length && value.every((_, index) => Object.hasOwn(value, index));
const canonicalize = (value: unknown): unknown => Array.isArray(value) ? value.map(canonicalize) : plain(value) ? Object.fromEntries(Object.keys(value).filter((key) => key !== "envelopeDigest" && key !== "receiptDigest" && value[key] !== undefined).sort().map((key) => [key, canonicalize(value[key])])) : value;
const deepFreeze = <T>(value: T): T => { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); } return value; };
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
function detachOrdinaryData(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null) return null;
  if (typeof value !== "object") {
    if (["string", "number", "boolean", "undefined"].includes(typeof value)) return value;
    throw new Error("UNSUPPORTED_VALUE");
  }
  if (seen.has(value)) throw new Error("CYCLIC_VALUE");
  seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  const array = Array.isArray(value);
  if (prototype !== (array ? Array.prototype : Object.prototype)) throw new Error("EXOTIC_VALUE");
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) throw new Error("SYMBOL_KEY");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((descriptor) => !Object.hasOwn(descriptor, "value"))) throw new Error("ACCESSOR_VALUE");
  if (array) {
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1) throw new Error("SPARSE_ARRAY");
    return Array.from({ length }, (_, index) => {
      const descriptor = descriptors[String(index)];
      if (!descriptor || descriptor.enumerable !== true) throw new Error("SPARSE_ARRAY");
      return detachOrdinaryData(descriptor.value, seen);
    });
  }
  return Object.fromEntries(keys.map((key) => [key as string, detachOrdinaryData(descriptors[key as string].value, seen)]));
}
export async function connectedEnvelopeDigest(input: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(input)));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
const validPath = (value: unknown): value is string => typeof value === "string" && value.length > 0 && new TextEncoder().encode(value).length <= 500 && value.normalize("NFC") === value && !/[\u0000-\u001f\u007f]/.test(value) && !/%2f|%5c/i.test(value) && !value.startsWith("/") && !value.includes("\\") && value.split("/").every((part) => part && part !== "." && part !== "..");
const validIdentity = (value: unknown): value is { commit: string; tree: string } => plain(value) && exact(value, ["commit", "tree"]) && SHA.test(value.commit) && SHA.test(value.tree);
const validCount = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;

export interface ConnectedCheck {
  readonly checkId: "unit" | "build";
  readonly state: "INDETERMINATE";
  readonly reason: "SANDBOX_UNAVAILABLE" | "SANDBOX_POLICY_UNAVAILABLE" | "SANDBOX_EXECUTION_NOT_IMPLEMENTED";
  readonly execution: "NOT_RUN";
}
export interface ConnectedObservationEnvelope {
  readonly schema: "agent-change-assurance/connected-v2";
  readonly mode: "CONNECTED_LOCAL";
  readonly repositoryIdentityBasis: "LOCAL_GIT_OBSERVED";
  readonly claimBasis: "NOT_OBSERVED";
  readonly evidenceBasis: "NO_EXECUTABLE_EVIDENCE";
  readonly authority: "NONE";
  readonly repository: Record<string, any>;
  readonly checks: readonly ConnectedCheck[];
  readonly sandbox: { readonly status: "UNAVAILABLE"; readonly reason: ConnectedCheck["reason"] };
  readonly githubCi: "NOT_OBSERVED_BY_THIS_LOCAL_VERIFIER";
  readonly evaluatorSnapshot: AgentChangeSnapshot;
  readonly envelopeDigest: string;
}
export type ConnectedAdmission =
  | { readonly valid: true; readonly envelope: ConnectedObservationEnvelope; readonly evaluation: Extract<ConnectedAssuranceResult, { readonly valid: true }> }
  | { readonly valid: false; readonly code: "INVALID_CONNECTED_OBSERVATION"; readonly authority: "NONE" };
const INVALID: ConnectedAdmission = Object.freeze({ valid: false, code: "INVALID_CONNECTED_OBSERVATION", authority: "NONE" });
const UTF8 = new TextEncoder();
function compareGitPath(left: string, right: string): number {
  const a = UTF8.encode(left); const b = UTF8.encode(right); const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index++) if (a[index] !== b[index]) return a[index] - b[index];
  return a.length - b.length;
}

function validManifest(value: unknown): value is Record<string, any>[] {
  if (!dense(value) || value.length === 0 || value.length > MAX_FILES) return false;
  const paths = new Set<string>(); const folded = new Set<string>(); let aggregate = 0; let previousPath: string | undefined;
  return value.every((entry) => {
    if (!plain(entry) || !exact(entry, ["mode", "path", "blob", "size", "contentDigest"]) || !["100644", "100755"].includes(entry.mode) || !validPath(entry.path) || !SHA.test(entry.blob) || !validCount(entry.size) || entry.size > MAX_FILE_BYTES || !DIGEST.test(entry.contentDigest)) return false;
    const collision = entry.path.normalize("NFD").toLowerCase();
    if (paths.has(entry.path) || folded.has(collision) || (previousPath !== undefined && compareGitPath(previousPath, entry.path) >= 0)) return false;
    aggregate += entry.size;
    if (aggregate > MAX_AGGREGATE_BYTES) return false;
    paths.add(entry.path); folded.add(collision); previousPath = entry.path; return true;
  });
}
function validChangedPaths(value: unknown): value is Record<string, any>[] {
  if (!dense(value) || value.length === 0 || value.length > MAX_FILES) return false;
  const paths = new Set<string>(); const folded = new Set<string>(); let previousPath: string | undefined;
  return value.every((row) => {
    const shape = plain(row)
    && Object.keys(row).every((key) => ["path", "oldPath", "status", "oldMode", "newMode", "additions", "deletions", "binary"].includes(key))
    && ["path", "status", "oldMode", "newMode", "additions", "deletions", "binary"].every((key) => Object.hasOwn(row, key))
    && validPath(row.path) && (row.oldPath === undefined || validPath(row.oldPath)) && /^[AMDRC]$/.test(row.status)
    && /^(?:000000|100644|100755)$/.test(row.oldMode) && /^(?:000000|100644|100755)$/.test(row.newMode)
    && validCount(row.additions) && validCount(row.deletions) && typeof row.binary === "boolean"
    && (!row.binary || (row.additions === 0 && row.deletions === 0))
    && (row.status !== "A" || row.deletions === 0)
    && (row.status !== "D" || row.additions === 0);
    if (!shape) return false;
    const renameOrCopy = row.status === "R" || row.status === "C";
    if (renameOrCopy !== (typeof row.oldPath === "string") || (renameOrCopy && row.oldPath === row.path)) return false;
    if (row.status === "A" ? row.oldMode !== "000000" || row.newMode === "000000"
      : row.status === "D" ? row.oldMode === "000000" || row.newMode !== "000000"
        : row.oldMode === "000000" || row.newMode === "000000") return false;
    const collision = row.path.normalize("NFD").toLowerCase();
    if (paths.has(row.path) || folded.has(collision) || (previousPath !== undefined && compareGitPath(previousPath, row.path) >= 0)) return false;
    paths.add(row.path); folded.add(collision); previousPath = row.path; return true;
  });
}
function validObservedBranch(value: unknown): value is string {
  if (value === "DETACHED") return true;
  if (typeof value !== "string" || !value || value.length > 500 || value === "HEAD" || value.startsWith("-") || value.startsWith("/") || value.endsWith("/") || value.endsWith(".") || value.includes("//") || value.includes("..") || value.includes("@{") || /[\u0000-\u0020\u007f~^:?*[\\]/.test(value)) return false;
  return value.split("/").every((part) => part && !part.startsWith(".") && !part.endsWith(".lock"));
}
function validRepository(value: unknown): value is Record<string, any> {
  const keys = ["displayName", "observedBranch", "observedHead", "configuredBase", "resolvedBase", "candidate", "base", "trackedState", "trackedDigest", "untrackedCount", "untrackedInventoryDigest", "manifest", "manifestDigest", "contentManifestDigest", "changedPaths", "additions", "deletions", "statusDigest", "numstatDigest", "patchDigest", "diffDigest"];
  if (!plain(value) || !exact(value, keys) || typeof value.displayName !== "string" || !value.displayName || value.displayName.length > 200 || /[\\/\u0000-\u001f\u007f]/.test(value.displayName) || !validObservedBranch(value.observedBranch)) return false;
  if (!SHA.test(value.observedHead) || !SHA.test(value.configuredBase) || value.resolvedBase !== value.configuredBase || !validIdentity(value.candidate) || !validIdentity(value.base)) return false;
  const objectLength = value.candidate.commit.length;
  if (value.base.commit === value.candidate.commit || [value.observedHead, value.configuredBase, value.resolvedBase, value.candidate.tree, value.base.commit, value.base.tree].some((item) => item.length !== objectLength)) return false;
  if (!validManifest(value.manifest) || value.manifest.some((entry: Record<string, any>) => entry.blob.length !== objectLength) || !validChangedPaths(value.changedPaths)) return false;
  const manifestByPath = new Map(value.manifest.map((entry: Record<string, any>) => [entry.path, entry]));
  const baseAbsentDestinations = new Set(value.changedPaths.filter((row: Record<string, any>) => ["A", "C", "R"].includes(row.status)).map((row: Record<string, any>) => row.path));
  const consumptionCounts = new Map<string, number>();
  for (const row of value.changedPaths as Record<string, any>[]) {
    const source = row.status === "R" ? row.oldPath : row.status === "D" ? row.path : undefined;
    if (source) consumptionCounts.set(source, (consumptionCounts.get(source) ?? 0) + 1);
  }
  if ([...consumptionCounts.values()].some((count) => count > 1)) return false;
  const consumedBasePaths = new Set(consumptionCounts.keys());
  if (value.changedPaths.some((row: Record<string, any>) => row.status === "D"
    ? manifestByPath.has(row.path)
    : !manifestByPath.has(row.path) || manifestByPath.get(row.path)?.mode !== row.newMode
      || (row.status === "C" && (baseAbsentDestinations.has(row.oldPath) || (!manifestByPath.has(row.oldPath) && !consumedBasePaths.has(row.oldPath))))
      || (row.status === "R" && manifestByPath.has(row.oldPath)))) return false;
  return value.observedHead === value.candidate.commit && value.base.commit === value.resolvedBase && ["CLEAN", "DIRTY"].includes(value.trackedState)
    && DIGEST.test(value.trackedDigest) && validCount(value.untrackedCount) && DIGEST.test(value.untrackedInventoryDigest)
    && DIGEST.test(value.manifestDigest) && DIGEST.test(value.contentManifestDigest)
    && validCount(value.additions) && validCount(value.deletions)
    && value.additions === value.changedPaths.reduce((sum: number, row: Record<string, any>) => sum + row.additions, 0)
    && value.deletions === value.changedPaths.reduce((sum: number, row: Record<string, any>) => sum + row.deletions, 0)
    && [value.statusDigest, value.numstatDigest, value.patchDigest, value.diffDigest].every((item) => DIGEST.test(item));
}
function validChecks(value: unknown): value is ConnectedCheck[] {
  if (!dense(value) || value.length !== 2) return false;
  return value.every((check, index) => plain(check) && exact(check, ["checkId", "state", "reason", "execution"])
    && check.checkId === (["unit", "build"] as const)[index] && check.state === "INDETERMINATE" && check.execution === "NOT_RUN"
    && ["SANDBOX_UNAVAILABLE", "SANDBOX_POLICY_UNAVAILABLE", "SANDBOX_EXECUTION_NOT_IMPLEMENTED"].includes(check.reason));
}

export async function admitConnectedObservation(input: unknown): Promise<ConnectedAdmission> {
  let detached: unknown;
  try { detached = detachOrdinaryData(input); } catch { return INVALID; }
  input = detached;
  const keys = ["schema", "mode", "repositoryIdentityBasis", "claimBasis", "evidenceBasis", "authority", "repository", "checks", "sandbox", "evaluatorSnapshot", "githubCi", "envelopeDigest"];
  if (!plain(input) || !exact(input, keys) || input.schema !== "agent-change-assurance/connected-v2" || input.mode !== "CONNECTED_LOCAL" || input.repositoryIdentityBasis !== "LOCAL_GIT_OBSERVED" || input.claimBasis !== "NOT_OBSERVED" || input.evidenceBasis !== "NO_EXECUTABLE_EVIDENCE" || input.authority !== "NONE" || input.githubCi !== "NOT_OBSERVED_BY_THIS_LOCAL_VERIFIER" || !DIGEST.test(input.envelopeDigest)) return INVALID;
  if (/\/(?:Users|home)\/|[A-Za-z]:\\/.test(JSON.stringify(input)) || !validRepository(input.repository) || !validChecks(input.checks) || !plain(input.sandbox) || !exact(input.sandbox, ["status", "reason"]) || input.sandbox.status !== "UNAVAILABLE" || input.sandbox.reason !== input.checks[0].reason || input.checks[1].reason !== input.sandbox.reason || !plain(input.evaluatorSnapshot)) return INVALID;
  const repository = input.repository; const snapshot = input.evaluatorSnapshot as AgentChangeSnapshot;
  if (!plain(snapshot.provenance) || !exact(snapshot.provenance, ["label"]) || snapshot.provenance.label !== "Connected local Git observation") return INVALID;
  if (snapshot.reviewedCandidateSha !== repository.candidate.commit || snapshot.expectedCandidateSha !== repository.candidate.commit || snapshot.baseSha !== repository.base.commit || snapshot.repository !== repository.displayName || !equal(snapshot.changedPaths, repository.changedPaths.map((row: Record<string, unknown>) => row.path)) || snapshot.additions !== repository.additions || snapshot.deletions !== repository.deletions || !equal(snapshot.claims, []) || !equal(snapshot.evidence, []) || !equal(snapshot.requiredEvidenceKinds, ["unit", "build"])) return INVALID;
  if (await connectedEnvelopeDigest(repository.manifest) !== repository.manifestDigest) return INVALID;
  if (await connectedEnvelopeDigest(repository.manifest.map(({ path, mode, size, contentDigest }: Record<string, unknown>) => ({ path, mode, size, contentDigest }))) !== repository.contentManifestDigest) return INVALID;
  if (await connectedEnvelopeDigest({ base: repository.base, candidate: repository.candidate, changedPaths: repository.changedPaths }) !== repository.diffDigest || await connectedEnvelopeDigest(input) !== input.envelopeDigest) return INVALID;
  const evaluation = evaluateConnectedAgentChange(snapshot, projectTouchedPathsLocalV1(repository.changedPaths)); if (!evaluation.valid || evaluation.decision === "FAST_TRACK") return INVALID;
  const envelope = deepFreeze(structuredClone(input)) as ConnectedObservationEnvelope;
  return deepFreeze({ valid: true, envelope, evaluation });
}

const V3_INVALID = Object.freeze({ valid: false, code: "INVALID_CONNECTED_OBSERVATION", authority: "NONE" });
const V3_INFRASTRUCTURE = Object.freeze({
  TIMEOUT: Object.freeze({ executions: Object.freeze(["RUN"]), cleanup: "CONFIRMED", flag: "timeout" }),
  CANCELLED: Object.freeze({ executions: Object.freeze(["RUN", "NOT_RUN"]), cleanup: "CONFIRMED" }),
  OUTPUT_LIMIT: Object.freeze({ executions: Object.freeze(["RUN"]), cleanup: "CONFIRMED", flag: "outputLimit" }),
  RUNNER_INFRASTRUCTURE: Object.freeze({ executions: Object.freeze(["RUN"]), cleanup: "CONFIRMED" }),
  DOCKER_FAILURE: Object.freeze({ executions: Object.freeze(["RUN", "NOT_RUN"]), cleanup: "CONFIRMED" }),
  SOURCE_MOVED: Object.freeze({ executions: Object.freeze(["RUN", "NOT_RUN"]), cleanup: "CONFIRMED" }),
  CLEANUP_UNRESOLVED: Object.freeze({ executions: Object.freeze(["RUN", "NOT_RUN"]), cleanup: "UNRESOLVED" }),
  IMAGE_POLICY_MISMATCH: Object.freeze({ executions: Object.freeze(["RUN", "NOT_RUN"]), cleanup: "CONFIRMED" }),
}) as Readonly<Record<string, { readonly executions: readonly ("RUN" | "NOT_RUN")[]; readonly cleanup: "CONFIRMED" | "UNRESOLVED"; readonly flag?: "timeout" | "outputLimit" }>>;
const v3Output = (value: unknown) => plain(value) && exact(value, ["sha256", "observedBytes", "preview", "truncated", "limitExceeded"])
  && DIGEST.test(value.sha256) && validCount(value.observedBytes) && typeof value.preview === "string" && new TextEncoder().encode(value.preview).length <= 4096
  && typeof value.truncated === "boolean" && typeof value.limitExceeded === "boolean" && !/\/(?:Users|home)\/|[A-Za-z]:\\|file:\/\//.test(value.preview);
function v3Receipt(value: unknown, index: number): value is Record<string, any> {
  const ids = index === 0 ? ["unit-vitest"] : ["build-typescript", "build-vite"];
  const keys = ["schema", "attemptId", "snapshotDigest", "parentCommit", "parentTree", "baseCommit", "baseTree", "manifestDigest", "contentManifestDigest", "diffDigest", "lockfile", "imageId", "imageLabels", "verifierSpecDigest", "policyVersion", "startedAt", "finishedAt", "state", "reason", "execution", "commands", "cleanup", "checkId", "receiptDigest"];
  if (!plain(value) || !exact(value, keys) || value.schema !== "aca-check-receipt/v1" || value.checkId !== (["unit", "build"] as const)[index]
    || typeof value.attemptId !== "string" || new TextEncoder().encode(value.attemptId).length > 128 || !DIGEST.test(value.snapshotDigest)
    || ![value.parentCommit, value.parentTree, value.baseCommit, value.baseTree].every((item) => SHA.test(item))
    || ![value.manifestDigest, value.contentManifestDigest, value.diffDigest, value.verifierSpecDigest].every((item) => DIGEST.test(item))
    || !plain(value.lockfile) || !exact(value.lockfile, ["blobId", "bytes", "digest"]) || !SHA.test(value.lockfile.blobId) || !validCount(value.lockfile.bytes) || !DIGEST.test(value.lockfile.digest)
    || !/^sha256:[0-9a-f]{64}$/.test(value.imageId) || !plain(value.imageLabels) || !exact(value.imageLabels, ["contract", "spec"]) || value.imageLabels.contract !== "aca-sandbox/v1" || value.imageLabels.spec !== value.verifierSpecDigest
    || value.policyVersion !== "aca-isolation-v1" || !Number.isFinite(Date.parse(value.startedAt)) || !Number.isFinite(Date.parse(value.finishedAt)) || Date.parse(value.finishedAt) < Date.parse(value.startedAt)
    || !["PASS", "FAIL", "INDETERMINATE"].includes(value.state) || !["RUN", "NOT_RUN"].includes(value.execution) || !["CONFIRMED", "UNRESOLVED"].includes(value.cleanup) || !DIGEST.test(value.receiptDigest)
    || !dense(value.commands) || value.commands.length !== ids.length) return false;
  let failed = false, infrastructure = false;
  for (let commandIndex = 0; commandIndex < ids.length; commandIndex++) {
    const command = value.commands[commandIndex];
    if (!plain(command) || !exact(command, ["commandId", "exitCode", "signal", "timeout", "outputLimit", "stdout", "stderr"]) || command.commandId !== ids[commandIndex]
      || !(command.exitCode === null || Number.isSafeInteger(command.exitCode)) || !(command.signal === null || typeof command.signal === "string") || typeof command.timeout !== "boolean" || typeof command.outputLimit !== "boolean" || !v3Output(command.stdout) || !v3Output(command.stderr)) return false;
    if ((command.exitCode !== null && command.exitCode !== 0) || command.signal !== null) failed = true;
    if (command.timeout || command.outputLimit) infrastructure = true;
  }
  if (value.state === "PASS") return value.reason === "CHECK_PASSED" && value.execution === "RUN" && value.cleanup === "CONFIRMED" && !failed && !infrastructure && value.commands.every((command: any) => command.exitCode === 0 && command.signal === null);
  if (value.state === "FAIL") return value.reason === "CHECK_FAILED" && value.execution === "RUN" && value.cleanup === "CONFIRMED" && failed && !infrastructure;
  const terminal = V3_INFRASTRUCTURE[value.reason];
  return Boolean(terminal && terminal.executions.includes(value.execution) && terminal.cleanup === value.cleanup
    && (terminal.flag ? value.commands.some((command: any) => command[terminal.flag!] === true) : !infrastructure)
    && (value.execution !== "NOT_RUN" || value.commands.every((command: any) => command.exitCode === null && command.signal === null)));
}

function v3DiffRows(value: unknown, changedPaths: unknown): value is Record<string, any>[] {
  if (!dense(value) || !dense(changedPaths) || value.length === 0 || value.length !== changedPaths.length || value.length > MAX_FILES) return false;
  return value.every((row, index) => plain(row) && exact(row, ["path", "status", "oldMode", "newMode", "oldBlob", "newBlob", "additions", "deletions", "binary"])
    && row.path === changedPaths[index] && validPath(row.path) && ["A", "D", "M"].includes(row.status)
    && /^(?:000000|100644|100755)$/.test(row.oldMode) && /^(?:000000|100644|100755)$/.test(row.newMode)
    && (row.oldBlob === null || SHA.test(row.oldBlob)) && (row.newBlob === null || SHA.test(row.newBlob))
    && validCount(row.additions) && validCount(row.deletions) && typeof row.binary === "boolean" && (!row.binary || (row.additions === 0 && row.deletions === 0))
    && (row.status === "A" ? row.oldMode === "000000" && row.oldBlob === null && row.newMode !== "000000" && row.newBlob !== null
      : row.status === "D" ? row.newMode === "000000" && row.newBlob === null && row.oldMode !== "000000" && row.oldBlob !== null
        : row.oldMode !== "000000" && row.newMode !== "000000" && row.oldBlob !== null && row.newBlob !== null));
}

export async function admitConnectedV3Observation(input: unknown): Promise<any> {
  let detached: unknown; try { detached = detachOrdinaryData(input); } catch { return V3_INVALID; } input = detached;
  const rootKeys = ["schema", "mode", "repositoryIdentityBasis", "claimBasis", "evidenceBasis", "authority", "repository", "qualification", "receipts", "checks", "aggregate", "evaluatorSnapshot", "githubCi", "envelopeDigest"];
  if (!plain(input) || !exact(input, rootKeys) || input.schema !== "agent-change-assurance/connected-v3" || input.mode !== "CONNECTED_LOCAL" || input.repositoryIdentityBasis !== "CUMULATIVE_DIRTY_SNAPSHOT" || input.claimBasis !== "NOT_OBSERVED" || input.evidenceBasis !== "QUALIFIED_LOCAL_SANDBOX" || input.authority !== "NONE" || input.githubCi !== "NOT_OBSERVED_BY_THIS_LOCAL_VERIFIER" || !DIGEST.test(input.envelopeDigest)
    || /\/(?:Users|home)\/|[A-Za-z]:\\|file:\/\//.test(JSON.stringify(input))) return V3_INVALID;
  const repository = input.repository;
  const repositoryKeys = ["displayName", "snapshotDigest", "parentCommit", "parentTree", "baseCommit", "baseTree", "manifestDigest", "contentManifestDigest", "diffDigest", "diffRows", "changedPaths", "additions", "deletions"];
  if (!plain(repository) || !exact(repository, repositoryKeys) || typeof repository.displayName !== "string" || !repository.displayName || /[\\/\u0000-\u001f\u007f]/.test(repository.displayName) || !DIGEST.test(repository.snapshotDigest)
    || ![repository.parentCommit, repository.parentTree, repository.baseCommit, repository.baseTree].every((item) => SHA.test(item)) || ![repository.manifestDigest, repository.contentManifestDigest, repository.diffDigest].every((item) => DIGEST.test(item))
    || !dense(repository.changedPaths) || repository.changedPaths.length === 0 || !repository.changedPaths.every(validPath) || !v3DiffRows(repository.diffRows, repository.changedPaths) || !validCount(repository.additions) || !validCount(repository.deletions)
    || repository.additions !== repository.diffRows.reduce((sum: number, row: Record<string, any>) => sum + row.additions, 0) || repository.deletions !== repository.diffRows.reduce((sum: number, row: Record<string, any>) => sum + row.deletions, 0)) return V3_INVALID;
  if (await connectedEnvelopeDigest({ schema: "aca-base-snapshot-diff/v2", baseCommit: repository.baseCommit, baseTree: repository.baseTree, snapshotDigest: repository.snapshotDigest, rows: repository.diffRows, additions: repository.additions, deletions: repository.deletions }) !== repository.diffDigest) return V3_INVALID;
  const qualification = input.qualification;
  if (!plain(qualification) || !exact(qualification, ["status", "policyVersion", "imageId", "verifierSpecDigest"]) || qualification.status !== "QUALIFIED" || qualification.policyVersion !== "aca-isolation-v1" || !/^sha256:[0-9a-f]{64}$/.test(qualification.imageId) || !DIGEST.test(qualification.verifierSpecDigest)) return V3_INVALID;
  if (!dense(input.receipts) || input.receipts.length !== 2 || !input.receipts.every(v3Receipt)) return V3_INVALID;
  const [unit, build] = input.receipts;
  if (build.attemptId !== unit.attemptId || [unit, build].some((receipt) => receipt.snapshotDigest !== repository.snapshotDigest || receipt.parentCommit !== repository.parentCommit || receipt.parentTree !== repository.parentTree || receipt.baseCommit !== repository.baseCommit || receipt.baseTree !== repository.baseTree || receipt.manifestDigest !== repository.manifestDigest || receipt.contentManifestDigest !== repository.contentManifestDigest || receipt.diffDigest !== repository.diffDigest || receipt.imageId !== qualification.imageId || receipt.verifierSpecDigest !== qualification.verifierSpecDigest || receipt.policyVersion !== qualification.policyVersion)) return V3_INVALID;
  for (const receipt of input.receipts) if (await connectedEnvelopeDigest(receipt) !== receipt.receiptDigest) return V3_INVALID;
  const checks = input.receipts.map((receipt) => ({ checkId: receipt.checkId, state: receipt.state, reason: receipt.reason, execution: receipt.execution, receiptDigest: receipt.receiptDigest }));
  if (!equal(input.checks, checks)) return V3_INVALID;
  const passed = input.receipts.filter((receipt) => receipt.state === "PASS").length; const failed = input.receipts.filter((receipt) => receipt.state === "FAIL").length; const indeterminate = 2 - passed - failed; const completed = passed + failed; const completeness = completed === 2 ? "complete" : completed === 1 ? "partial" : "absent";
  const aggregate = { passed, failed, indeterminate, complete: completed === 2, sentence: `${passed} of 2 required checks passed; ${failed} failed; ${indeterminate} indeterminate; executable evidence is ${completeness}; ${indeterminate ? "missing/indeterminate requirements remain" : "no missing/indeterminate requirements"}.` };
  if (!equal(input.aggregate, aggregate)) return V3_INVALID;
  const evidence = input.receipts.filter((receipt) => receipt.state === "PASS" || receipt.state === "FAIL").map((receipt) => ({ kind: receipt.checkId, subjectSha: repository.snapshotDigest, status: receipt.state, producer: "local_tool", independent: false }));
  const snapshot = input.evaluatorSnapshot;
  if (!plain(snapshot) || snapshot.schemaVersion !== "agent-change-assurance/v1" || !plain(snapshot.provenance) || !exact(snapshot.provenance, ["label"]) || snapshot.provenance.label !== "Qualified local Docker sandbox" || snapshot.repository !== repository.displayName || snapshot.expectedCandidateSha !== repository.snapshotDigest || snapshot.reviewedCandidateSha !== repository.snapshotDigest || snapshot.baseSha !== repository.baseCommit || !equal(snapshot.changedPaths, repository.changedPaths) || snapshot.additions !== repository.additions || snapshot.deletions !== repository.deletions || !equal(snapshot.claims, []) || !equal(snapshot.evidence, evidence) || !equal(snapshot.requiredEvidenceKinds, ["unit", "build"])) return V3_INVALID;
  if (await connectedEnvelopeDigest(input) !== input.envelopeDigest) return V3_INVALID;
  const evaluated = evaluateConnectedAgentChange(snapshot, repository.changedPaths); if (!evaluated.valid) return V3_INVALID;
  const evaluation = deepFreeze({ ...evaluated, decision: evaluated.decision === "FAST_TRACK" ? "REQUEST_EVIDENCE" : evaluated.decision, evidenceBasis: "QUALIFIED_LOCAL_SANDBOX" });
  return deepFreeze({ valid: true, envelope: structuredClone(input), evaluation });
}
