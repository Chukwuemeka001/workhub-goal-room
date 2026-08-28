import { describe, expect, it } from "vitest";
import { createGoalRoom } from "./core/goalRoom";
import { createOwnerDecisionController } from "./ownerController";
import type { OwnerViewModel } from "./ownerView";

describe("owner decision controller", () => {
  const proposedGoal = {
    goal: "Publish a verified entry",
    why: "Prove governed work",
    doneLooksLike: ["Owner accepts"],
    constraints: [],
    nonGoals: [],
    evidenceRequired: ["PASS"],
    openQuestions: [],
  };

  it("sets normalized owner intent from fresh authoritative state and rerenders", async () => {
    const room = createGoalRoom({ ownerIntent: null });
    const renders: OwnerViewModel[] = [];
    const controller = createOwnerDecisionController({
      room,
      render: (view) => renders.push(view),
    });

    await controller.setOwnerIntent("  Build <b>literal</b> governed work.  ");

    expect(room.getState()).toMatchObject({
      phase: "INTENT_DRAFT",
      stateVersion: 1,
      ownerIntent: "Build <b>literal</b> governed work.",
      activeGoalContract: null,
      activePlan: null,
    });
    expect(renders.at(-1)).toMatchObject({
      ownerIntent: "Build <b>literal</b> governed work.",
      statusLabel: "Owner intent captured. Goal not admitted",
      receiptCount: 1,
    });
  });

  it("confirms the exact active Goal Contract from fresh state and rerenders", async () => {
    const room = createGoalRoom({ ownerIntent: "Build governed work." });
    await room.dispatch({
      type: "PROPOSE_GOAL_CONTRACT", actor: "agent", expectedStateVersion: 0,
      idempotencyKey: "goal-v1", ...proposedGoal,
    });
    const renders: OwnerViewModel[] = [];
    const controller = createOwnerDecisionController({
      room,
      render: (view) => renders.push(view),
    });

    await controller.confirmGoalContract();

    expect(room.getState()).toMatchObject({
      phase: "GOAL_CONTRACT_CONFIRMED",
      stateVersion: 2,
      activeGoalContract: { version: 1, status: "CONFIRMED" },
      activePlan: null,
    });
    expect(renders.at(-1)).toMatchObject({
      statusLabel: "Goal confirmed. Plan required",
      receiptCount: 2,
    });
  });

  it("requests revision of the exact active Goal Contract and rerenders", async () => {
    const room = createGoalRoom({ ownerIntent: "Build governed work." });
    await room.dispatch({
      type: "PROPOSE_GOAL_CONTRACT", actor: "agent", expectedStateVersion: 0,
      idempotencyKey: "goal-v1", ...proposedGoal,
    });
    const renders: OwnerViewModel[] = [];
    const controller = createOwnerDecisionController({
      room,
      render: (view) => renders.push(view),
    });

    await controller.requestGoalRevision("  Add literal <script>proof</script>.  ");

    expect(room.getState()).toMatchObject({
      phase: "GOAL_CONTRACT_REVISION_REQUESTED",
      stateVersion: 2,
      activeGoalContract: {
        version: 1,
        status: "REVISION_REQUESTED",
        revisionRequest: { note: "Add literal <script>proof</script>." },
      },
    });
    expect(renders.at(-1)).toMatchObject({
      statusLabel: "Waiting for revised Goal Contract",
      receiptCount: 2,
    });
  });

  it("confirms the exact proposed Plan and rerenders authoritative state", async () => {
    const room = createGoalRoom({
      goal: "Publish a verified WebMCP Challenge entry",
      doneLooksLike: ["Owner accepts"],
    });
    await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "proposal-v1",
      steps: [{ id: "verify", title: "Run verification" }],
    });
    const renders: OwnerViewModel[] = [];
    const controller = createOwnerDecisionController({
      room,
      render: (view) => renders.push(view),
    });

    controller.render();
    await controller.confirmPlan();

    expect(room.getState()).toMatchObject({
      phase: "PLAN_CONFIRMED",
      stateVersion: 2,
      activePlan: { version: 1, status: "CONFIRMED" },
    });
    expect(renders.at(-1)).toMatchObject({
      statusLabel: "Plan confirmed. Work may begin",
      receiptCount: 2,
    });
  });

  it("accepts only the exact active completion candidate and rerenders", async () => {
    const room = createGoalRoom({ goal: "Ship", doneLooksLike: ["Owner accepts"] });
    await room.dispatch({ type: "PROPOSE_PLAN", actor: "agent", expectedStateVersion: 0, idempotencyKey: "p", steps: [{ id: "s", title: "Ship" }] });
    await room.dispatch({ type: "CONFIRM_PLAN", actor: "owner", expectedStateVersion: 1, idempotencyKey: "cp", planVersion: 1 });
    await room.dispatch({ type: "CLAIM_STEP", actor: "agent", expectedStateVersion: 2, idempotencyKey: "c", planVersion: 1, stepId: "s" });
    const content = JSON.stringify({ publicUrl: "https://example.test", demoDurationSeconds: 180, verificationCommand: "npm test" });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
    const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    await room.dispatch({ type: "SUBMIT_CANDIDATE", actor: "agent", expectedStateVersion: 3, idempotencyKey: "s", planVersion: 1, stepId: "s", content, sha256 });
    await room.verifyActiveCandidate("v");
    await room.dispatch({ type: "REQUEST_COMPLETION", actor: "agent", expectedStateVersion: 5, idempotencyKey: "r", candidateSha256: sha256 });
    const renders: OwnerViewModel[] = [];
    const controller = createOwnerDecisionController({ room, render: (view) => renders.push(view) });

    await controller.acceptGoal();

    expect(room.getState()).toMatchObject({ phase: "GOAL_ACCEPTED", goalAcceptance: { candidateSha256: sha256, acceptedBy: "owner" } });
    expect(renders.at(-1)?.statusLabel).toBe("Goal accepted by owner");
  });

  it("records an owner revision note and rerenders the waiting state", async () => {
    const room = createGoalRoom({
      goal: "Publish a verified WebMCP Challenge entry",
      doneLooksLike: ["Owner accepts"],
    });
    await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "proposal-v1",
      steps: [{ id: "verify", title: "Run verification" }],
    });
    const renders: OwnerViewModel[] = [];
    const controller = createOwnerDecisionController({
      room,
      render: (view) => renders.push(view),
    });

    await controller.requestRevision("Add the three-minute demo limit.");

    expect(room.getState()).toMatchObject({
      phase: "PLAN_REVISION_REQUESTED",
      stateVersion: 2,
      activePlan: {
        version: 1,
        status: "REVISION_REQUESTED",
        revisionRequest: { note: "Add the three-minute demo limit." },
      },
    });
    expect(renders.at(-1)).toMatchObject({
      statusLabel: "Waiting for revised Plan",
      ownerAttention: { required: false },
      receiptCount: 2,
    });
  });
});
