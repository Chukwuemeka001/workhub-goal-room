/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { V3_HOSTILE_MARKERS, V3_STORY_CATALOG, buildV3QualificationReplay } from "./v3-replay";

describe("production-excluded V3 real-kernel replay", () => {
  it("records the ordered 14-state story with only S09 marked synthetic/test-only", async () => {
    const replay = await buildV3QualificationReplay();
    expect(replay.source).toBe("real-kernel-replay");
    expect(replay.installationStatus).toBe("registered");
    expect(replay.stories.map(({ id }) => id)).toEqual(V3_STORY_CATALOG.map(({ id }) => id));
    expect(replay.stories).toHaveLength(14);
    expect(replay.stories.filter(({ presentation }) => presentation !== "canonical")).toEqual([
      expect.objectContaining({
        id: "S09",
        kernelPhase: "CANDIDATE_SUBMITTED",
        presentation: "synthetic-test-only-transient",
      }),
    ]);
    expect(replay.stories.find(({ id }) => id === "S09")?.state).toMatchObject({
      phase: "CANDIDATE_SUBMITTED",
      stateVersion: 11,
      activeCandidate: { version: 1 },
    });
  });

  it("retains failed history and keeps PASS distinct from acceptance", async () => {
    const replay = await buildV3QualificationReplay();
    const story = (id: string) => replay.stories.find((candidate) => candidate.id === id)!.state;
    expect(story("S10")).toMatchObject({ activeVerification: { verdict: "FAIL" }, goalAcceptance: null });
    expect(story("S11")).toMatchObject({ phase: "CANDIDATE_SUBMITTED", activeCandidate: { version: 2 }, goalAcceptance: null });
    expect(story("S12")).toMatchObject({
      phase: "VERIFICATION_PASSED",
      verificationHistory: [{ verdict: "FAIL" }, { verdict: "PASS" }],
      activeCompletionRequest: null,
      goalAcceptance: null,
    });
    expect(story("S13")).toMatchObject({ phase: "COMPLETION_REQUESTED", goalAcceptance: null });
    expect(story("S14")).toMatchObject({ phase: "GOAL_ACCEPTED", goalAcceptance: { acceptedBy: "owner" } });
  });

  it("uses the exact static-six registration and produces a replay-identical hash chain", async () => {
    const replay = await buildV3QualificationReplay();
    expect(replay.registrationOrder).toEqual([
      "get_goal_room_state",
      "propose_goal_contract",
      "propose_plan",
      "claim_step",
      "submit_artifact",
      "request_completion",
    ]);
    expect(replay.finalReceipts).toHaveLength(16);
    replay.finalReceipts.forEach((receipt, index) => {
      expect(receipt.sequence).toBe(index + 1);
      expect(receipt.previousHash).toBe(index === 0 ? "GENESIS" : replay.finalReceipts[index - 1].hash);
      expect(receipt.hash).toMatch(/^[0-9a-f]{64}$/);
    });
    expect(replay.replayedState).toEqual(replay.finalState);
    expect(replay.finalReceiptHash).toBe(replay.finalReceipts.at(-1)?.hash);
  });

  it("runs hostile text through the real kernel only when the hostile fixture requests it", async () => {
    const baseline = await buildV3QualificationReplay();
    const hostile = await buildV3QualificationReplay({ hostile: true });
    const baselineText = JSON.stringify(baseline.finalState);
    const hostileText = JSON.stringify(hostile.finalState);
    expect(V3_HOSTILE_MARKERS.every((marker) => !baselineText.includes(marker))).toBe(true);
    expect(V3_HOSTILE_MARKERS.every((marker) => hostileText.includes(marker))).toBe(true);
    expect(hostile.replayedState).toEqual(hostile.finalState);
  });

  it("is not referenced by either production entry point", () => {
    const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    expect(index).not.toMatch(/qualification\//);
    expect(main).not.toMatch(/qualification\//);
  });
});
