import { describe, expect, it } from "vitest";
import { createGoalRoom } from "./core/goalRoom";
import { createGoalContractView } from "./goalContractView";

const goalV1 = {
  goal: "Ship a governed product",
  why: "Make authority legible.",
  doneLooksLike: ["Owner confirms exact scope"],
  constraints: ["No generic chat"],
  nonGoals: ["Silent scope changes"],
  evidenceRequired: ["Immutable receipts"],
  openQuestions: [],
};

describe("Goal Contract origin and decision projection", () => {
  it("shows empty and captured owner intent as pending context, never admitted authority", async () => {
    const room = createGoalRoom({ ownerIntent: null });

    expect(createGoalContractView(room.getState(), room.getReceipts())).toEqual({
      pendingOwnerIntent: null,
      activeGoal: null,
      confirmedGoalVersion: null,
      history: [],
    });

    await room.dispatch({
      type: "SET_OWNER_INTENT",
      actor: "owner",
      expectedStateVersion: 0,
      idempotencyKey: "intent-v1",
      intent: "  <img src=x onerror=alert(1)> Build safely.  ",
    });

    expect(createGoalContractView(room.getState(), room.getReceipts())).toMatchObject({
      pendingOwnerIntent: "<img src=x onerror=alert(1)> Build safely.",
      activeGoal: null,
      confirmedGoalVersion: null,
      history: [{
        kind: "OWNER_INTENT",
        actor: "owner",
        authority: "CONTEXT_ONLY",
        label: "Owner captured intent",
        text: "<img src=x onerror=alert(1)> Build safely.",
      }],
    });
  });

  it("projects immutable Goal proposals, revision notes, and exact confirmation", async () => {
    const room = createGoalRoom({ ownerIntent: "Build a governed product." });
    await room.dispatch({
      type: "PROPOSE_GOAL_CONTRACT", actor: "agent", expectedStateVersion: 0,
      idempotencyKey: "goal-v1", ...goalV1,
    });
    await room.dispatch({
      type: "REQUEST_GOAL_REVISION", actor: "owner", expectedStateVersion: 1,
      idempotencyKey: "revise-v1", goalContractVersion: 1,
      note: "Keep <script>literal</script> and add mobile evidence.",
    });
    await room.dispatch({
      type: "PROPOSE_GOAL_CONTRACT", actor: "agent", expectedStateVersion: 2,
      idempotencyKey: "goal-v2", ...goalV1,
      doneLooksLike: [...goalV1.doneLooksLike, "Mobile evidence exists"],
    });
    await room.dispatch({
      type: "CONFIRM_GOAL_CONTRACT", actor: "owner", expectedStateVersion: 3,
      idempotencyKey: "confirm-v2", goalContractVersion: 2,
    });

    expect(createGoalContractView(room.getState(), room.getReceipts())).toEqual({
      pendingOwnerIntent: null,
      activeGoal: {
        version: 2,
        status: "CONFIRMED",
        goal: "Ship a governed product",
      },
      confirmedGoalVersion: 2,
      history: [
        {
          kind: "OWNER_INTENT", actor: "owner", authority: "CONTEXT_ONLY",
          label: "Owner intent", text: "Build a governed product.",
        },
        {
          kind: "GOAL_PROPOSAL", actor: "agent", authority: "PROPOSAL",
          label: "Agent proposed Goal Contract v1", goalContractVersion: 1,
        },
        {
          kind: "GOAL_REVISION_REQUEST", actor: "owner", authority: "DECISION",
          label: "Owner requested revision to Goal Contract v1",
          goalContractVersion: 1,
          text: "Keep <script>literal</script> and add mobile evidence.",
        },
        {
          kind: "GOAL_PROPOSAL", actor: "agent", authority: "PROPOSAL",
          label: "Agent proposed Goal Contract v2", goalContractVersion: 2,
        },
        {
          kind: "GOAL_CONFIRMATION", actor: "owner", authority: "DECISION",
          label: "Owner confirmed Goal Contract v2", goalContractVersion: 2,
        },
      ],
    });
  });

  it("preserves normalized seeded intent as origin and labels a later accepted SET as revision", async () => {
    const room = createGoalRoom({ ownerIntent: "  Original owner intent.  " });
    await room.dispatch({
      type: "SET_OWNER_INTENT",
      actor: "owner",
      expectedStateVersion: 0,
      idempotencyKey: "revise-seeded-intent",
      intent: "  Revised owner intent.  ",
    });

    expect(room.getReceipts()).toHaveLength(1);
    expect(createGoalContractView(room.getState(), room.getReceipts()).history).toEqual([
      {
        kind: "OWNER_INTENT",
        actor: "owner",
        authority: "CONTEXT_ONLY",
        label: "Owner intent",
        text: "Original owner intent.",
      },
      {
        kind: "OWNER_INTENT",
        actor: "owner",
        authority: "CONTEXT_ONLY",
        label: "Owner revised intent",
        text: "Revised owner intent.",
      },
    ]);
  });
});
