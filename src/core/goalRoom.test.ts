import { describe, expect, it } from "vitest";
import {
  createGoalRoom,
  replayGoalRoom,
  type Command,
  type Receipt,
} from "./goalRoom";

function canonicalForTest(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalForTest).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalForTest(record[key])}`).join(",")}}`;
}

async function reseal(receipt: Receipt): Promise<Receipt> {
  const { hash: _hash, ...body } = receipt;
  const bytes = new TextEncoder().encode(canonicalForTest(body));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return { ...body, hash };
}

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

  it("rejects a correctly resealed stale command marked accepted", async () => {
    const input = { goal: "Ship safely", doneLooksLike: ["Owner accepts"] };
    const room = createGoalRoom(input);
    await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 99,
      idempotencyKey: "stale",
      steps: [{ id: "metadata", title: "Prepare metadata" }],
    });
    const forged = room.getReceipts()[0]!;
    forged.accepted = true;
    delete forged.reasonCode;
    forged.stateVersion = 1;

    await expect(replayGoalRoom(input, [await reseal(forged)])).rejects.toThrow(
      "REPLAY_OUTCOME_MISMATCH",
    );
  });

  it("rejects a correctly resealed legal transition marked refused", async () => {
    const input = { goal: "Ship safely", doneLooksLike: ["Owner accepts"] };
    const room = createGoalRoom(input);
    await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "proposal",
      steps: [{ id: "metadata", title: "Prepare metadata" }],
    });
    await room.dispatch({
      type: "CONFIRM_PLAN",
      actor: "owner",
      expectedStateVersion: 1,
      idempotencyKey: "confirm",
      planVersion: 1,
    });
    const receipts = room.getReceipts();
    receipts[1]!.accepted = false;
    receipts[1]!.reasonCode = "OWNER_ONLY";
    receipts[1]!.stateVersion = 1;
    receipts[1] = await reseal(receipts[1]!);

    await expect(replayGoalRoom(input, receipts)).rejects.toThrow(
      "REPLAY_OUTCOME_MISMATCH",
    );
  });

  it("rejects correctly resealed duplicate idempotency keys", async () => {
    const input = { goal: "Ship safely", doneLooksLike: ["Owner accepts"] };
    const firstRoom = createGoalRoom(input);
    await firstRoom.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "same-key",
      steps: [{ id: "one", title: "One" }],
    });
    const first = firstRoom.getReceipts()[0]!;
    const secondRoom = createGoalRoom(input);
    await secondRoom.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "same-key",
      steps: [{ id: "two", title: "Two" }],
    });
    const second = secondRoom.getReceipts()[0]!;
    second.sequence = 2;
    second.previousHash = first.hash;
    second.command.expectedStateVersion = 1;
    second.stateVersion = 2;

    await expect(
      replayGoalRoom(input, [first, await reseal(second)]),
    ).rejects.toThrow("IDEMPOTENCY_KEY_REUSE");
  });

  it("rejects correctly resealed contradictory receipt sequence metadata", async () => {
    const input = { goal: "Ship safely", doneLooksLike: ["Owner accepts"] };
    const room = createGoalRoom(input);
    await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "proposal",
      steps: [{ id: "metadata", title: "Prepare metadata" }],
    });
    const forged = room.getReceipts()[0]!;
    forged.sequence = 42;

    await expect(replayGoalRoom(input, [await reseal(forged)])).rejects.toThrow(
      "RECEIPT_SEQUENCE_MISMATCH",
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

  it("returns the original result for concurrent exact retries without duplicate effects", async () => {
    const room = createGoalRoom({ goal: "Ship safely", doneLooksLike: ["Owner accepts"] });
    const command = {
      type: "PROPOSE_PLAN" as const,
      actor: "agent" as const,
      expectedStateVersion: 0,
      idempotencyKey: "proposal-concurrent",
      steps: [{ id: "metadata", title: "Prepare metadata" }],
    };

    const [first, retry] = await Promise.all([
      room.dispatch(command),
      room.dispatch(structuredClone(command)),
    ]);

    expect(retry).toEqual(first);
    expect(room.getState()).toMatchObject({ stateVersion: 1, activePlan: { version: 1 } });
    expect(room.getReceipts()).toHaveLength(1);
    expect(room.getReceipts()[0]).toMatchObject({ sequence: 1, previousHash: "GENESIS" });
  });

  it("snapshots a queued command at dispatch admission", async () => {
    const room = createGoalRoom({ goal: "Ship safely", doneLooksLike: ["Owner accepts"] });
    const command = {
      type: "PROPOSE_PLAN" as const,
      actor: "agent" as const,
      expectedStateVersion: 0,
      idempotencyKey: "snapshot-proposal",
      steps: [{ id: "metadata", title: "Original" }],
    };

    const pending = room.dispatch(command);
    command.steps[0]!.title = "Mutated after dispatch";
    await pending;

    expect(room.getState().activePlan?.steps[0]?.title).toBe("Original");
    expect(room.getReceipts()[0]?.command).toMatchObject({
      steps: [{ id: "metadata", title: "Original" }],
    });
  });

  it.each([
    ["non-agent actor", { actor: "system" }],
    ["empty Plan", { steps: [] }],
    ["empty step id", { steps: [{ id: "", title: "Work" }] }],
    ["empty step title", { steps: [{ id: "work", title: "" }] }],
    [
      "duplicate step ids",
      { steps: [{ id: "work", title: "One" }, { id: "work", title: "Two" }] },
    ],
  ])("rejects malformed proposal: %s", async (_label, override) => {
    const room = createGoalRoom({ goal: "Ship safely", doneLooksLike: ["Owner accepts"] });
    const command = {
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "proposal-1",
      steps: [{ id: "metadata", title: "Prepare metadata" }],
      ...override,
    } as Command;

    await expect(room.dispatch(command)).rejects.toThrow("INVALID_COMMAND");
    expect(room.getState()).toMatchObject({ phase: "DRAFT", stateVersion: 0 });
    expect(room.getReceipts()).toHaveLength(0);
  });

  it("does not alias non-finite and null command values", async () => {
    const room = createGoalRoom({ goal: "Ship safely", doneLooksLike: ["Owner accepts"] });
    const malformed = (value: unknown) => ({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: value,
      idempotencyKey: "proposal-1",
      steps: [{ id: "metadata", title: "Prepare metadata" }],
    }) as Command;

    await expect(room.dispatch(malformed(Number.NaN))).rejects.toThrow("INVALID_COMMAND");
    await expect(room.dispatch(malformed(null))).rejects.toThrow("INVALID_COMMAND");
    expect(room.getState()).toMatchObject({ phase: "DRAFT", stateVersion: 0 });
    expect(room.getReceipts()).toHaveLength(0);
  });
});
