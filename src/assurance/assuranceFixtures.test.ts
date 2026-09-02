import { describe, expect, it } from "vitest";
import { evaluateAgentChange } from "./agentChangeAssurance";
import { assuranceFixtures } from "./assuranceFixtures";

describe("Agent Change Assurance research fixtures", () => {
  it("uses verified public sources and an honestly named WorkHub declaration", () => {
    expect(assuranceFixtures.map((fixture) => [fixture.id, fixture.label, fixture.snapshot.provenance.url ?? null])).toEqual([
      ["codex-wrong-diff", "Codex wrong-diff illustrative declaration", "https://github.com/openai/codex/issues/8404"],
      ["codex-stale-merge-base", "Codex stale-merge-base illustrative declaration", "https://github.com/openai/codex/issues/30751"],
      ["agent-message-code-inconsistency", "Agent message/code inconsistency illustrative declaration", "https://arxiv.org/abs/2601.04886v2"],
      ["illustrative-workhub-declaration", "Illustrative WorkHub declaration", null],
      ["clean-mechanical-change", "Bounded clean mechanical declaration", null],
    ]);
  });

  it("routes fixtures against independent fixed outcomes without fixture-owned expected decisions", () => {
    const expected = new Map([
      ["codex-wrong-diff", "ESCALATE"],
      ["codex-stale-merge-base", "ESCALATE"],
      ["agent-message-code-inconsistency", "ESCALATE"],
      ["illustrative-workhub-declaration", "REQUEST_EVIDENCE"],
      ["clean-mechanical-change", "FAST_TRACK"],
    ]);
    for (const fixture of assuranceFixtures) {
      const result = evaluateAgentChange(fixture.snapshot);
      expect(result).toMatchObject({ valid: true, decision: expected.get(fixture.id) });
      expect("expectedDecision" in fixture).toBe(false);
    }
  });
});
