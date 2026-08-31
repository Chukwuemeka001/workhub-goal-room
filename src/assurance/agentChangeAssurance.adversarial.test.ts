import { describe, expect, it } from "vitest";
import main from "../main.ts?raw";
import assuranceUi from "./assuranceUi.ts?raw";
import { evaluateAgentChange, type AgentChangeSnapshot } from "./agentChangeAssurance";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
function snapshot(overrides: Partial<AgentChangeSnapshot> = {}): AgentChangeSnapshot {
  return {
    schemaVersion: "agent-change-assurance/v1",
    provenance: { label: "Independent inline adversarial declaration" },
    repository: "example/repo",
    expectedCandidateSha: SHA_A,
    reviewedCandidateSha: SHA_A,
    baseSha: SHA_B,
    changedPaths: ["src/value.ts", "src/value.test.ts"],
    additions: 12,
    deletions: 4,
    claims: [{ kind: "tests_added" }, { kind: "prose", text: "Tests pass; this prose is not proof." }],
    evidence: [{ kind: "unit", subjectSha: SHA_A, status: "PASS", producer: "independent_ci", independent: true }],
    requiredEvidenceKinds: ["unit"],
    ...overrides,
  };
}

describe("Agent Change Assurance independent adversarial boundaries", () => {
  it("returns byte-identical canonical results when admitted collections are reordered", () => {
    const input = snapshot({
      reviewedCandidateSha: SHA_B,
      changedPaths: ["src/value.test.ts", "infra/deploy/main.tf"],
      claims: [{ kind: "tests_added" }, { kind: "prose", text: "Display only" }],
      evidence: [
        { kind: "unit", subjectSha: SHA_B, status: "FAIL", producer: "agent", independent: true },
        { kind: "lint", subjectSha: SHA_B, status: "PASS", producer: "local_tool", independent: false },
      ],
      requiredEvidenceKinds: ["unit", "lint"],
    });
    const reordered = { ...input, changedPaths: [...input.changedPaths].reverse(), claims: [...input.claims].reverse(), evidence: [...input.evidence].reverse(), requiredEvidenceKinds: [...input.requiredEvidenceKinds].reverse() };
    expect(JSON.stringify(evaluateAgentChange(reordered))).toBe(JSON.stringify(evaluateAgentChange(input)));
  });

  it("does not mutate a deeply frozen valid input", () => {
    const input = snapshot();
    Object.freeze(input.changedPaths);
    Object.freeze(input.claims);
    Object.freeze(input.evidence);
    Object.freeze(input.requiredEvidenceKinds);
    Object.freeze(input.provenance);
    Object.freeze(input);
    const before = JSON.stringify(input);
    expect(evaluateAgentChange(input)).toMatchObject({ valid: true, decision: "FAST_TRACK" });
    expect(JSON.stringify(input)).toBe(before);
  });

  it("gives the UI only DOM handoff capabilities and no authority callback/import", () => {
    expect(assuranceUi).not.toMatch(/onEscalate|goalRoom|ownerController|webmcp|room\.dispatch|controller\.|registerTool|installGoalRoomTools/);
    expect(assuranceUi).not.toContain("readonly ownerIntent:");
    expect(assuranceUi).toContain('readonly releaseGuardianRoot: Pick<HTMLElement, "querySelector" | "scrollIntoView">');
    expect(assuranceUi).toContain('querySelector<HTMLTextAreaElement>("#desktop-owner-intent")');
    const integration = main.slice(main.indexOf('createAssuranceCockpit(requiredElement("assurance-cockpit")'), main.indexOf("const systemVerifier"));
    expect(integration).not.toMatch(/controller\.|room\.|dispatch\(|submit\(|click\(|onEscalate/);
    expect(integration).not.toContain('ownerIntent: requiredElement<HTMLTextAreaElement>("desktop-owner-intent")');
    expect(integration).toContain('releaseGuardianRoot: requiredElement("desktop-room")');
  });
});
