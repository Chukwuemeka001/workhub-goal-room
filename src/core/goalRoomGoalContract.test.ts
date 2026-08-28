import { describe, expect, it } from "vitest";
import { createGoalRoom, getGoalRoomFrontier, replayGoalRoom, type Command } from "./goalRoom";

const proposedContract = {
  goal: "Publish a verified WebMCP Challenge entry",
  why: "Prove governed browser-agent work.",
  doneLooksLike: ["Public app works", "Owner accepts the exact verified result"],
  constraints: ["No external effects"],
  nonGoals: ["Accounts and organizations"],
  evidenceRequired: ["Passing deterministic release checks"],
  openQuestions: ["Which public URL will be used?"],
};

describe("Goal Room Goal Contract authority", () => {
  it("initializes an explicit empty owner intent without admitting a Goal", () => {
    const room = createGoalRoom({ ownerIntent: null });

    expect(room.getState()).toMatchObject({
      phase: "INTENT_DRAFT",
      stateVersion: 0,
      ownerIntent: null,
      goal: "",
      doneLooksLike: [],
      activeGoalContract: null,
      activePlan: null,
    });
    expect(room.getReceipts()).toEqual([]);
    expect(getGoalRoomFrontier(room.getState())).toEqual({
      nextLegalAction: "OWNER_SET_INTENT",
      ownerRequired: true,
    });
  });

  it("sets and revises normalized owner intent without admitting Goal, Plan, or work", async () => {
    const room = createGoalRoom({ ownerIntent: null });

    const first = await room.dispatch({
      type: "SET_OWNER_INTENT",
      actor: "owner",
      expectedStateVersion: 0,
      idempotencyKey: "owner-intent-v1",
      intent: "  Build a governed challenge entry.  ",
    });
    const second = await room.dispatch({
      type: "SET_OWNER_INTENT",
      actor: "owner",
      expectedStateVersion: 1,
      idempotencyKey: "owner-intent-v2",
      intent: "Make the authority boundary judge-observable.",
    });

    expect(first).toMatchObject({
      accepted: true,
      stateVersion: 1,
      nextLegalAction: "AGENT_PROPOSE_GOAL_CONTRACT",
      ownerRequired: false,
    });
    expect(second).toMatchObject({ accepted: true, stateVersion: 2 });
    expect(room.getState()).toMatchObject({
      phase: "INTENT_DRAFT",
      stateVersion: 2,
      ownerIntent: "Make the authority boundary judge-observable.",
      goal: "",
      doneLooksLike: [],
      activeGoalContract: null,
      activePlan: null,
      activeClaim: null,
      activeCandidate: null,
    });
    expect(room.getReceipts()).toHaveLength(2);
  });

  it("refuses owner intent changes after a Goal proposal and preserves state", async () => {
    const room = createGoalRoom({ ownerIntent: "Build a governed challenge entry." });
    await room.dispatch({
      type: "PROPOSE_GOAL_CONTRACT",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "goal-v1",
      ...proposedContract,
    });
    const before = room.getState();

    const result = await room.dispatch({
      type: "SET_OWNER_INTENT",
      actor: "owner",
      expectedStateVersion: 1,
      idempotencyKey: "late-owner-intent",
      intent: "Silently change the admitted Goal.",
    });

    expect(result).toMatchObject({
      accepted: false,
      reasonCode: "OWNER_INTENT_NOT_ALLOWED",
      stateVersion: 1,
      nextLegalAction: "OWNER_CONFIRM_OR_REVISE_GOAL",
      ownerRequired: true,
    });
    expect(room.getState()).toEqual(before);
  });

  it("refuses a Goal proposal until owner intent is captured", async () => {
    const room = createGoalRoom({ ownerIntent: null });
    const before = room.getState();

    const result = await room.dispatch({
      type: "PROPOSE_GOAL_CONTRACT",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "goal-without-intent",
      ...proposedContract,
    });

    expect(result).toMatchObject({
      accepted: false,
      reasonCode: "GOAL_PROPOSAL_NOT_ALLOWED",
      stateVersion: 0,
      nextLegalAction: "OWNER_SET_INTENT",
      ownerRequired: true,
    });
    expect(room.getState()).toEqual(before);
  });

  it("applies owner-only authority and exact-shape bounds without mutation on malformed input", async () => {
    const room = createGoalRoom({ ownerIntent: null });
    const before = room.getState();

    const wrongActor = await room.dispatch({
      type: "SET_OWNER_INTENT",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "agent-intent",
      intent: "Agent-authored intent",
    });
    expect(wrongActor).toMatchObject({ accepted: false, reasonCode: "OWNER_ONLY" });
    expect(room.getState()).toEqual(before);

    const extraKey = {
      type: "SET_OWNER_INTENT",
      actor: "owner",
      expectedStateVersion: 0,
      idempotencyKey: "extra-key",
      intent: "Owner intent",
      authorityOverride: true,
    } as unknown as Command;
    await expect(room.dispatch(extraKey)).rejects.toThrow("INVALID_COMMAND");
    await expect(room.dispatch({
      type: "SET_OWNER_INTENT",
      actor: "owner",
      expectedStateVersion: 0,
      idempotencyKey: "oversized-intent",
      intent: "x".repeat(1_001),
    })).rejects.toThrow("INVALID_COMMAND");
    expect(room.getState()).toEqual(before);
    expect(room.getReceipts()).toHaveLength(1);
  });

  it("uses existing retry, stale, key-reuse, and replay machinery for owner intent", async () => {
    const input = { ownerIntent: null };
    const room = createGoalRoom(input);
    const command = {
      type: "SET_OWNER_INTENT" as const,
      actor: "owner" as const,
      expectedStateVersion: 0,
      idempotencyKey: "owner-intent-v1",
      intent: "  Build a governed challenge entry.  ",
    };

    const accepted = await room.dispatch(command);
    expect(await room.dispatch(structuredClone(command))).toEqual(accepted);
    expect(room.getReceipts()).toHaveLength(1);
    await expect(room.dispatch({ ...command, intent: "Changed key reuse" }))
      .rejects.toThrow("IDEMPOTENCY_KEY_REUSE");

    const stale = await room.dispatch({
      ...command,
      expectedStateVersion: 0,
      idempotencyKey: "stale-owner-intent",
      intent: "Stale revision",
    });
    expect(stale).toMatchObject({
      accepted: false,
      reasonCode: "STALE_STATE",
      stateVersion: 1,
    });
    expect(room.getState().ownerIntent).toBe("Build a governed challenge entry.");
    expect(await replayGoalRoom(input, room.getReceipts())).toEqual(room.getState());
  });

  it("accepts an agent Goal Contract proposal without confirming it", async () => {
    const room = createGoalRoom({
      ownerIntent: "Build the clearest challenge entry without weakening owner authority.",
    });

    expect(room.getState()).toMatchObject({
      phase: "INTENT_DRAFT",
      stateVersion: 0,
      ownerIntent: "Build the clearest challenge entry without weakening owner authority.",
      activeGoalContract: null,
    });

    const result = await room.dispatch({
      type: "PROPOSE_GOAL_CONTRACT",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "goal-v1",
      ...proposedContract,
    });

    expect(result).toMatchObject({
      accepted: true,
      stateVersion: 1,
      nextLegalAction: "OWNER_CONFIRM_OR_REVISE_GOAL",
      ownerRequired: true,
    });
    expect(room.getState()).toMatchObject({
      phase: "GOAL_CONTRACT_PROPOSED",
      stateVersion: 1,
      goal: proposedContract.goal,
      doneLooksLike: proposedContract.doneLooksLike,
      activeGoalContract: {
        version: 1,
        status: "PROPOSED",
        proposedBy: "agent",
        ...proposedContract,
      },
      goalContractHistory: [{ version: 1, status: "PROPOSED" }],
      activePlan: null,
    });
  });

  it("records an owner revision request against the exact proposed Goal version", async () => {
    const room = createGoalRoom({ ownerIntent: "Build a governed challenge entry." });
    await room.dispatch({
      type: "PROPOSE_GOAL_CONTRACT",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "goal-v1",
      ...proposedContract,
    });

    const result = await room.dispatch({
      type: "REQUEST_GOAL_REVISION",
      actor: "owner",
      expectedStateVersion: 1,
      idempotencyKey: "revise-goal-v1",
      goalContractVersion: 1,
      note: "Make every Done Looks Like criterion judge-observable.",
    });

    expect(result).toMatchObject({
      accepted: true,
      stateVersion: 2,
      nextLegalAction: "AGENT_PROPOSE_REVISED_GOAL_CONTRACT",
      ownerRequired: false,
    });
    expect(room.getState()).toMatchObject({
      phase: "GOAL_CONTRACT_REVISION_REQUESTED",
      stateVersion: 2,
      activeGoalContract: {
        version: 1,
        status: "REVISION_REQUESTED",
        revisionRequest: {
          requestedBy: "owner",
          note: "Make every Done Looks Like criterion judge-observable.",
        },
      },
      activePlan: null,
    });
  });

  it("preserves Goal v1 and lets only the owner confirm exact revised Goal v2", async () => {
    const room = createGoalRoom({ ownerIntent: "Build a governed challenge entry." });
    await room.dispatch({
      type: "PROPOSE_GOAL_CONTRACT", actor: "agent", expectedStateVersion: 0,
      idempotencyKey: "goal-v1", ...proposedContract,
    });
    await room.dispatch({
      type: "REQUEST_GOAL_REVISION", actor: "owner", expectedStateVersion: 1,
      idempotencyKey: "revise-v1", goalContractVersion: 1,
      note: "Make the proof judge-observable.",
    });
    const revised = {
      ...proposedContract,
      doneLooksLike: [...proposedContract.doneLooksLike, "Judge can observe refusal recovery"],
      openQuestions: [],
    };
    await room.dispatch({
      type: "PROPOSE_GOAL_CONTRACT", actor: "agent", expectedStateVersion: 2,
      idempotencyKey: "goal-v2", ...revised,
    });

    expect(room.getState()).toMatchObject({
      phase: "GOAL_CONTRACT_PROPOSED",
      activeGoalContract: { version: 2, status: "PROPOSED", doneLooksLike: revised.doneLooksLike },
      goalContractHistory: [
        { version: 1, status: "REVISION_REQUESTED", doneLooksLike: proposedContract.doneLooksLike },
        { version: 2, status: "PROPOSED", doneLooksLike: revised.doneLooksLike },
      ],
    });

    const result = await room.dispatch({
      type: "CONFIRM_GOAL_CONTRACT",
      actor: "owner",
      expectedStateVersion: 3,
      idempotencyKey: "confirm-goal-v2",
      goalContractVersion: 2,
    });

    expect(result).toMatchObject({
      accepted: true,
      stateVersion: 4,
      nextLegalAction: "AGENT_PROPOSE_PLAN",
      ownerRequired: false,
    });
    expect(room.getState()).toMatchObject({
      phase: "GOAL_CONTRACT_CONFIRMED",
      stateVersion: 4,
      activeGoalContract: { version: 2, status: "CONFIRMED" },
      activePlan: null,
    });
  });

  it("refuses an unrequested replacement Goal with a Goal-specific reason", async () => {
    const room = createGoalRoom({ ownerIntent: "Build a governed challenge entry." });
    await room.dispatch({
      type: "PROPOSE_GOAL_CONTRACT", actor: "agent", expectedStateVersion: 0,
      idempotencyKey: "goal-v1", ...proposedContract,
    });
    const before = room.getState();

    const result = await room.dispatch({
      type: "PROPOSE_GOAL_CONTRACT", actor: "agent", expectedStateVersion: 1,
      idempotencyKey: "unrequested-goal-v2", ...proposedContract,
    });

    expect(result).toMatchObject({
      accepted: false,
      reasonCode: "GOAL_PROPOSAL_NOT_ALLOWED",
      stateVersion: 1,
      nextLegalAction: "OWNER_CONFIRM_OR_REVISE_GOAL",
      ownerRequired: true,
    });
    expect(room.getState()).toEqual(before);
  });

  it("refuses agent self-confirmation without mutating Goal authority", async () => {
    const room = createGoalRoom({ ownerIntent: "Build a governed challenge entry." });
    await room.dispatch({
      type: "PROPOSE_GOAL_CONTRACT", actor: "agent", expectedStateVersion: 0,
      idempotencyKey: "goal-v1", ...proposedContract,
    });
    const before = room.getState();

    const result = await room.dispatch({
      type: "CONFIRM_GOAL_CONTRACT",
      actor: "agent",
      expectedStateVersion: 1,
      idempotencyKey: "agent-confirm-goal",
      goalContractVersion: 1,
    });

    expect(result).toMatchObject({
      accepted: false,
      reasonCode: "OWNER_ONLY",
      stateVersion: 1,
      nextLegalAction: "OWNER_CONFIRM_OR_REVISE_GOAL",
      ownerRequired: true,
    });
    expect(room.getState()).toEqual(before);
  });

  it("admits a Plan only when it binds to the exact confirmed Goal version", async () => {
    const room = createGoalRoom({ ownerIntent: "Build a governed challenge entry." });
    await room.dispatch({
      type: "PROPOSE_GOAL_CONTRACT", actor: "agent", expectedStateVersion: 0,
      idempotencyKey: "goal-v1", ...proposedContract,
    });
    await room.dispatch({
      type: "CONFIRM_GOAL_CONTRACT", actor: "owner", expectedStateVersion: 1,
      idempotencyKey: "confirm-goal-v1", goalContractVersion: 1,
    });

    const result = await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 2,
      idempotencyKey: "plan-v1",
      goalContractVersion: 1,
      steps: [{ id: "build", title: "Build the confirmed Goal" }],
    });

    expect(result).toMatchObject({
      accepted: true,
      stateVersion: 3,
      nextLegalAction: "OWNER_CONFIRM_OR_REVISE_PLAN",
      ownerRequired: true,
    });
    expect(room.getState()).toMatchObject({
      phase: "PLAN_PROPOSED",
      activeGoalContract: { version: 1, status: "CONFIRMED" },
      activePlan: {
        version: 1,
        status: "PROPOSED",
        goalContractVersion: 1,
      },
    });
  });

  it("keeps Plan proposals blocked before owner Goal confirmation", async () => {
    const room = createGoalRoom({ ownerIntent: "Build a governed challenge entry." });
    await room.dispatch({
      type: "PROPOSE_GOAL_CONTRACT", actor: "agent", expectedStateVersion: 0,
      idempotencyKey: "goal-v1", ...proposedContract,
    });
    const before = room.getState();

    const result = await room.dispatch({
      type: "PROPOSE_PLAN", actor: "agent", expectedStateVersion: 1,
      idempotencyKey: "early-plan", goalContractVersion: 1,
      steps: [{ id: "early", title: "Start before Goal confirmation" }],
    });

    expect(result).toMatchObject({
      accepted: false,
      reasonCode: "PLAN_PROPOSAL_NOT_ALLOWED",
      nextLegalAction: "OWNER_CONFIRM_OR_REVISE_GOAL",
      ownerRequired: true,
    });
    expect(room.getState()).toEqual(before);
  });

  it("refuses a Plan bound to the wrong confirmed Goal version", async () => {
    const room = createGoalRoom({ ownerIntent: "Build a governed challenge entry." });
    await room.dispatch({
      type: "PROPOSE_GOAL_CONTRACT", actor: "agent", expectedStateVersion: 0,
      idempotencyKey: "goal-v1", ...proposedContract,
    });
    await room.dispatch({
      type: "CONFIRM_GOAL_CONTRACT", actor: "owner", expectedStateVersion: 1,
      idempotencyKey: "confirm-goal-v1", goalContractVersion: 1,
    });
    const before = room.getState();

    const result = await room.dispatch({
      type: "PROPOSE_PLAN", actor: "agent", expectedStateVersion: 2,
      idempotencyKey: "wrong-goal-plan", goalContractVersion: 2,
      steps: [{ id: "wrong", title: "Bind to a nonexistent Goal" }],
    });

    expect(result).toMatchObject({
      accepted: false,
      reasonCode: "GOAL_VERSION_MISMATCH",
      nextLegalAction: "AGENT_PROPOSE_PLAN",
    });
    expect(room.getState()).toEqual(before);
  });

  it("replays Goal formation and exact retries without duplicate effects", async () => {
    const input = { ownerIntent: "Build a governed challenge entry." };
    const room = createGoalRoom(input);
    const proposal = {
      type: "PROPOSE_GOAL_CONTRACT" as const, actor: "agent" as const,
      expectedStateVersion: 0, idempotencyKey: "goal-v1", ...proposedContract,
    };
    const first = await room.dispatch(proposal);
    expect(await room.dispatch(structuredClone(proposal))).toEqual(first);
    await room.dispatch({
      type: "CONFIRM_GOAL_CONTRACT", actor: "owner", expectedStateVersion: 1,
      idempotencyKey: "confirm-goal-v1", goalContractVersion: 1,
    });
    await room.dispatch({
      type: "PROPOSE_PLAN", actor: "agent", expectedStateVersion: 2,
      idempotencyKey: "plan-v1", goalContractVersion: 1,
      steps: [{ id: "build", title: "Build the confirmed Goal" }],
    });

    expect(room.getReceipts()).toHaveLength(3);
    expect(await replayGoalRoom(input, room.getReceipts())).toEqual(room.getState());
  });

  it("rejects malformed Goal proposal input without state or receipt mutation", async () => {
    const room = createGoalRoom({ ownerIntent: "Build a governed challenge entry." });
    const malformed = {
      type: "PROPOSE_GOAL_CONTRACT", actor: "agent", expectedStateVersion: 0,
      idempotencyKey: "malformed-goal", ...proposedContract,
      ownerCanBeBypassed: true,
    } as unknown as Command;

    await expect(room.dispatch(malformed)).rejects.toThrow("INVALID_COMMAND");
    expect(room.getState()).toMatchObject({ phase: "INTENT_DRAFT", stateVersion: 0 });
    expect(room.getReceipts()).toHaveLength(0);
  });
});
