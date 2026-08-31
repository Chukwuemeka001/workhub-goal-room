import { describe, expect, it } from "vitest";
import { evaluateAgentChange, type AgentChangeSnapshot } from "./agentChangeAssurance";

const A = "a".repeat(40);
const B = "b".repeat(40);

function validSnapshot(): AgentChangeSnapshot {
  return {
    schemaVersion: "agent-change-assurance/v1",
    provenance: { label: "Parent verifier literal" },
    repository: "example/repo",
    expectedCandidateSha: A,
    reviewedCandidateSha: A,
    baseSha: B,
    changedPaths: ["src/copy.ts"],
    additions: 2,
    deletions: 1,
    claims: [{ kind: "files_changed_only", paths: ["src/copy.ts"] }],
    evidence: [{ kind: "unit", subjectSha: A, status: "PASS", producer: "independent_ci", independent: true }],
    requiredEvidenceKinds: ["unit"],
  };
}

describe("parent-side Agent Change Assurance fault probes", () => {
  it("rejects a coercible object instead of admitting it as an evidence SHA string", () => {
    const input = structuredClone(validSnapshot()) as unknown as Record<string, unknown>;
    input.evidence = [{
      kind: "unit",
      subjectSha: new String(A),
      status: "PASS",
      producer: "independent_ci",
      independent: true,
    }];

    expect(evaluateAgentChange(input)).toEqual({
      valid: false,
      code: "INVALID_ASSURANCE_SNAPSHOT",
      authority: "NONE",
      identityBasis: "DECLARED_UNVERIFIED",
    });
  });

  it.each([
    "src/auth.ts", "src/authentication/session.ts", "schema.prisma", "deploy.yml",
    "config.ts", "db/migration.sql", "ci/pipeline.yml", "composer.lock",
  ])(
    "routes a sensitive file stem to high-risk escalation: %s",
    (path) => {
      const result = evaluateAgentChange({
        ...validSnapshot(),
        changedPaths: ["docs/readme.md", path],
        claims: [{ kind: "files_changed_only", paths: ["docs/readme.md", path] }],
      });

      expect(result).toMatchObject({ valid: true, decision: "ESCALATE", riskTier: "HIGH" });
      expect(result.valid && result.findings.map((finding) => finding.code)).toContain("HIGH_RISK_PATH");
    },
  );

  it.each([
    "gradle.lockfile", "packages.lock.json", "Podfile.lock", "Package.resolved",
    "pubspec.lock", "flake.lock", "deno.lock", "Cargo.lock", "go.sum",
    "pnpm-lock.yaml", "package-lock.json", "npm-shrinkwrap.json",
  ])("routes a dependency lock surface to high-risk escalation: %s", (path) => {
    const result = evaluateAgentChange({
      ...validSnapshot(),
      changedPaths: [path],
      claims: [{ kind: "files_changed_only", paths: [path] }],
    });

    expect(result).toMatchObject({ valid: true, decision: "ESCALATE", riskTier: "HIGH" });
    expect(result.valid && result.findings.map((finding) => finding.code)).toContain("HIGH_RISK_PATH");
  });

  it.each([
    "docs/lockfile-guide.md", "src/package-lock-parser.ts", "notes/podfile.lock.md",
    "fixtures/package.resolved.txt", "docs/go.sum.example",
  ])("does not classify a lockfile-like near miss as a sensitive path: %s", (path) => {
    const result = evaluateAgentChange({
      ...validSnapshot(),
      changedPaths: [path],
      claims: [{ kind: "files_changed_only", paths: [path] }],
    });

    expect(result).toMatchObject({ valid: true, decision: "FAST_TRACK", riskTier: "LOW" });
    expect(result.valid && result.findings.map((finding) => finding.code)).not.toContain("HIGH_RISK_PATH");
  });

  it.each(["changedPaths", "claims", "evidence", "requiredEvidenceKinds"] as const)(
    "rejects a sparse %s array instead of skipping its missing element",
    (field) => {
      const input = { ...validSnapshot(), [field]: new Array(1) };
      expect(evaluateAgentChange(input)).toEqual({
        valid: false,
        code: "INVALID_ASSURANCE_SNAPSHOT",
        authority: "NONE",
        identityBasis: "DECLARED_UNVERIFIED",
      });
    },
  );

  it("rejects an inherited changed path instead of cloning it into an undefined entry", () => {
    const inherited = new Array(1);
    const inheritedPrototype = Object.create(Array.prototype) as string[];
    inheritedPrototype[0] = "src/authentication/session.ts";
    Object.setPrototypeOf(inherited, inheritedPrototype);

    expect(evaluateAgentChange({ ...validSnapshot(), changedPaths: inherited })).toEqual({
      valid: false,
      code: "INVALID_ASSURANCE_SNAPSHOT",
      authority: "NONE",
      identityBasis: "DECLARED_UNVERIFIED",
    });
  });
});
