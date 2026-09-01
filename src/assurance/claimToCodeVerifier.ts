import { admitConnectedObservation, connectedEnvelopeDigest, type ConnectedAdmission } from "./connectedAssurance";
import { isDependencyConventionPath, isDocumentationConventionPath, isMigrationConventionPath, isProductionConfigConventionPath, isSensitivePathLocalV1, isWorkflowConventionPath, projectTouchedPathsLocalV1 } from "./pathPolicy";

export const CLAIM_PACKET_LIMITS = Object.freeze({
  rawJsonUtf8Bytes: 65_536,
  requestUtf8Bytes: 4_096,
  summaryUtf8Bytes: 4_096,
  proseUtf8Bytes: 2_048,
  idUtf8Bytes: 64,
  claimCount: 64,
  pathsPerClaim: 256,
  pathUtf8Bytes: 500,
  symbolUtf8Bytes: 256,
  totalPathUtf8Bytes: 32_768,
  diagnosticUtf8Bytes: 4_096,
  diagnosticPathCount: 8,
});

export type ClaimVerdict = "SUPPORTED" | "CONTRADICTED" | "NOT_PROVABLE";
export type ClaimReasonCode = "TEST_PATH_CHANGE_OBSERVED" | "NO_TEST_PATH_CHANGE_OBSERVED" | "EXACT_PATH_SET_MATCH" | "PATH_SET_MISMATCH" | "PROSE_NOT_MACHINE_PROVABLE" | "DOCUMENTATION_CONVENTION_PATH_CHANGE_OBSERVED" | "NO_DOCUMENTATION_CONVENTION_PATH_CHANGE_OBSERVED" | "MIGRATION_CONVENTION_PATH_CHANGE_OBSERVED" | "NO_MIGRATION_CONVENTION_PATH_CHANGE_OBSERVED" | "DEPENDENCY_CONVENTION_PATH_CHANGE_OBSERVED" | "NO_DEPENDENCY_CONVENTION_PATH_CHANGE_OBSERVED" | "NO_WORKFLOW_CONVENTION_PATH_TOUCHED" | "WORKFLOW_CONVENTION_PATH_TOUCHED" | "NO_PRODUCTION_CONFIG_CONVENTION_PATH_TOUCHED" | "PRODUCTION_CONFIG_CONVENTION_PATH_TOUCHED" | "NO_SENSITIVE_POLICY_PATH_TOUCHED" | "SENSITIVE_POLICY_PATH_TOUCHED" | "REQUIRED_FILE_PRESENT" | "REQUIRED_FILE_ABSENT" | "REQUIRED_SYMBOL_FILE_ABSENT" | "REQUIRED_SYMBOL_SOURCE_BYTES_UNAVAILABLE" | "FORBIDDEN_PATH_UNTOUCHED" | "FORBIDDEN_PATH_TOUCHED";
export interface ClaimVerificationRow {
  readonly id: string;
  readonly kind: "tests_added" | "files_changed_only" | "prose" | "documentation_updated" | "migration_included" | "dependency_changed" | "workflow_unchanged" | "production_config_unchanged" | "sensitive_paths_unchanged" | "required_file_present" | "required_symbol_present" | "forbidden_path_untouched";
  readonly path?: string;
  readonly symbol?: string;
  readonly paths?: readonly string[];
  readonly text?: string;
  readonly verdict: ClaimVerdict;
  readonly reasonCode: ClaimReasonCode;
  readonly detail: string;
}
export interface ValidClaimVerificationResult {
  readonly valid: true;
  readonly schema: "claim-verification/v1";
  readonly authority: "NONE";
  readonly candidateBinding: "EXACT_LOCAL_GIT_OBSERVED";
  readonly decodedValueBoundary: "DECODED_JSON_VALUE";
  readonly binding: {
    readonly admittedEnvelopeDigest: string;
    readonly candidateCommit: string;
    readonly candidateTree: string;
    readonly baseCommit: string;
    readonly baseTree: string;
    readonly diffDigest: string;
  };
  readonly canonicalDecodedClaimPacketDigest: string;
  readonly context: { readonly originalRequest: string; readonly completionSummary: string };
  readonly rows: readonly ClaimVerificationRow[];
  readonly counts: { readonly supported: number; readonly contradicted: number; readonly notProvable: number; readonly total: number };
  readonly machineClaimCondition: "SATISFIED" | "UNSATISFIED";
  readonly connectedDecision: "REQUEST_EVIDENCE" | "ESCALATE";
  readonly effectiveRecommendation: "REQUEST_EVIDENCE" | "ESCALATE";
  readonly evidenceBasis: "NO_EXECUTABLE_EVIDENCE";
  readonly resultDigest: string;
}
export interface InvalidClaimVerificationResult {
  readonly valid: false;
  readonly code: "PACKET_SCHEMA_REFUSED" | "CANDIDATE_MISMATCH" | "CONNECTED_OBSERVATION_REFUSED";
  readonly authority: "NONE";
  readonly packetCandidateSha?: string;
  readonly observedCandidateSha?: string;
}
export type ClaimVerificationResult = ValidClaimVerificationResult | InvalidClaimVerificationResult;

type AdmittedClaim =
  | { id: string; kind: "tests_added" }
  | { id: string; kind: "documentation_updated" }
  | { id: string; kind: "migration_included" }
  | { id: string; kind: "dependency_changed" }
  | { id: string; kind: "workflow_unchanged" }
  | { id: string; kind: "production_config_unchanged" }
  | { id: string; kind: "sensitive_paths_unchanged" }
  | { id: string; kind: "required_file_present"; path: string }
  | { id: string; kind: "required_symbol_present"; path: string; symbol: string }
  | { id: string; kind: "forbidden_path_untouched"; path: string }
  | { id: string; kind: "files_changed_only"; paths: string[] }
  | { id: string; kind: "prose"; text: string };
interface AdmittedPacket { schema: "claim-to-code/v1"; candidateSha: string; originalRequest: string; completionSummary: string; claims: AdmittedClaim[] }

const UTF8 = new TextEncoder();
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const CLAIM_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const TEST_PATH = /(^|\/)(__tests__|tests?|spec)(\/|\.|$)|\.(test|spec)\.[^/]+$/i;
const INVALID_SCHEMA: InvalidClaimVerificationResult = Object.freeze({ valid: false, code: "PACKET_SCHEMA_REFUSED", authority: "NONE" });
const INVALID_CONNECTED: InvalidClaimVerificationResult = Object.freeze({ valid: false, code: "CONNECTED_OBSERVATION_REFUSED", authority: "NONE" });
const bytes = (value: string) => UTF8.encode(value).length;
const compareGitUtf8 = (left: string, right: string): number => {
  const a = UTF8.encode(left), b = UTF8.encode(right), length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index++) if (a[index] !== b[index]) return a[index] - b[index];
  return a.length - b.length;
};
const dataObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) => Object.hasOwn(descriptor, "value"));
};
const exact = (value: Record<string, unknown>, keys: readonly string[]) => {
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every((key) => typeof key === "string") && keys.every((key) => Object.hasOwn(value, key));
};
const denseDataArray = (value: unknown): value is unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  const own = Reflect.ownKeys(value);
  if (own.length !== value.length + 1 || !own.every((key) => typeof key === "string") || !lengthDescriptor || !Object.hasOwn(lengthDescriptor, "value")) return false;
  for (let index = 0; index < value.length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) return false;
  }
  return true;
};
const boundedText = (value: unknown, maxBytes: number): value is string => typeof value === "string" && value.length > 0 && value.trim() === value && bytes(value) <= maxBytes;
const canonicalPath = (value: unknown): value is string => typeof value === "string" && value.length > 0 && bytes(value) <= CLAIM_PACKET_LIMITS.pathUtf8Bytes && value.normalize("NFC") === value && !/[\u0000-\u001f\u007f]/.test(value) && !value.startsWith("/") && !value.endsWith("/") && !value.includes("\\") && !/%2f|%5c/i.test(value) && value.split("/").every((part) => part && part !== "." && part !== "..");
const boundedSymbol = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.trim() === value && value.normalize("NFC") === value && bytes(value) <= CLAIM_PACKET_LIMITS.symbolUtf8Bytes && !/[\u0000-\u001f\u007f]/.test(value);
const deepFreeze = <T>(value: T): T => { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); } return value; };

function admitPacket(input: unknown): AdmittedPacket | null {
  if (!dataObject(input) || !exact(input, ["schema", "candidateSha", "originalRequest", "completionSummary", "claims"])) return null;
  if (input.schema !== "claim-to-code/v1" || typeof input.candidateSha !== "string" || !SHA.test(input.candidateSha)
    || !boundedText(input.originalRequest, CLAIM_PACKET_LIMITS.requestUtf8Bytes) || !boundedText(input.completionSummary, CLAIM_PACKET_LIMITS.summaryUtf8Bytes)
    || !denseDataArray(input.claims) || input.claims.length === 0 || input.claims.length > CLAIM_PACKET_LIMITS.claimCount) return null;
  const ids = new Set<string>(), machineKinds = new Set<string>(), semanticTuples = new Set<string>(); let totalPathBytes = 0; const claims: AdmittedClaim[] = [];
  for (const unknownClaim of input.claims) {
    if (!dataObject(unknownClaim) || typeof unknownClaim.id !== "string" || !CLAIM_ID.test(unknownClaim.id) || bytes(unknownClaim.id) > CLAIM_PACKET_LIMITS.idUtf8Bytes || ids.has(unknownClaim.id)) return null;
    ids.add(unknownClaim.id);
    if (unknownClaim.kind === "tests_added") {
      if (!exact(unknownClaim, ["id", "kind"]) || machineKinds.has(unknownClaim.kind)) return null;
      machineKinds.add(unknownClaim.kind); claims.push({ id: unknownClaim.id, kind: unknownClaim.kind }); continue;
    }
    if (unknownClaim.kind === "documentation_updated" || unknownClaim.kind === "migration_included" || unknownClaim.kind === "dependency_changed" || unknownClaim.kind === "workflow_unchanged" || unknownClaim.kind === "production_config_unchanged" || unknownClaim.kind === "sensitive_paths_unchanged") {
      if (!exact(unknownClaim, ["id", "kind"]) || machineKinds.has(unknownClaim.kind)) return null;
      machineKinds.add(unknownClaim.kind); claims.push({ id: unknownClaim.id, kind: unknownClaim.kind }); continue;
    }
    if (unknownClaim.kind === "files_changed_only") {
      if (!exact(unknownClaim, ["id", "kind", "paths"]) || machineKinds.has(unknownClaim.kind) || !denseDataArray(unknownClaim.paths)
        || unknownClaim.paths.length === 0 || unknownClaim.paths.length > CLAIM_PACKET_LIMITS.pathsPerClaim || !unknownClaim.paths.every(canonicalPath)
        || new Set(unknownClaim.paths).size !== unknownClaim.paths.length) return null;
      totalPathBytes += unknownClaim.paths.reduce((sum, path) => sum + bytes(path as string), 0);
      if (totalPathBytes > CLAIM_PACKET_LIMITS.totalPathUtf8Bytes) return null;
      machineKinds.add(unknownClaim.kind); claims.push({ id: unknownClaim.id, kind: unknownClaim.kind, paths: [...unknownClaim.paths] as string[] }); continue;
    }
    if (unknownClaim.kind === "required_file_present" || unknownClaim.kind === "forbidden_path_untouched") {
      if (!exact(unknownClaim, ["id", "kind", "path"]) || !canonicalPath(unknownClaim.path)) return null;
      const tuple = `${unknownClaim.kind}:${unknownClaim.path}`; if (semanticTuples.has(tuple)) return null; semanticTuples.add(tuple);
      totalPathBytes += bytes(unknownClaim.path); if (totalPathBytes > CLAIM_PACKET_LIMITS.totalPathUtf8Bytes) return null;
      claims.push({ id: unknownClaim.id, kind: unknownClaim.kind, path: unknownClaim.path }); continue;
    }
    if (unknownClaim.kind === "required_symbol_present") {
      if (!exact(unknownClaim, ["id", "kind", "path", "symbol"]) || !canonicalPath(unknownClaim.path) || !boundedSymbol(unknownClaim.symbol)) return null;
      const tuple = `${unknownClaim.kind}:${unknownClaim.path}\0${unknownClaim.symbol}`; if (semanticTuples.has(tuple)) return null; semanticTuples.add(tuple);
      totalPathBytes += bytes(unknownClaim.path); if (totalPathBytes > CLAIM_PACKET_LIMITS.totalPathUtf8Bytes) return null;
      claims.push({ id: unknownClaim.id, kind: unknownClaim.kind, path: unknownClaim.path, symbol: unknownClaim.symbol }); continue;
    }
    if (unknownClaim.kind === "prose") {
      if (!exact(unknownClaim, ["id", "kind", "text"]) || !boundedText(unknownClaim.text, CLAIM_PACKET_LIMITS.proseUtf8Bytes)) return null;
      claims.push({ id: unknownClaim.id, kind: unknownClaim.kind, text: unknownClaim.text }); continue;
    }
    return null;
  }
  return { schema: "claim-to-code/v1", candidateSha: input.candidateSha, originalRequest: input.originalRequest, completionSummary: input.completionSummary, claims };
}

function boundedPathList(paths: readonly string[], maxBytes: number): string {
  const shown: string[] = [];
  for (const path of paths.slice(0, CLAIM_PACKET_LIMITS.diagnosticPathCount)) {
    const next = [...shown, path];
    const remaining = paths.length - next.length;
    const candidate = `[${next.join(", ")}]${remaining > 0 ? ` … truncated +${remaining} paths` : ""}`;
    if (bytes(candidate) > maxBytes) break;
    shown.push(path);
  }
  const remaining = paths.length - shown.length;
  return `[${shown.join(", ")}]${remaining > 0 ? ` … truncated +${remaining} paths` : ""}`;
}

export async function verifyClaimsAgainstObservation(packet: unknown, suppliedAdmission: Extract<ConnectedAdmission, { valid: true }>): Promise<ClaimVerificationResult> {
  let capturedPacket: AdmittedPacket | null;
  try { capturedPacket = admitPacket(packet); } catch { capturedPacket = null; }
  let reAdmission: ConnectedAdmission;
  try {
    if (!dataObject(suppliedAdmission) || suppliedAdmission.valid !== true || !Object.hasOwn(suppliedAdmission, "envelope")) return INVALID_CONNECTED;
    reAdmission = await admitConnectedObservation(suppliedAdmission.envelope);
  } catch { return INVALID_CONNECTED; }
  if (!reAdmission.valid) return INVALID_CONNECTED;
  if (!capturedPacket) return INVALID_SCHEMA;
  const value = capturedPacket;
  const repository = reAdmission.envelope.repository;
  if (value.candidateSha !== repository.candidate.commit) return Object.freeze({ valid: false, code: "CANDIDATE_MISMATCH", authority: "NONE", packetCandidateSha: value.candidateSha, observedCandidateSha: repository.candidate.commit });

  const canonicalPacket = {
    schema: value.schema, candidateSha: value.candidateSha, originalRequest: value.originalRequest, completionSummary: value.completionSummary,
    claims: [...value.claims].sort((left, right) => compareGitUtf8(left.id, right.id)).map((claim) => claim.kind === "files_changed_only" ? { ...claim, paths: [...claim.paths].sort(compareGitUtf8) } : { ...claim }),
  };
  const canonicalDecodedClaimPacketDigest = await connectedEnvelopeDigest(canonicalPacket);
  const changedPaths = repository.changedPaths as Array<{ path: string; status: string; newMode: string }>;
  const manifestModes = new Map((repository.manifest as Array<{ path: string; mode: string }>).map((entry) => [entry.path, entry.mode]));
  const observedPaths = changedPaths.map(({ path }) => path).sort(compareGitUtf8);
  const touchedPaths = projectTouchedPathsLocalV1(repository.changedPaths);
  const rows = canonicalPacket.claims.map((claim): ClaimVerificationRow => {
    if (claim.kind === "forbidden_path_untouched") {
      const contradicted = touchedPaths.includes(claim.path);
      return { id: claim.id, kind: claim.kind, path: claim.path, verdict: contradicted ? "CONTRADICTED" : "SUPPORTED", reasonCode: contradicted ? "FORBIDDEN_PATH_TOUCHED" : "FORBIDDEN_PATH_UNTOUCHED", detail: contradicted ? "The exact path was a changed-row destination/deletion or rename source in the admitted diff; copy sources do not count." : "The exact path was not a changed-row destination/deletion or rename source in the admitted diff; copy sources do not count." };
    }
    if (claim.kind === "required_symbol_present") {
      const present = manifestModes.has(claim.path);
      return { id: claim.id, kind: claim.kind, path: claim.path, symbol: claim.symbol, verdict: present ? "NOT_PROVABLE" : "CONTRADICTED", reasonCode: present ? "REQUIRED_SYMBOL_SOURCE_BYTES_UNAVAILABLE" : "REQUIRED_SYMBOL_FILE_ABSENT", detail: present
        ? "NOT PROVABLE — the file is present, but source bytes and parser evidence are unavailable; the symbol was not searched and is not claimed absent."
        : "CONTRADICTED — required file is absent from the admitted candidate manifest; this does not independently inspect the symbol." };
    }
    if (claim.kind === "required_file_present") {
      const supported = manifestModes.has(claim.path);
      return { id: claim.id, kind: claim.kind, path: claim.path, verdict: supported ? "SUPPORTED" : "CONTRADICTED", reasonCode: supported ? "REQUIRED_FILE_PRESENT" : "REQUIRED_FILE_ABSENT", detail: supported ? "The exact canonical path is present in the admitted candidate manifest. Content, semantics, and runtime use are not proven." : "The exact canonical path is absent from the admitted candidate manifest. This does not inspect source content or runtime use." };
    }
    if (claim.kind === "sensitive_paths_unchanged") {
      const contradicted = touchedPaths.some(isSensitivePathLocalV1);
      return { id: claim.id, kind: claim.kind, verdict: contradicted ? "CONTRADICTED" : "SUPPORTED", reasonCode: contradicted ? "SENSITIVE_POLICY_PATH_TOUCHED" : "NO_SENSITIVE_POLICY_PATH_TOUCHED", detail: "The shared local-v1 ACA sensitive policy was applied to diff destinations/deletions and rename sources, never copy sources. Absence from this frozen convention does not prove safety or nonsensitivity remained unchanged." };
    }
    if (claim.kind === "production_config_unchanged") {
      const contradicted = touchedPaths.some(isProductionConfigConventionPath);
      return { id: claim.id, kind: claim.kind, verdict: contradicted ? "CONTRADICTED" : "SUPPORTED", reasonCode: contradicted ? "PRODUCTION_CONFIG_CONVENTION_PATH_TOUCHED" : "NO_PRODUCTION_CONFIG_CONVENTION_PATH_TOUCHED", detail: "The conservative local-v1 production-config convention was applied to diff destinations/deletions and rename sources, never copy sources. This does not prove runtime configuration, deployment state, safety, or configuration remained unchanged." };
    }
    if (claim.kind === "workflow_unchanged") {
      const contradicted = touchedPaths.some(isWorkflowConventionPath);
      return { id: claim.id, kind: claim.kind, verdict: contradicted ? "CONTRADICTED" : "SUPPORTED", reasonCode: contradicted ? "WORKFLOW_CONVENTION_PATH_TOUCHED" : "NO_WORKFLOW_CONVENTION_PATH_TOUCHED", detail: "The local-v1 workflow convention was applied to diff destinations/deletions and rename sources, never copy sources. This does not prove workflows, deployment state, safety, or runtime behavior remained unchanged." };
    }
    if (claim.kind === "dependency_changed") {
      const supported = changedPaths.some((change) => ["A", "M", "C", "R"].includes(change.status) && manifestModes.get(change.path) === change.newMode && isDependencyConventionPath(change.path));
      return { id: claim.id, kind: claim.kind, verdict: supported ? "SUPPORTED" : "CONTRADICTED", reasonCode: supported ? "DEPENDENCY_CONVENTION_PATH_CHANGE_OBSERVED" : "NO_DEPENDENCY_CONVENTION_PATH_CHANGE_OBSERVED", detail: `${supported ? "A" : "No"} candidate-present A/M/C/R path with matching manifest mode matched the local-v1 dependency convention. Resolution, compatibility, provenance, vulnerability status, and install success are not proven.` };
    }
    if (claim.kind === "migration_included") {
      const supported = changedPaths.some((change) => ["A", "M", "C", "R"].includes(change.status) && manifestModes.get(change.path) === change.newMode && isMigrationConventionPath(change.path));
      return { id: claim.id, kind: claim.kind, verdict: supported ? "SUPPORTED" : "CONTRADICTED", reasonCode: supported ? "MIGRATION_CONVENTION_PATH_CHANGE_OBSERVED" : "NO_MIGRATION_CONVENTION_PATH_CHANGE_OBSERVED", detail: `${supported ? "A" : "No"} candidate-present A/M/C/R path with matching manifest mode matched the local-v1 migration convention. Migration ordering, reversibility, compatibility, data safety, and execution are not proven.` };
    }
    if (claim.kind === "documentation_updated") {
      const supported = changedPaths.some((change) => ["A", "M", "C", "R"].includes(change.status) && manifestModes.get(change.path) === change.newMode && isDocumentationConventionPath(change.path));
      return { id: claim.id, kind: claim.kind, verdict: supported ? "SUPPORTED" : "CONTRADICTED", reasonCode: supported ? "DOCUMENTATION_CONVENTION_PATH_CHANGE_OBSERVED" : "NO_DOCUMENTATION_CONVENTION_PATH_CHANGE_OBSERVED", detail: supported
        ? "A candidate-present A/M/C/R path with matching manifest mode matched the local-v1 documentation convention. Path change only; documentation relevance, accuracy, completeness, and quality are not proven."
        : "No candidate-present A/M/C/R path with matching manifest mode matched the local-v1 documentation convention. This does not prove documentation work did not occur." };
    }
    if (claim.kind === "tests_added") {
      const supported = changedPaths.some((change) => ["A", "M", "C", "R"].includes(change.status) && manifestModes.get(change.path) === change.newMode && TEST_PATH.test(change.path));
      return { id: claim.id, kind: claim.kind, verdict: supported ? "SUPPORTED" : "CONTRADICTED", reasonCode: supported ? "TEST_PATH_CHANGE_OBSERVED" : "NO_TEST_PATH_CHANGE_OBSERVED", detail: supported
        ? "This establishes only that a candidate-present changed path matches the v1 test-path convention. Tests were not run; coverage, assertions, relevance, and passing status are not proven."
        : "No candidate-present A/M/C/R changed path with matching manifest mode matches the v1 test-path convention. Tests were not run; coverage, assertions, relevance, and passing status are not proven." };
    }
    if (claim.kind === "prose") return { id: claim.id, kind: claim.kind, text: claim.text, verdict: "NOT_PROVABLE", reasonCode: "PROSE_NOT_MACHINE_PROVABLE", detail: "Submitted prose is display-only and is not machine provable." };
    const claimedPaths = [...claim.paths].sort(compareGitUtf8), claimed = new Set(claimedPaths), observed = new Set(observedPaths);
    const omitted = observedPaths.filter((path) => !claimed.has(path)), unexpected = claimedPaths.filter((path) => !observed.has(path));
    const supported = omitted.length === 0 && unexpected.length === 0;
    const diagnosticListBudget = Math.floor((CLAIM_PACKET_LIMITS.diagnosticUtf8Bytes - 256) / 2);
    const detail = supported
      ? "The claimed path set exactly equals the canonical changedPaths[].path comparison set; rename/copy uses the new path and deletion uses the deleted path."
      : `omitted observed paths (${omitted.length}): ${boundedPathList(omitted, diagnosticListBudget)}; unexpected claimed paths (${unexpected.length}): ${boundedPathList(unexpected, diagnosticListBudget)}`;
    const boundedDetail = bytes(detail) <= CLAIM_PACKET_LIMITS.diagnosticUtf8Bytes
      ? detail
      : `omitted observed paths (${omitted.length}): [lists truncated]; unexpected claimed paths (${unexpected.length}): [lists truncated]`;
    return { id: claim.id, kind: claim.kind, paths: claimedPaths, verdict: supported ? "SUPPORTED" : "CONTRADICTED", reasonCode: supported ? "EXACT_PATH_SET_MATCH" : "PATH_SET_MISMATCH", detail: boundedDetail };
  });
  const supported = rows.filter((row) => row.verdict === "SUPPORTED").length, contradicted = rows.filter((row) => row.verdict === "CONTRADICTED").length, notProvable = rows.filter((row) => row.verdict === "NOT_PROVABLE").length;
  const machineClaimCondition = rows.some((row) => row.kind !== "prose" && row.verdict === "SUPPORTED") ? "SATISFIED" as const : "UNSATISFIED" as const;
  const connectedDecision = reAdmission.evaluation.decision as "REQUEST_EVIDENCE" | "ESCALATE";
  const effectiveRecommendation = contradicted > 0 || connectedDecision === "ESCALATE" ? "ESCALATE" as const : "REQUEST_EVIDENCE" as const;
  const resultWithoutDigest = {
    valid: true as const, schema: "claim-verification/v1" as const, authority: "NONE" as const, candidateBinding: "EXACT_LOCAL_GIT_OBSERVED" as const, decodedValueBoundary: "DECODED_JSON_VALUE" as const,
    binding: { admittedEnvelopeDigest: reAdmission.envelope.envelopeDigest, candidateCommit: repository.candidate.commit, candidateTree: repository.candidate.tree, baseCommit: repository.base.commit, baseTree: repository.base.tree, diffDigest: repository.diffDigest },
    canonicalDecodedClaimPacketDigest, context: { originalRequest: value.originalRequest, completionSummary: value.completionSummary }, rows,
    counts: { supported, contradicted, notProvable, total: rows.length }, machineClaimCondition, connectedDecision, effectiveRecommendation, evidenceBasis: "NO_EXECUTABLE_EVIDENCE" as const,
  };
  return deepFreeze({ ...resultWithoutDigest, resultDigest: await connectedEnvelopeDigest(resultWithoutDigest) });
}
