import { describe, expect, it } from "vitest";
import { evaluateAgentChange, type AgentChangeSnapshot } from "./agentChangeAssurance";

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

  it.each(["src/auth/session.ts", "db/migrations/001.sql", "infra/deploy/main.tf", ".github/workflows/ci.yml", "config/runtime.json", ".env.production", "package-lock.json"])("escalates local v1 policy path %s", (path) => {
    const result = evaluateAgentChange(cleanSnapshot({ changedPaths: ["docs/readme.md", path], claims: [{ kind: "files_changed_only", paths: ["docs/readme.md", path] }] }));
    expect(result).toMatchObject({ valid: true, decision: "ESCALATE", riskTier: "HIGH" });
  });
});
