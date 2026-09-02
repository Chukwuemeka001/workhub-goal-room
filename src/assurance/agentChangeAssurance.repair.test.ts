import { describe, expect, it } from "vitest";
import { evaluateAgentChange, type AgentChangeSnapshot } from "./agentChangeAssurance";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

export function admittedSnapshot(overrides: Partial<AgentChangeSnapshot> = {}): AgentChangeSnapshot {
  return {
    schemaVersion: "agent-change-assurance/v1",
    provenance: { label: "Inline adversarial declaration" },
    repository: "example/repo",
    pullRequest: 42,
    expectedCandidateSha: SHA_A,
    reviewedCandidateSha: SHA_A,
    baseSha: SHA_B,
    changedPaths: ["src/value.ts"],
    additions: 3,
    deletions: 1,
    claims: [{ kind: "files_changed_only", paths: ["src/value.ts"] }],
    evidence: [{ kind: "unit", subjectSha: SHA_A, status: "PASS", producer: "independent_ci", independent: true }],
    requiredEvidenceKinds: ["unit"],
    ...overrides,
  };
}

describe("Agent Change Assurance runtime authority admission", () => {
  it("labels a fabricated but well-formed matching declaration as authority-free and unverified", () => {
    expect(evaluateAgentChange(admittedSnapshot())).toMatchObject({
      valid: true,
      authority: "NONE",
      identityBasis: "DECLARED_UNVERIFIED",
      decision: "FAST_TRACK",
      riskTier: "LOW",
    });
  });

  it.each([
    [null, "null"],
    [{}, "missing keys"],
    [{ ...admittedSnapshot(), extra: true }, "unknown root key"],
    [{ ...admittedSnapshot(), expectedCandidateSha: "abc" }, "invalid SHA"],
    [{ ...admittedSnapshot(), additions: true }, "boolean count"],
    [{ ...admittedSnapshot(), additions: -1 }, "negative count"],
    [{ ...admittedSnapshot(), additions: 1.5 }, "fractional count"],
    [{ ...admittedSnapshot(), requiredEvidenceKinds: [] }, "empty requirements"],
    [{ ...admittedSnapshot(), requiredEvidenceKinds: ["unit", "unit"] }, "duplicate requirements"],
    [{ ...admittedSnapshot(), claims: [{ kind: "unknown" }] }, "unknown claim"],
    [{ ...admittedSnapshot(), evidence: [{ ...admittedSnapshot().evidence[0], status: "UNKNOWN" }] }, "unknown evidence status"],
    [{ ...admittedSnapshot(), evidence: [{ ...admittedSnapshot().evidence[0], producer: "mystery" }] }, "unknown producer"],
    [{ ...admittedSnapshot(), evidence: [{ ...admittedSnapshot().evidence[0], extra: 1 }] }, "unknown evidence key"],
  ] as [unknown, string][])("rejects %s (%s) without a decision or risk", (input, _label) => {
    const result = evaluateAgentChange(input);
    expect(result).toEqual({
      valid: false,
      code: "INVALID_ASSURANCE_SNAPSHOT",
      authority: "NONE",
      identityBasis: "DECLARED_UNVERIFIED",
    });
    expect("decision" in result).toBe(false);
    expect("riskTier" in result).toBe(false);
  });
});

describe("Agent Change Assurance fail-closed policy semantics", () => {
  it.each(["./src/a.ts", "src/../.github/workflows/x.yml", "src//a.ts", "src\\a.ts", "/src/a.ts", "src/%2fsecret", "src/é.ts", "src/\u0000a.ts"])("rejects noncanonical Git path %j", (path) => {
    expect(evaluateAgentChange(admittedSnapshot({ changedPaths: [path], claims: [{ kind: "files_changed_only", paths: [path] }] }))).toMatchObject({ valid: false, code: "INVALID_ASSURANCE_SNAPSHOT" });
  });

  it("admits canonical NFC Git paths", () => {
    expect(evaluateAgentChange(admittedSnapshot({ changedPaths: ["src/é.ts"], claims: [{ kind: "files_changed_only", paths: ["src/é.ts"] }] }))).toMatchObject({ valid: true });
  });

  it("escalates a config-sensitive path hidden after a benign path", () => {
    const result = evaluateAgentChange(admittedSnapshot({ changedPaths: ["docs/readme.md", "config/runtime.production.json"], claims: [{ kind: "files_changed_only", paths: ["docs/readme.md", "config/runtime.production.json"] }] }));
    expect(result).toMatchObject({ valid: true, decision: "ESCALATE", riskTier: "HIGH" });
    if (result.valid) expect(result.findings).toContainEqual(expect.objectContaining({ code: "HIGH_RISK_PATH", subject: "config/runtime.production.json" }));
  });

  it("treats an agent producer as non-independent even when declared independent", () => {
    const result = evaluateAgentChange(admittedSnapshot({ evidence: [{ kind: "unit", subjectSha: SHA_A, status: "PASS", producer: "agent", independent: true }] }));
    expect(result).toMatchObject({ valid: true, decision: "REQUEST_EVIDENCE", evidenceBindings: [{ kind: "unit", state: "CANDIDATE_BOUND", independent: false }] });
    if (result.valid) expect(result.findings.map((finding) => finding.code)).toEqual(["SELF_VERIFIED_ONLY"]);
  });

  it("evaluates independence separately for every required evidence kind", () => {
    const result = evaluateAgentChange(admittedSnapshot({ evidence: [
      { kind: "unit", subjectSha: SHA_A, status: "PASS", producer: "independent_ci", independent: true },
      { kind: "lint", subjectSha: SHA_A, status: "PASS", producer: "agent", independent: false },
    ], requiredEvidenceKinds: ["unit", "lint"] }));
    expect(result).toMatchObject({ valid: true, decision: "REQUEST_EVIDENCE" });
    if (result.valid) expect(result.findings).toContainEqual(expect.objectContaining({ code: "SELF_VERIFIED_ONLY", subject: "lint" }));
  });

  it("keeps stale and failed findings when a candidate-bound pass also exists", () => {
    const result = evaluateAgentChange(admittedSnapshot({ evidence: [
      { kind: "unit", subjectSha: SHA_A, status: "PASS", producer: "independent_ci", independent: true },
      { kind: "unit", subjectSha: SHA_B, status: "PASS", producer: "independent_ci", independent: true },
      { kind: "unit", subjectSha: SHA_A, status: "FAIL", producer: "independent_ci", independent: true },
    ] }));
    expect(result).toMatchObject({ valid: true, decision: "ESCALATE" });
    if (result.valid) expect(result.findings.map((finding) => finding.code)).toEqual(["FAILED_EVIDENCE", "STALE_EVIDENCE"]);
  });

  it("requires a supported machine-checkable claim before FAST_TRACK", () => {
    const result = evaluateAgentChange(admittedSnapshot({ claims: [{ kind: "prose", text: "Everything is fine." }] }));
    expect(result).toMatchObject({ valid: true, decision: "REQUEST_EVIDENCE" });
    if (result.valid) expect(result.nextAction).toContain("supported machine-checkable claim");
  });

  it("uses fixed finding order and code-point subject order", () => {
    const result = evaluateAgentChange(admittedSnapshot({ reviewedCandidateSha: SHA_B, changedPaths: ["src/z.ts"], claims: [{ kind: "tests_added" }], evidence: [
      { kind: "unit", subjectSha: SHA_B, status: "FAIL", producer: "agent", independent: true },
      { kind: "lint", subjectSha: SHA_B, status: "FAIL", producer: "agent", independent: true },
    ], requiredEvidenceKinds: ["unit", "lint"] }));
    if (!result.valid) throw new Error("expected valid snapshot");
    expect(result.findings.map(({ code, subject }) => `${code}:${subject}`)).toEqual([
      `CANDIDATE_DRIFT:${SHA_B}`, "CLAIM_DIFF_MISMATCH:tests_added", "FAILED_EVIDENCE:lint", "FAILED_EVIDENCE:unit",
      "STALE_EVIDENCE:lint", "STALE_EVIDENCE:unit", "MISSING_EVIDENCE:lint", "MISSING_EVIDENCE:unit",
    ]);
  });

  it.each([[499, "FAST_TRACK"], [500, "REQUEST_EVIDENCE"], [501, "REQUEST_EVIDENCE"]] as const)("pins the local v1 churn boundary at %i", (additions, decision) => {
    expect(evaluateAgentChange(admittedSnapshot({ additions, deletions: 0 }))).toMatchObject({ valid: true, decision });
  });

  it("returns deeply immutable results detached from later input mutation", () => {
    const input = admittedSnapshot();
    const result = evaluateAgentChange(input);
    if (!result.valid) throw new Error("expected valid snapshot");
    (input.changedPaths as string[])[0] = "src/changed.ts";
    expect(result.findings).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.evidenceBindings)).toBe(true);
    expect(() => ((result.evidenceBindings as unknown) as { kind: string }[])[0].kind = "lint").toThrow();
    expect(evaluateAgentChange(admittedSnapshot())).toEqual(result);
  });
});
