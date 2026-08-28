import { describe, expect, it } from "vitest";
import { createGoalRoom } from "./core/goalRoom";
import { createOwnerViewModel } from "./ownerView";
import {
  createBoundaryMessage,
  createLifecycleAccessibleLabel,
  createReceiptLabels,
  prepareOwnerIntent,
  prepareRevisionNote,
} from "./ownerUi";

describe("owner UI policies", () => {
  it("announces every lifecycle status without relying on color", () => {
    expect(createLifecycleAccessibleLabel({ label: "Plan", status: "complete" })).toBe(
      "Plan — complete",
    );
    expect(createLifecycleAccessibleLabel({ label: "Evidence", status: "active" })).toBe(
      "Evidence — active",
    );
    expect(createLifecycleAccessibleLabel({ label: "Verify", status: "failed" })).toBe(
      "Verify — failed",
    );
    expect(createLifecycleAccessibleLabel({ label: "Accept", status: "pending" })).toBe(
      "Accept — pending",
    );
  });

  it("labels immutable Goal proposals and owner Goal decisions truthfully", async () => {
    const room = createGoalRoom({ ownerIntent: "Build a governed challenge entry." });
    const contract = {
      goal: "Publish a verified entry", why: "Prove governance",
      doneLooksLike: ["Owner accepts"], constraints: [], nonGoals: [],
      evidenceRequired: ["PASS"], openQuestions: [],
    };
    await room.dispatch({
      type: "PROPOSE_GOAL_CONTRACT", actor: "agent", expectedStateVersion: 0,
      idempotencyKey: "goal-v1", ...contract,
    });
    await room.dispatch({
      type: "REQUEST_GOAL_REVISION", actor: "owner", expectedStateVersion: 1,
      idempotencyKey: "revise-goal-v1", goalContractVersion: 1,
      note: "Add judge-observable proof.",
    });
    await room.dispatch({
      type: "PROPOSE_GOAL_CONTRACT", actor: "agent", expectedStateVersion: 2,
      idempotencyKey: "goal-v2", ...contract,
      evidenceRequired: ["PASS", "Judge-observable receipt"],
    });
    await room.dispatch({
      type: "CONFIRM_GOAL_CONTRACT", actor: "owner", expectedStateVersion: 3,
      idempotencyKey: "confirm-goal-v2", goalContractVersion: 2,
    });

    expect(createReceiptLabels(room.getReceipts())).toEqual([
      "Agent proposed Goal Contract v1",
      "Owner requested revision to Goal Contract v1",
      "Agent proposed Goal Contract v2",
      "Owner confirmed Goal Contract v2",
    ]);
  });

  it("labels claim, candidate, and system verification receipts truthfully", async () => {
    const room = createGoalRoom({ goal: "Ship", doneLooksLike: ["Accepted"] });
    await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "proposal",
      steps: [{ id: "artifact", title: "Release artifact" }],
    });
    await room.dispatch({
      type: "CONFIRM_PLAN",
      actor: "owner",
      expectedStateVersion: 1,
      idempotencyKey: "confirm",
      planVersion: 1,
    });
    await room.dispatch({
      type: "CLAIM_STEP",
      actor: "agent",
      expectedStateVersion: 2,
      idempotencyKey: "claim",
      planVersion: 1,
      stepId: "artifact",
    });
    const content = JSON.stringify({
      publicUrl: "https://example.test",
      demoDurationSeconds: 180,
      verificationCommand: "npm test",
    });
    const bytes = new TextEncoder().encode(content);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    await room.dispatch({
      type: "SUBMIT_CANDIDATE",
      actor: "agent",
      expectedStateVersion: 3,
      idempotencyKey: "candidate",
      planVersion: 1,
      stepId: "artifact",
      content,
      sha256,
    });
    await room.verifyActiveCandidate("verification");
    await room.dispatch({
      type: "REQUEST_COMPLETION",
      actor: "agent",
      expectedStateVersion: 5,
      idempotencyKey: "request-completion",
      candidateSha256: sha256,
    });
    await room.dispatch({
      type: "ACCEPT_GOAL",
      actor: "owner",
      expectedStateVersion: 6,
      idempotencyKey: "accept-goal",
      candidateSha256: sha256,
    });

    expect(createReceiptLabels(room.getReceipts()).slice(-5)).toEqual([
      "Agent claimed step artifact",
      `Agent submitted Candidate v1 · ${sha256.slice(0, 8)}`,
      `System verification PASS · ${sha256.slice(0, 8)}`,
      `Agent requested owner acceptance · ${sha256.slice(0, 8)}`,
      `Owner accepted Goal · ${sha256.slice(0, 8)}`,
    ]);
    expect(
      createBoundaryMessage(
        createOwnerViewModel(room.getState(), room.getReceipts()),
      ),
    ).toBe("Goal accepted. No further action is required.");
  });

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

  it("normalizes and bounds owner intent before authority dispatch", () => {
    expect(prepareOwnerIntent("   ")).toEqual({ valid: false, intent: "" });
    expect(prepareOwnerIntent("  Build <img src=x> safely.  ")).toEqual({
      valid: true,
      intent: "Build <img src=x> safely.",
    });
    expect(prepareOwnerIntent("x".repeat(1_001))).toEqual({
      valid: false,
      intent: "x".repeat(1_001),
    });
  });

  it("rejects whitespace-only revision notes after normalization", () => {
    expect(prepareRevisionNote("   ")).toEqual({ valid: false, note: "" });
    expect(prepareRevisionNote("  Add verification.  ")).toEqual({
      valid: true,
      note: "Add verification.",
    });
  });
});
