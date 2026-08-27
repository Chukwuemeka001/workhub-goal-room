import { describe, expect, it } from "vitest";
import { createGoalRoom } from "./core/goalRoom";
import { createOwnerDecisionController } from "./ownerController";
import type { OwnerViewModel } from "./ownerView";

describe("owner decision controller", () => {
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
      statusLabel: "Plan confirmed — work may begin",
      receiptCount: 2,
    });
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
