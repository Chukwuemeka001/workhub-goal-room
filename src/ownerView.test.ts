import { describe, expect, it } from "vitest";
import { createGoalRoom } from "./core/goalRoom";
import { createOwnerViewModel } from "./ownerView";

describe("Goal Room owner view model", () => {
  it("centers the exact owner decision for a proposed Plan", async () => {
    const room = createGoalRoom({
      goal: "Publish a verified WebMCP Challenge entry",
      doneLooksLike: ["Public app works", "Verification passes", "Owner accepts"],
    });
    await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "proposal-v1",
      steps: [
        { id: "metadata", title: "Prepare release metadata" },
        { id: "verify", title: "Run deterministic verification" },
      ],
    });

    expect(createOwnerViewModel(room.getState(), room.getReceipts())).toMatchObject({
      statusLabel: "Waiting for your Plan decision",
      ownerAttention: {
        required: true,
        title: "Review Plan v1",
        body: "Work cannot begin until you confirm this Plan or request a revision.",
      },
      actions: {
        confirm: { visible: true, label: "Confirm Plan v1" },
        revise: { visible: true, label: "Request revision" },
      },
      nextLegalAction: {
        label: "Owner must confirm or request revision",
        actor: "owner",
      },
      plan: {
        version: 1,
        status: "PROPOSED",
        steps: [
          { id: "metadata", title: "Prepare release metadata" },
          { id: "verify", title: "Run deterministic verification" },
        ],
      },
      receiptCount: 1,
    });
  });

  it("shows confirmed scope without implying Goal acceptance", async () => {
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
    await room.dispatch({
      type: "CONFIRM_PLAN",
      actor: "owner",
      expectedStateVersion: 1,
      idempotencyKey: "confirm-v1",
      planVersion: 1,
    });

    expect(createOwnerViewModel(room.getState(), room.getReceipts())).toMatchObject({
      statusLabel: "Plan confirmed — work may begin",
      ownerAttention: {
        required: false,
        title: "Plan v1 confirmed",
        body: "The agent may claim an admitted step. The Goal is not yet accepted.",
      },
      actions: {
        confirm: { visible: false },
        revise: { visible: false },
      },
      nextLegalAction: {
        label: "Agent may claim the next admitted step",
        actor: "agent",
      },
      plan: { version: 1, status: "CONFIRMED" },
      receiptCount: 2,
    });
  });

  it("shows the owner revision note while waiting for the agent", async () => {
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
    await room.dispatch({
      type: "REQUEST_PLAN_REVISION",
      actor: "owner",
      expectedStateVersion: 1,
      idempotencyKey: "revision-v1",
      planVersion: 1,
      note: "Add the three-minute demo limit.",
    });

    expect(createOwnerViewModel(room.getState(), room.getReceipts())).toMatchObject({
      statusLabel: "Waiting for revised Plan",
      ownerAttention: {
        required: false,
        title: "Revision requested",
        body: "The agent must respond with Plan v2 before you need to decide again.",
      },
      actions: {
        confirm: { visible: false },
        revise: { visible: false },
      },
      nextLegalAction: {
        label: "Agent must propose revised Plan v2",
        actor: "agent",
      },
      plan: {
        version: 1,
        status: "REVISION_REQUESTED",
        revisionNote: "Add the three-minute demo limit.",
      },
      receiptCount: 2,
    });
  });
});
