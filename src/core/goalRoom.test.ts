import { describe, expect, it } from "vitest";
import { createGoalRoom, replayGoalRoom } from "./goalRoom";

describe("Goal Room Plan authority", () => {
  it("accepts an agent Plan proposal without confirming it", async () => {
    const room = createGoalRoom({
      goal: "Ship release v1.2 safely",
      doneLooksLike: ["Owner accepts an independently checked release"],
    });

    const result = await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "proposal-1",
      steps: [
        { id: "metadata", title: "Prepare release metadata" },
        { id: "notes", title: "Prepare release notes" },
      ],
    });

    expect(result).toMatchObject({
      accepted: true,
      stateVersion: 1,
      nextLegalAction: "OWNER_CONFIRM_OR_REVISE_PLAN",
      ownerRequired: true,
    });
    expect(room.getState()).toMatchObject({
      phase: "PLAN_PROPOSED",
      stateVersion: 1,
      activePlan: {
        version: 1,
        status: "PROPOSED",
        proposedBy: "agent",
      },
    });
  });

  it("refuses agent confirmation without mutating Plan authority", async () => {
    const room = createGoalRoom({ goal: "Ship safely", doneLooksLike: ["Owner accepts"] });
    await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "proposal-1",
      steps: [{ id: "metadata", title: "Prepare metadata" }],
    });

    const before = room.getState();
    const result = await room.dispatch({
      type: "CONFIRM_PLAN",
      actor: "agent",
      expectedStateVersion: 1,
      idempotencyKey: "agent-confirm-1",
      planVersion: 1,
    });

    expect(result).toMatchObject({
      accepted: false,
      reasonCode: "OWNER_ONLY",
      stateVersion: 1,
      nextLegalAction: "OWNER_CONFIRM_OR_REVISE_PLAN",
      ownerRequired: true,
    });
    expect(room.getState()).toEqual(before);
  });

  it("lets the owner confirm the exact proposed Plan version", async () => {
    const room = createGoalRoom({ goal: "Ship safely", doneLooksLike: ["Owner accepts"] });
    await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "proposal-1",
      steps: [{ id: "metadata", title: "Prepare metadata" }],
    });

    const result = await room.dispatch({
      type: "CONFIRM_PLAN",
      actor: "owner",
      expectedStateVersion: 1,
      idempotencyKey: "owner-confirm-1",
      planVersion: 1,
    });

    expect(result).toMatchObject({
      accepted: true,
      stateVersion: 2,
      nextLegalAction: "AGENT_CLAIM_OPEN_STEP",
      ownerRequired: false,
    });
    expect(room.getState()).toMatchObject({
      phase: "PLAN_CONFIRMED",
      stateVersion: 2,
      activePlan: { version: 1, status: "CONFIRMED" },
    });
  });
});

describe("Goal Room receipts and replay", () => {
  it("records accepted and refused attempts in a verified hash chain", async () => {
    const input = { goal: "Ship safely", doneLooksLike: ["Owner accepts"] };
    const room = createGoalRoom(input);
    await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "proposal-1",
      steps: [{ id: "metadata", title: "Prepare metadata" }],
    });
    await room.dispatch({
      type: "CONFIRM_PLAN",
      actor: "agent",
      expectedStateVersion: 1,
      idempotencyKey: "agent-confirm-1",
      planVersion: 1,
    });
    await room.dispatch({
      type: "CONFIRM_PLAN",
      actor: "owner",
      expectedStateVersion: 1,
      idempotencyKey: "owner-confirm-1",
      planVersion: 1,
    });

    const receipts = room.getReceipts();
    expect(receipts).toHaveLength(3);
    expect(receipts.map((receipt) => receipt.accepted)).toEqual([true, false, true]);
    expect(receipts[1]).toMatchObject({ reasonCode: "OWNER_ONLY", stateVersion: 1 });
    expect(receipts[0]?.previousHash).toBe("GENESIS");
    expect(receipts[1]?.previousHash).toBe(receipts[0]?.hash);
    expect(receipts[2]?.previousHash).toBe(receipts[1]?.hash);
    expect(await replayGoalRoom(input, receipts)).toEqual(room.getState());
  });

  it("fails replay closed when a receipt is tampered", async () => {
    const input = { goal: "Ship safely", doneLooksLike: ["Owner accepts"] };
    const room = createGoalRoom(input);
    await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "proposal-1",
      steps: [{ id: "metadata", title: "Prepare metadata" }],
    });
    const receipts = room.getReceipts();
    receipts[0]!.stateVersion = 99;

    await expect(replayGoalRoom(input, receipts)).rejects.toThrow(
      "RECEIPT_HASH_MISMATCH",
    );
  });
});

describe("Goal Room concurrency and retry safety", () => {
  it("refuses a stale expected state version without authority mutation", async () => {
    const room = createGoalRoom({ goal: "Ship safely", doneLooksLike: ["Owner accepts"] });

    const result = await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 7,
      idempotencyKey: "stale-proposal",
      steps: [{ id: "metadata", title: "Prepare metadata" }],
    });

    expect(result).toMatchObject({
      accepted: false,
      reasonCode: "STALE_STATE",
      stateVersion: 0,
      nextLegalAction: "AGENT_PROPOSE_PLAN",
    });
    expect(room.getState()).toMatchObject({ phase: "DRAFT", stateVersion: 0 });
    expect(room.getReceipts()).toHaveLength(1);
  });

  it("returns the original result for an idempotent retry without duplicate effects", async () => {
    const room = createGoalRoom({ goal: "Ship safely", doneLooksLike: ["Owner accepts"] });
    const command = {
      type: "PROPOSE_PLAN" as const,
      actor: "agent" as const,
      expectedStateVersion: 0,
      idempotencyKey: "proposal-1",
      steps: [{ id: "metadata", title: "Prepare metadata" }],
    };

    const first = await room.dispatch(command);
    const retry = await room.dispatch(structuredClone(command));

    expect(retry).toEqual(first);
    expect(room.getState()).toMatchObject({ stateVersion: 1, activePlan: { version: 1 } });
    expect(room.getReceipts()).toHaveLength(1);
  });

  it("fails closed when an idempotency key is reused for different input", async () => {
    const room = createGoalRoom({ goal: "Ship safely", doneLooksLike: ["Owner accepts"] });
    await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "proposal-1",
      steps: [{ id: "metadata", title: "Prepare metadata" }],
    });

    await expect(
      room.dispatch({
        type: "PROPOSE_PLAN",
        actor: "agent",
        expectedStateVersion: 0,
        idempotencyKey: "proposal-1",
        steps: [{ id: "different", title: "Different work" }],
      }),
    ).rejects.toThrow("IDEMPOTENCY_KEY_REUSE");
    expect(room.getState()).toMatchObject({ stateVersion: 1, activePlan: { version: 1 } });
    expect(room.getReceipts()).toHaveLength(1);
  });
});
