import { evaluateConnectedAgentChange, type AgentChangeSnapshot, type ConnectedAssuranceResult } from "./agentChangeAssurance";

const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const DIGEST = /^[0-9a-f]{64}$/;
const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_AGGREGATE_BYTES = 256 * 1024 * 1024;
const plain = (value: unknown): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const dense = (value: unknown): value is unknown[] => Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && Object.keys(value).length === value.length && value.every((_, index) => Object.hasOwn(value, index));
const canonicalize = (value: unknown): unknown => Array.isArray(value) ? value.map(canonicalize) : plain(value) ? Object.fromEntries(Object.keys(value).filter((key) => key !== "envelopeDigest" && value[key] !== undefined).sort().map((key) => [key, canonicalize(value[key])])) : value;
const deepFreeze = <T>(value: T): T => { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); } return value; };
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
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
  const keys = ["schema", "mode", "repositoryIdentityBasis", "claimBasis", "evidenceBasis", "authority", "repository", "checks", "sandbox", "evaluatorSnapshot", "githubCi", "envelopeDigest"];
  if (!plain(input) || !exact(input, keys) || input.schema !== "agent-change-assurance/connected-v2" || input.mode !== "CONNECTED_LOCAL" || input.repositoryIdentityBasis !== "LOCAL_GIT_OBSERVED" || input.claimBasis !== "NOT_OBSERVED" || input.evidenceBasis !== "NO_EXECUTABLE_EVIDENCE" || input.authority !== "NONE" || input.githubCi !== "NOT_OBSERVED_BY_THIS_LOCAL_VERIFIER" || !DIGEST.test(input.envelopeDigest)) return INVALID;
  if (/\/(?:Users|home)\/|[A-Za-z]:\\/.test(JSON.stringify(input)) || !validRepository(input.repository) || !validChecks(input.checks) || !plain(input.sandbox) || !exact(input.sandbox, ["status", "reason"]) || input.sandbox.status !== "UNAVAILABLE" || input.sandbox.reason !== input.checks[0].reason || input.checks[1].reason !== input.sandbox.reason || !plain(input.evaluatorSnapshot)) return INVALID;
  const repository = input.repository; const snapshot = input.evaluatorSnapshot as AgentChangeSnapshot;
  if (!plain(snapshot.provenance) || !exact(snapshot.provenance, ["label"]) || snapshot.provenance.label !== "Connected local Git observation") return INVALID;
  if (snapshot.reviewedCandidateSha !== repository.candidate.commit || snapshot.expectedCandidateSha !== repository.candidate.commit || snapshot.baseSha !== repository.base.commit || snapshot.repository !== repository.displayName || !equal(snapshot.changedPaths, repository.changedPaths.map((row: Record<string, unknown>) => row.path)) || snapshot.additions !== repository.additions || snapshot.deletions !== repository.deletions || !equal(snapshot.claims, []) || !equal(snapshot.evidence, []) || !equal(snapshot.requiredEvidenceKinds, ["unit", "build"])) return INVALID;
  if (await connectedEnvelopeDigest(repository.manifest) !== repository.manifestDigest) return INVALID;
  if (await connectedEnvelopeDigest(repository.manifest.map(({ path, mode, size, contentDigest }: Record<string, unknown>) => ({ path, mode, size, contentDigest }))) !== repository.contentManifestDigest) return INVALID;
  if (await connectedEnvelopeDigest({ base: repository.base, candidate: repository.candidate, changedPaths: repository.changedPaths }) !== repository.diffDigest || await connectedEnvelopeDigest(input) !== input.envelopeDigest) return INVALID;
  const evaluation = evaluateConnectedAgentChange(snapshot); if (!evaluation.valid || evaluation.decision === "FAST_TRACK") return INVALID;
  const envelope = deepFreeze(structuredClone(input)) as ConnectedObservationEnvelope;
  return deepFreeze({ valid: true, envelope, evaluation });
}
