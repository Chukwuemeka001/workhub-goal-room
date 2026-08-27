import { describe, expect, it } from "vitest";
import { createGoalRoom, replayGoalRoom } from "./goalRoom";

async function proposedRoom() {
  const room = createGoalRoom({
    goal: "Publish a verified WebMCP Challenge entry",
    doneLooksLike: ["Public app works", "Owner accepts"],
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
  return room;
}

describe("Goal Room owner Plan revision", () => {
  it("records an owner revision request against the exact proposed Plan", async () => {
    const room = await proposedRoom();

    const result = await room.dispatch({
      type: "REQUEST_PLAN_REVISION",
      actor: "owner",
      expectedStateVersion: 1,
      idempotencyKey: "revision-v1",
      planVersion: 1,
      note: "Separate final verification and add the three-minute demo limit.",
    });

    expect(result).toMatchObject({
      accepted: true,
      stateVersion: 2,
      nextLegalAction: "AGENT_PROPOSE_REVISED_PLAN",
      ownerRequired: false,
    });
    expect(room.getState()).toMatchObject({
      phase: "PLAN_REVISION_REQUESTED",
      stateVersion: 2,
      activePlan: {
        version: 1,
        status: "REVISION_REQUESTED",
        revisionRequest: {
          note: "Separate final verification and add the three-minute demo limit.",
          requestedBy: "owner",
        },
      },
    });
  });

  it("refuses an agent attempt to replace an unresolved proposed Plan", async () => {
    const room = await proposedRoom();
    const before = room.getState();

    const result = await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 1,
      idempotencyKey: "unrequested-v2",
      steps: [{ id: "replacement", title: "Replace the pending Plan" }],
    });

    expect(result).toMatchObject({
      accepted: false,
      reasonCode: "PLAN_PROPOSAL_NOT_ALLOWED",
      stateVersion: 1,
      nextLegalAction: "OWNER_CONFIRM_OR_REVISE_PLAN",
      ownerRequired: true,
    });
    expect(room.getState()).toEqual(before);
    expect(room.getState().planHistory).toHaveLength(1);
  });

  it("preserves Plan v1 when the agent proposes revised Plan v2", async () => {
    const room = await proposedRoom();
    await room.dispatch({
      type: "REQUEST_PLAN_REVISION",
      actor: "owner",
      expectedStateVersion: 1,
      idempotencyKey: "revision-v1",
      planVersion: 1,
      note: "Add a separate demo duration check.",
    });

    const result = await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 2,
      idempotencyKey: "proposal-v2",
      steps: [
        { id: "metadata", title: "Prepare release metadata" },
        { id: "verify", title: "Run deterministic verification" },
        { id: "duration", title: "Check the three-minute demo limit" },
      ],
    });

    expect(result).toMatchObject({
      accepted: true,
      stateVersion: 3,
      nextLegalAction: "OWNER_CONFIRM_OR_REVISE_PLAN",
      ownerRequired: true,
    });
    expect(room.getState()).toMatchObject({
      phase: "PLAN_PROPOSED",
      activePlan: { version: 2, status: "PROPOSED" },
      planHistory: [
        {
          version: 1,
          status: "REVISION_REQUESTED",
          revisionRequest: { note: "Add a separate demo duration check." },
        },
        { version: 2, status: "PROPOSED" },
      ],
    });
    expect(
      await replayGoalRoom(
        {
          goal: "Publish a verified WebMCP Challenge entry",
          doneLooksLike: ["Public app works", "Owner accepts"],
        },
        room.getReceipts(),
      ),
    ).toEqual(room.getState());
  });

  it("reports the current frontier when a confirmed Plan decision is refused", async () => {
    const room = await proposedRoom();
    await room.dispatch({
      type: "CONFIRM_PLAN",
      actor: "owner",
      expectedStateVersion: 1,
      idempotencyKey: "confirm-v1",
      planVersion: 1,
    });

    const result = await room.dispatch({
      type: "CONFIRM_PLAN",
      actor: "owner",
      expectedStateVersion: 2,
      idempotencyKey: "confirm-wrong-version",
      planVersion: 99,
    });

    expect(result).toMatchObject({
      accepted: false,
      reasonCode: "PLAN_VERSION_MISMATCH",
      stateVersion: 2,
      nextLegalAction: "AGENT_CLAIM_OPEN_STEP",
      ownerRequired: false,
    });
  });

  it("refuses a non-owner revision request without mutating the Plan", async () => {
    const room = await proposedRoom();
    const before = room.getState();

    const result = await room.dispatch({
      type: "REQUEST_PLAN_REVISION",
      actor: "agent",
      expectedStateVersion: 1,
      idempotencyKey: "agent-revision",
      planVersion: 1,
      note: "Let me replace my own Plan.",
    });

    expect(result).toMatchObject({
      accepted: false,
      reasonCode: "OWNER_ONLY",
      stateVersion: 1,
      ownerRequired: true,
    });
    expect(room.getState()).toEqual(before);
  });
});
