import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  PHASE8_HOSTILE_MARKERS,
  PHASE8_REVISION_PROBE_CODE_POINTS,
  buildPhase8Authority,
  codePointLength,
} from "./phase8-authoritative";

const listFields = ["doneLooksLike", "constraints", "nonGoals", "evidenceRequired", "openQuestions"] as const;

describe("Phase 8 QA-only authoritative max/hostile source", () => {
  it("admits exact producer-valid Goal and Plan boundaries through WebMCP and owner controller", async () => {
    const result = await buildPhase8Authority("accepted");
    const state = result.room.getState();
    expect(result.registrationStatus).toBe("registered");
    expect(result.registrationOrder).toEqual([
      "get_goal_room_state", "propose_goal_contract", "propose_plan",
      "claim_step", "submit_artifact", "request_completion",
    ]);
    expect(state.phase).toBe("GOAL_ACCEPTED");
    expect(state.stateVersion).toBe(16);
    expect(state.goalContractHistory).toHaveLength(2);
    for (const goal of state.goalContractHistory) {
      expect(codePointLength(goal.goal)).toBe(1000);
      expect(codePointLength(goal.why)).toBe(1000);
      for (const field of listFields) {
        expect(goal[field]).toHaveLength(16);
        expect(goal[field].every((item) => codePointLength(item) === 500)).toBe(true);
      }
    }
    expect(state.goalContractHistory[0].revisionRequest?.note).toContain(PHASE8_HOSTILE_MARKERS[0]);
    expect(codePointLength(state.goalContractHistory[0].revisionRequest!.note)).toBe(PHASE8_REVISION_PROBE_CODE_POINTS);
    expect(state.planHistory).toHaveLength(2);
    for (const plan of state.planHistory) {
      expect(plan.goalContractVersion).toBe(2);
      expect(plan.steps).toHaveLength(8);
      expect(plan.steps.every((step) => codePointLength(step.id) === 80)).toBe(true);
      expect(plan.steps.every((step) => codePointLength(step.title) === 160)).toBe(true);
    }
    expect(state.planHistory[0].revisionRequest?.note).toContain(PHASE8_HOSTILE_MARKERS[1]);
    expect(codePointLength(state.planHistory[0].revisionRequest!.note)).toBe(PHASE8_REVISION_PROBE_CODE_POINTS);
    expect(result.toolInvocations.every(({ result: invocation }) => typeof invocation.accepted === "boolean")).toBe(true);
  });

  it("uses production projections and components only in the QA entry", async () => {
    const root = resolve(import.meta.dirname, "..");
    const source = await readFile(resolve(root, "qa/phase8-visual-fixture.ts"), "utf8");
    const html = await readFile(resolve(root, "qa/phase8-visual-fixture.html"), "utf8");
    expect(source).toContain('createDesktopView');
    expect(source).toContain('createMobileView');
    expect(source).toContain('createDesktopSurface');
    expect(source).toContain('createMobileSurface');
    expect(source).toContain('buildPhase8Authority');
    expect(source).toContain('result.owner');
    expect(html).toContain('id="desktop-room"');
    expect(html).toContain('id="mobile-room"');
    expect(html).toContain('src="/qa/phase8-visual-fixture.ts"');
  });

  it("binds a dedicated deterministic browser runner and production exclusion gate", async () => {
    const root = resolve(import.meta.dirname, "..");
    const runner = await readFile(resolve(root, "scripts/phase8-visual-qa.mjs"), "utf8");
    const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
    expect(packageJson.scripts["qa:phase8-visual"]).toBe("node scripts/phase8-visual-qa.mjs");
    expect(runner).toContain("qa/phase8-visual-fixture.html");
    expect(runner).toContain("visual-max-hostile.json");
    expect(runner).toContain("fixtureLeaks");
    expect(runner).toContain("Accessibility.getFullAXTree");
    expect(runner).toContain("prefers-reduced-motion");
    expect(runner).toContain("Input.dispatchKeyEvent");
  });

  it("exposes every required lifecycle checkpoint without synthetic state mutation", async () => {
    const expected = {
      goal: ["GOAL_CONTRACT_PROPOSED", 2],
      "goal-revision": ["GOAL_CONTRACT_REVISION_REQUESTED", 3],
      plan: ["PLAN_PROPOSED", 6],
      "plan-revision": ["PLAN_REVISION_REQUESTED", 7],
      fail: ["VERIFICATION_FAILED", 12],
      pass: ["VERIFICATION_PASSED", 14],
      completion: ["COMPLETION_REQUESTED", 15],
      accepted: ["GOAL_ACCEPTED", 16],
    } as const;
    for (const [name, [phase, stateVersion]] of Object.entries(expected)) {
      const result = await buildPhase8Authority(name as keyof typeof expected);
      expect(result.room.getState()).toMatchObject({ phase, stateVersion });
      expect(result.checkpoint).toBe(name);
    }
  });
});
