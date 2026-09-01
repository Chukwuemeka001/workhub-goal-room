import { describe, expect, it } from "vitest";
import { evaluateAgentChange, evaluateConnectedAgentChange, type AgentChangeSnapshot } from "./agentChangeAssurance";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
function cleanSnapshot(overrides: Partial<AgentChangeSnapshot> = {}): AgentChangeSnapshot {
  return {
    schemaVersion: "agent-change-assurance/v1",
    provenance: { label: "Bounded mechanical declaration" },
    repository: "workhub",
    pullRequest: 42,
    expectedCandidateSha: SHA_A,
    reviewedCandidateSha: SHA_A,
    baseSha: SHA_B,
    changedPaths: ["src/copy.ts"],
    additions: 4,
    deletions: 2,
    claims: [{ kind: "files_changed_only", paths: ["src/copy.ts"] }],
    evidence: [{ kind: "unit", subjectSha: SHA_A, status: "PASS", producer: "independent_ci", independent: true }],
    requiredEvidenceKinds: ["unit"],
    ...overrides,
  };
}

describe("evaluateAgentChange routing", () => {
  it("fast-tracks only as authority-free continuation advice", () => {
    expect(evaluateAgentChange(cleanSnapshot())).toEqual({
      valid: true,
      authority: "NONE",
      identityBasis: "DECLARED_UNVERIFIED",
      decision: "FAST_TRACK",
      riskTier: "LOW",
      findings: [],
      evidenceBindings: [{ kind: "unit", state: "CANDIDATE_BOUND", independent: true }],
      nextAction: "No ACA exception; continue normal protected PR review and required checks.",
    });
  });

  it.each([
    [{ reviewedCandidateSha: SHA_B }, "CANDIDATE_DRIFT", "ESCALATE"],
    [{ evidence: [{ kind: "unit", subjectSha: SHA_B, status: "PASS", producer: "independent_ci", independent: true }] }, "STALE_EVIDENCE", "REQUEST_EVIDENCE"],
    [{ evidence: [] }, "MISSING_EVIDENCE", "REQUEST_EVIDENCE"],
    [{ evidence: [{ kind: "unit", subjectSha: SHA_A, status: "FAIL", producer: "independent_ci", independent: true }] }, "FAILED_EVIDENCE", "ESCALATE"],
    [{ evidence: [{ kind: "unit", subjectSha: SHA_A, status: "PASS", producer: "agent", independent: false }] }, "SELF_VERIFIED_ONLY", "REQUEST_EVIDENCE"],
  ] as const)("routes declared defect %#", (overrides, finding, decision) => {
    const result = evaluateAgentChange(cleanSnapshot(overrides as Partial<AgentChangeSnapshot>));
    expect(result).toMatchObject({ valid: true, decision });
    if (result.valid) expect(result.findings.map((entry) => entry.code)).toContain(finding);
  });

  it("uses conservative claim wording for tests_added", () => {
    const result = evaluateAgentChange(cleanSnapshot({ claims: [{ kind: "tests_added" }] }));
    expect(result).toMatchObject({ valid: true, decision: "ESCALATE" });
    if (result.valid) expect(result.findings[0].detail).toBe("tests_added is unsupported by the declared changed-path list.");
  });

  it("refuses malformed connected policy-path custody without invoking accessors or throwing", () => {
    const sparse = Array(1) as string[];
    expect(evaluateConnectedAgentChange(cleanSnapshot(), sparse)).toEqual({
      valid: false,
      code: "INVALID_ASSURANCE_SNAPSHOT",
      authority: "NONE",
      identityBasis: "DECLARED_UNVERIFIED",
    });
    let getterCalls = 0;
    const accessor = [] as string[];
    Object.defineProperty(accessor, "0", { enumerable: true, configurable: true, get: () => { getterCalls++; return "src/auth/old.ts"; } });
    accessor.length = 1;
    expect(evaluateConnectedAgentChange(cleanSnapshot(), accessor)).toEqual({
      valid: false,
      code: "INVALID_ASSURANCE_SNAPSHOT",
      authority: "NONE",
      identityBasis: "DECLARED_UNVERIFIED",
    });
    expect(getterCalls).toBe(0);
  });

  it("keeps diff-size accounting on destinations while evaluating admitted rename-source risk", () => {
    const destinations = Array.from({ length: 10 }, (_, index) => `src/renamed-${index}.ts`);
    const touched = destinations.flatMap((path, index) => [path, index === 0 ? "src/auth/old.ts" : `src/old-${index}.ts`]);
    const result = evaluateConnectedAgentChange(cleanSnapshot({
      changedPaths: destinations,
      claims: [],
      evidence: [],
      requiredEvidenceKinds: ["unit", "build"],
    }), touched);
    expect(result).toMatchObject({ valid: true, decision: "ESCALATE", riskTier: "HIGH" });
    if (result.valid) {
      expect(result.findings).toEqual(expect.arrayContaining([{ code: "HIGH_RISK_PATH", subject: "src/auth/old.ts", detail: expect.any(String) }]));
      expect(result.findings.some((finding) => finding.code === "LARGE_CHANGE")).toBe(false);
    }
  });

  it.each(["src/auth/session.ts", "db/migrations/001.sql", "infra/deploy/main.tf", ".github/workflows/ci.yml", "config/runtime.json", ".env.production", "package-lock.json"])("escalates local v1 policy path %s", (path) => {
    const result = evaluateAgentChange(cleanSnapshot({ changedPaths: ["docs/readme.md", path], claims: [{ kind: "files_changed_only", paths: ["docs/readme.md", path] }] }));
    expect(result).toMatchObject({ valid: true, decision: "ESCALATE", riskTier: "HIGH" });
  });
});
