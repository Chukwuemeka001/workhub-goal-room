import { describe, expect, it } from "vitest";
import { createGoalRoom } from "./core/goalRoom";
import { createReceiptLabels, prepareRevisionNote } from "./ownerUi";

describe("owner UI policies", () => {
  it("labels only accepted proposals as immutable Plan versions", async () => {
    const room = createGoalRoom({ goal: "Ship", doneLooksLike: ["Accepted"] });
    await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "proposal-v1",
      steps: [{ id: "one", title: "First Plan" }],
    });
    await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 1,
      idempotencyKey: "refused-replacement",
      steps: [{ id: "wrong", title: "Silent replacement" }],
    });
    await room.dispatch({
      type: "REQUEST_PLAN_REVISION",
      actor: "owner",
      expectedStateVersion: 1,
      idempotencyKey: "revision-v1",
      planVersion: 1,
      note: "Add verification.",
    });
    await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 2,
      idempotencyKey: "proposal-v2",
      steps: [{ id: "two", title: "Revised Plan" }],
    });

    expect(createReceiptLabels(room.getReceipts())).toEqual([
      "Agent proposed Plan v1",
      "Plan proposal refused · PLAN_PROPOSAL_NOT_ALLOWED",
      "Owner requested revision to Plan v1",
      "Agent proposed Plan v2",
    ]);
  });

  it("rejects whitespace-only revision notes after normalization", () => {
    expect(prepareRevisionNote("   ")).toEqual({ valid: false, note: "" });
    expect(prepareRevisionNote("  Add verification.  ")).toEqual({
      valid: true,
      note: "Add verification.",
    });
  });
});
