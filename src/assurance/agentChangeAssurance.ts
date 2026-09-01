export const EVIDENCE_KINDS = ["unit", "lint", "build", "github_ci", "preview", "security_review"] as const;
export const PRODUCER_KINDS = ["agent", "independent_ci", "human_reviewer", "local_tool"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export type ProducerKind = (typeof PRODUCER_KINDS)[number];
export type EvidenceStatus = "PASS" | "FAIL";

export type AgentClaim =
  | { readonly kind: "tests_added" }
  | { readonly kind: "files_changed_only"; readonly paths: readonly string[] }
  | { readonly kind: "prose"; readonly text: string };

export interface AgentEvidence {
  readonly kind: EvidenceKind;
  readonly subjectSha: string;
  readonly status: EvidenceStatus;
  readonly producer: ProducerKind;
  readonly independent: boolean;
}

export interface AgentChangeSnapshot {
  readonly schemaVersion: "agent-change-assurance/v1";
  readonly provenance: { readonly label: string; readonly url?: string };
  readonly repository: string;
  readonly pullRequest?: string | number;
  readonly expectedCandidateSha: string;
  readonly reviewedCandidateSha: string;
  readonly baseSha: string;
  readonly changedPaths: readonly string[];
  readonly additions: number;
  readonly deletions: number;
  readonly claims: readonly AgentClaim[];
  readonly evidence: readonly AgentEvidence[];
  readonly requiredEvidenceKinds: readonly EvidenceKind[];
}

export type AssuranceDecision = "FAST_TRACK" | "REQUEST_EVIDENCE" | "ESCALATE";
export type AssuranceRiskTier = "LOW" | "MEDIUM" | "HIGH";
export type FindingCode =
  | "CANDIDATE_DRIFT"
  | "CLAIM_DIFF_MISMATCH"
  | "FAILED_EVIDENCE"
  | "STALE_EVIDENCE"
  | "MISSING_EVIDENCE"
  | "HIGH_RISK_PATH"
  | "LARGE_CHANGE"
  | "SELF_VERIFIED_ONLY";

export interface AssuranceFinding {
  readonly code: FindingCode;
  readonly subject: string;
  readonly detail: string;
}

export interface ValidAssuranceResult {
  readonly valid: true;
  readonly authority: "NONE";
  readonly identityBasis: "DECLARED_UNVERIFIED";
  readonly decision: AssuranceDecision;
  readonly riskTier: AssuranceRiskTier;
  readonly findings: readonly AssuranceFinding[];
  readonly evidenceBindings: readonly {
    kind: EvidenceKind;
    state: "CANDIDATE_BOUND" | "OTHER_CANDIDATE" | "FAILED" | "MISSING";
    independent: boolean;
  }[];
  readonly nextAction: string;
}

export interface InvalidAssuranceResult {
  readonly valid: false;
  readonly code: "INVALID_ASSURANCE_SNAPSHOT";
  readonly authority: "NONE";
  readonly identityBasis: "DECLARED_UNVERIFIED";
}
export type AssuranceResult = ValidAssuranceResult | InvalidAssuranceResult;
export type ConnectedAssuranceResult =
  | (Omit<ValidAssuranceResult, "identityBasis"> & {
      readonly identityBasis: "LOCAL_GIT_OBSERVED";
      readonly claimBasis: "NOT_OBSERVED";
      readonly evidenceBasis: "NO_EXECUTABLE_EVIDENCE";
    })
  | InvalidAssuranceResult;

export const LARGE_CHANGE_LINE_THRESHOLD = 500;
export const LARGE_CHANGE_PATH_THRESHOLD = 20;
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ROOT_KEYS = ["schemaVersion", "provenance", "repository", "pullRequest", "expectedCandidateSha", "reviewedCandidateSha", "baseSha", "changedPaths", "additions", "deletions", "claims", "evidence", "requiredEvidenceKinds"] as const;
const FINDING_ORDER: readonly FindingCode[] = ["CANDIDATE_DRIFT", "CLAIM_DIFF_MISMATCH", "FAILED_EVIDENCE", "STALE_EVIDENCE", "MISSING_EVIDENCE", "HIGH_RISK_PATH", "LARGE_CHANGE", "SELF_VERIFIED_ONLY"];
const INVALID: InvalidAssuranceResult = Object.freeze({ valid: false, code: "INVALID_ASSURANCE_SNAPSHOT", authority: "NONE", identityBasis: "DECLARED_UNVERIFIED" });

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => required.includes(key) || optional.includes(key));
}
function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 1000;
}
function canonicalPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || new TextEncoder().encode(value).length > 500 || value.normalize("NFC") !== value || /[\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith("/") || value.endsWith("/") || value.includes("\\") || /%2f|%5c/i.test(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}
function unique<T>(values: readonly T[]): boolean { return new Set(values).size === values.length; }
function validCount(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function denseArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
    && Object.getPrototypeOf(value) === Array.prototype
    && Object.keys(value).length === value.length
    && value.every((_, index) => Object.hasOwn(value, index));
}
function validStringList(value: unknown, pathMode = false): value is string[] {
  return denseArray(value) && value.length > 0 && value.every(pathMode ? canonicalPath : nonEmptyString) && unique(value);
}
function validProvenance(value: unknown): boolean {
  if (!isRecord(value) || !exactKeys(value, ["label"], ["url"]) || !nonEmptyString(value.label)) return false;
  return value.url === undefined || (nonEmptyString(value.url) && /^https:\/\/[^\s]+$/.test(value.url));
}
function validClaim(value: unknown): value is AgentClaim {
  if (!isRecord(value) || !nonEmptyString(value.kind)) return false;
  if (value.kind === "tests_added") return exactKeys(value, ["kind"]);
  if (value.kind === "files_changed_only") return exactKeys(value, ["kind", "paths"]) && validStringList(value.paths, true);
  if (value.kind === "prose") return exactKeys(value, ["kind", "text"]) && nonEmptyString(value.text);
  return false;
}
function validEvidence(value: unknown): value is AgentEvidence {
  return isRecord(value) && exactKeys(value, ["kind", "subjectSha", "status", "producer", "independent"])
    && EVIDENCE_KINDS.includes(value.kind as EvidenceKind)
    && typeof value.subjectSha === "string" && SHA.test(value.subjectSha)
    && (value.status === "PASS" || value.status === "FAIL")
    && PRODUCER_KINDS.includes(value.producer as ProducerKind) && typeof value.independent === "boolean";
}
function admitSnapshot(input: unknown): AgentChangeSnapshot | null {
  if (!isRecord(input) || !exactKeys(input, ROOT_KEYS.filter((key) => key !== "pullRequest"), ["pullRequest"])) return null;
  if (input.schemaVersion !== "agent-change-assurance/v1" || !validProvenance(input.provenance) || !nonEmptyString(input.repository)) return null;
  if (input.pullRequest !== undefined && !(nonEmptyString(input.pullRequest) || (validCount(input.pullRequest) && input.pullRequest > 0))) return null;
  if (![input.expectedCandidateSha, input.reviewedCandidateSha, input.baseSha].every((value) => typeof value === "string" && SHA.test(value))) return null;
  if (!validStringList(input.changedPaths, true) || !validCount(input.additions) || !validCount(input.deletions)) return null;
  if (!denseArray(input.claims) || !input.claims.every(validClaim) || !unique(input.claims.map((claim) => claim.kind))) return null;
  if (!denseArray(input.evidence) || !input.evidence.every(validEvidence)) return null;
  if (!denseArray(input.requiredEvidenceKinds) || input.requiredEvidenceKinds.length === 0 || !input.requiredEvidenceKinds.every((kind) => EVIDENCE_KINDS.includes(kind as EvidenceKind)) || !unique(input.requiredEvidenceKinds)) return null;
  return structuredClone(input) as unknown as AgentChangeSnapshot;
}
function compareCodePoints(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
function isDependencyLockfile(basename: string): boolean {
  return basename.endsWith(".lock")
    || basename.endsWith(".lockfile")
    || basename === "packages.lock.json"
    || basename === "package.resolved"
    || basename === "package-lock.json"
    || basename === "npm-shrinkwrap.json"
    || basename === "pnpm-lock.yaml"
    || basename === "bun.lockb"
    || basename === "go.sum";
}
function isHighRiskPath(path: string): boolean {
  const segments = path.toLowerCase().split("/");
  const basename = segments.at(-1) ?? "";
  const sensitiveNames = [
    "auth", "authentication", "authorization", "permissions", "iam", "rbac", "acl",
    "security", "migration", "migrations", "schema", "infra", "infrastructure",
    "deploy", "ci", "cd", "pipeline", "pipelines", "workflow", "workflows",
    "secret", "secrets", "config",
  ];
  const basenameStem = basename.includes(".") ? basename.slice(0, basename.indexOf(".")) : basename;
  return segments.some((segment) => sensitiveNames.includes(segment))
    || sensitiveNames.includes(basenameStem)
    || (segments[0] === ".github" && segments[1] === "workflows")
    || basename === ".env" || basename.startsWith(".env.")
    || isDependencyLockfile(basename);
}

export function evaluateAgentChange(input: unknown): AssuranceResult {
  const value = admitSnapshot(input);
  if (!value) return INVALID;
  const findings: AssuranceFinding[] = [];
  const add = (code: FindingCode, subject: string, detail: string) => findings.push({ code, subject, detail });
  if (value.reviewedCandidateSha !== value.expectedCandidateSha) add("CANDIDATE_DRIFT", value.reviewedCandidateSha, "Declared reviewed SHA differs from the declared expected candidate SHA.");
  const hasTestPath = value.changedPaths.some((path) => /(^|\/)(__tests__|tests?|spec)(\/|\.|$)|\.(test|spec)\.[^/]+$/i.test(path));
  if (value.claims.some((claim) => claim.kind === "tests_added") && !hasTestPath) add("CLAIM_DIFF_MISMATCH", "tests_added", "tests_added is unsupported by the declared changed-path list.");
  for (const claim of value.claims) if (claim.kind === "files_changed_only" && value.changedPaths.some((path) => !claim.paths.includes(path))) add("CLAIM_DIFF_MISMATCH", "files_changed_only", "files_changed_only omits one or more declared changed paths.");
  for (const kind of [...new Set(value.evidence.filter((entry) => entry.status === "FAIL").map((entry) => entry.kind))].sort(compareCodePoints)) add("FAILED_EVIDENCE", kind, `${kind} evidence declares failure.`);
  for (const kind of [...new Set(value.evidence.filter((entry) => entry.subjectSha !== value.expectedCandidateSha).map((entry) => entry.kind))].sort(compareCodePoints)) add("STALE_EVIDENCE", kind, `${kind} evidence is bound to another declared candidate.`);

  const evidenceBindings = [...value.requiredEvidenceKinds].sort(compareCodePoints).map((kind) => {
    const matching = value.evidence.filter((entry) => entry.kind === kind);
    const candidatePasses = matching.filter((entry) => entry.status === "PASS" && entry.subjectSha === value.expectedCandidateSha);
    if (candidatePasses.length === 0) add("MISSING_EVIDENCE", kind, `${kind} has no candidate-bound passing evidence.`);
    const failed = matching.some((entry) => entry.status === "FAIL");
    const independent = candidatePasses.some((entry) => entry.producer !== "agent" && entry.independent);
    if (candidatePasses.length > 0 && !independent) add("SELF_VERIFIED_ONLY", kind, `${kind} has only agent or declared non-independent evidence.`);
    return { kind, state: failed ? "FAILED" as const : candidatePasses.length > 0 ? "CANDIDATE_BOUND" as const : matching.length > 0 ? "OTHER_CANDIDATE" as const : "MISSING" as const, independent };
  });
  const highRiskPath = [...value.changedPaths].sort(compareCodePoints).find(isHighRiskPath);
  if (highRiskPath) add("HIGH_RISK_PATH", highRiskPath, `Local v1 policy-sensitive path changed: ${highRiskPath}`);
  const largeChange = value.additions + value.deletions >= LARGE_CHANGE_LINE_THRESHOLD || value.changedPaths.length >= LARGE_CHANGE_PATH_THRESHOLD;
  if (largeChange) add("LARGE_CHANGE", `${value.changedPaths.length}:${value.additions + value.deletions}`, `Local v1 policy threshold reached: ${LARGE_CHANGE_PATH_THRESHOLD} paths or ${LARGE_CHANGE_LINE_THRESHOLD} changed lines.`);
  findings.sort((left, right) => FINDING_ORDER.indexOf(left.code) - FINDING_ORDER.indexOf(right.code) || compareCodePoints(left.subject, right.subject));

  const escalates = findings.some((finding) => ["CANDIDATE_DRIFT", "CLAIM_DIFF_MISMATCH", "FAILED_EVIDENCE", "HIGH_RISK_PATH"].includes(finding.code));
  const machineClaimPresent = value.claims.some((claim) => claim.kind === "tests_added" || claim.kind === "files_changed_only");
  const decision: AssuranceDecision = escalates ? "ESCALATE" : findings.length > 0 || !machineClaimPresent ? "REQUEST_EVIDENCE" : "FAST_TRACK";
  const nextAction = decision === "FAST_TRACK"
    ? "No ACA exception; continue normal protected PR review and required checks."
    : decision === "REQUEST_EVIDENCE"
      ? `Provide candidate-bound independent evidence${machineClaimPresent ? "" : " and a supported machine-checkable claim"} for the declared candidate.`
      : "Prepare Release Guardian review for the declared contradiction or local v1 policy risk; no command has been issued.";
  return deepFreeze({ valid: true, authority: "NONE", identityBasis: "DECLARED_UNVERIFIED", decision, riskTier: highRiskPath ? "HIGH" : largeChange ? "MEDIUM" : "LOW", findings, evidenceBindings, nextAction });
}

export function evaluateConnectedAgentChange(input: unknown): ConnectedAssuranceResult {
  const result = evaluateAgentChange(input);
  if (!result.valid) return result;
  return deepFreeze({
    ...result,
    identityBasis: "LOCAL_GIT_OBSERVED",
    claimBasis: "NOT_OBSERVED",
    evidenceBasis: "NO_EXECUTABLE_EVIDENCE",
  });
}
