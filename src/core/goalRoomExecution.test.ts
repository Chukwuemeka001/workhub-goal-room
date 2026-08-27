import { describe, expect, it } from "vitest";
import { createGoalRoom, replayGoalRoom } from "./goalRoom";

async function digestText(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function confirmedRoom() {
  const input = {
    goal: "Publish a verified WebMCP Challenge entry",
    doneLooksLike: ["Owner accepts an independently verified release"],
  };
  const room = createGoalRoom(input);
  await room.dispatch({
    type: "PROPOSE_PLAN",
    actor: "agent",
    expectedStateVersion: 0,
    idempotencyKey: "proposal-v1",
    steps: [
      { id: "artifact", title: "Produce the deterministic demo artifact" },
      { id: "verify", title: "Run deterministic verification" },
    ],
  });
  await room.dispatch({
    type: "CONFIRM_PLAN",
    actor: "owner",
    expectedStateVersion: 1,
    idempotencyKey: "confirm-v1",
    planVersion: 1,
  });
  return { input, room };
}

describe("Goal Room candidate custody", () => {
  it("rejects candidate content above the 4 KiB UTF-8 admission bound", async () => {
    const { room } = await confirmedRoom();
    await room.dispatch({
      type: "CLAIM_STEP",
      actor: "agent",
      expectedStateVersion: 2,
      idempotencyKey: "claim-artifact",
      planVersion: 1,
      stepId: "artifact",
    });
    const content = "🙂".repeat(1025);
    const before = room.getState();
    const receiptCount = room.getReceipts().length;

    await expect(
      room.dispatch({
        type: "SUBMIT_CANDIDATE",
        actor: "agent",
        expectedStateVersion: 3,
        idempotencyKey: "oversized-candidate",
        planVersion: 1,
        stepId: "artifact",
        content,
        sha256: await digestText(content),
      }),
    ).rejects.toThrow("INVALID_COMMAND");
    expect(room.getState()).toEqual(before);
    expect(room.getReceipts()).toHaveLength(receiptCount);
  });

  it("records an exact digest-bound candidate after the admitted claim", async () => {
    const { input, room } = await confirmedRoom();
    await room.dispatch({
      type: "CLAIM_STEP",
      actor: "agent",
      expectedStateVersion: 2,
      idempotencyKey: "claim-artifact",
      planVersion: 1,
      stepId: "artifact",
    });
    const content = JSON.stringify({
      publicUrl: "https://example.test/goal-room",
      demoDurationSeconds: 180,
      verificationCommand: "npm test",
    });
    const sha256 = await digestText(content);

    const result = await room.dispatch({
      type: "SUBMIT_CANDIDATE",
      actor: "agent",
      expectedStateVersion: 3,
      idempotencyKey: "candidate-v1",
      planVersion: 1,
      stepId: "artifact",
      content,
      sha256,
    });

    expect(result).toMatchObject({
      accepted: true,
      stateVersion: 4,
      nextLegalAction: "SYSTEM_VERIFY_CANDIDATE",
      ownerRequired: false,
    });
    expect(room.getState()).toMatchObject({
      phase: "CANDIDATE_SUBMITTED",
      activeCandidate: {
        version: 1,
        planVersion: 1,
        stepId: "artifact",
        content,
        sha256,
        submittedBy: "agent",
      },
      candidateHistory: [{ version: 1, sha256 }],
    });
    expect(await replayGoalRoom(input, room.getReceipts())).toEqual(room.getState());
  });

  it("rejects an externally injected verification result", async () => {
    const { room } = await confirmedRoom();
    await room.dispatch({
      type: "CLAIM_STEP",
      actor: "agent",
      expectedStateVersion: 2,
      idempotencyKey: "claim-artifact",
      planVersion: 1,
      stepId: "artifact",
    });
    const content = JSON.stringify({
      publicUrl: "https://example.test/goal-room",
      demoDurationSeconds: 180,
      verificationCommand: "npm test",
    });
    const sha256 = await digestText(content);
    await room.dispatch({
      type: "SUBMIT_CANDIDATE",
      actor: "agent",
      expectedStateVersion: 3,
      idempotencyKey: "candidate-v1",
      planVersion: 1,
      stepId: "artifact",
      content,
      sha256,
    });
    const before = room.getState();
    const receiptCount = room.getReceipts().length;

    await expect(
      room.dispatch({
        type: "RECORD_VERIFICATION",
        actor: "system",
        expectedStateVersion: 4,
        idempotencyKey: "injected-pass",
        candidateSha256: sha256,
        ruleSetId: "workhub_goal_room_release",
        ruleSetVersion: 1,
        verdict: "PASS",
        findingCodes: [],
      }),
    ).rejects.toThrow("INVALID_COMMAND");
    expect(room.getState()).toEqual(before);
    expect(room.getReceipts()).toHaveLength(receiptCount);
  });

  it("preserves a failed candidate and admits a corrected immutable version", async () => {
    const { input, room } = await confirmedRoom();
    await room.dispatch({
      type: "CLAIM_STEP",
      actor: "agent",
      expectedStateVersion: 2,
      idempotencyKey: "claim-artifact",
      planVersion: 1,
      stepId: "artifact",
    });
    const failedContent = JSON.stringify({
      publicUrl: "http://example.test/goal-room",
      demoDurationSeconds: 181,
      verificationCommand: "npm run build",
    });
    const failedSha256 = await digestText(failedContent);
    await room.dispatch({
      type: "SUBMIT_CANDIDATE",
      actor: "agent",
      expectedStateVersion: 3,
      idempotencyKey: "candidate-v1",
      planVersion: 1,
      stepId: "artifact",
      content: failedContent,
      sha256: failedSha256,
    });
    const failed = await room.verifyActiveCandidate("verify-candidate-v1");
    expect(failed).toMatchObject({
      accepted: true,
      nextLegalAction: "AGENT_SUBMIT_CORRECTED_CANDIDATE",
    });
    expect(room.getState()).toMatchObject({
      phase: "VERIFICATION_FAILED",
      activeVerification: {
        candidateSha256: failedSha256,
        verdict: "FAIL",
        findingCodes: [
          "DEMO_DURATION_OUT_OF_RANGE",
          "PUBLIC_URL_MUST_BE_HTTPS",
          "VERIFICATION_COMMAND_MISMATCH",
        ],
      },
    });

    const correctedContent = JSON.stringify({
      publicUrl: "https://example.test/goal-room",
      demoDurationSeconds: 180,
      verificationCommand: "npm test",
    });
    const correctedSha256 = await digestText(correctedContent);
    const corrected = await room.dispatch({
      type: "SUBMIT_CANDIDATE",
      actor: "agent",
      expectedStateVersion: 5,
      idempotencyKey: "candidate-v2",
      planVersion: 1,
      stepId: "artifact",
      content: correctedContent,
      sha256: correctedSha256,
    });

    expect(corrected).toMatchObject({
      accepted: true,
      stateVersion: 6,
      nextLegalAction: "SYSTEM_VERIFY_CANDIDATE",
    });
    const state = room.getState();
    expect(state.phase).toBe("CANDIDATE_SUBMITTED");
    expect(state.activeCandidate).toMatchObject({ version: 2, sha256: correctedSha256 });
    expect(state.activeVerification).toBeNull();
    expect(state.candidateHistory.map((candidate) => candidate.sha256)).toEqual([
      failedSha256,
      correctedSha256,
    ]);
    expect(state.verificationHistory).toHaveLength(1);
    expect(await replayGoalRoom(input, room.getReceipts())).toEqual(state);
  });

  it("records a system verification bound to candidate digest and rule version", async () => {
    const { input, room } = await confirmedRoom();
    await room.dispatch({
      type: "CLAIM_STEP",
      actor: "agent",
      expectedStateVersion: 2,
      idempotencyKey: "claim-artifact",
      planVersion: 1,
      stepId: "artifact",
    });
    const content = JSON.stringify({
      publicUrl: "https://example.test/goal-room",
      demoDurationSeconds: 180,
      verificationCommand: "npm test",
    });
    const sha256 = await digestText(content);
    await room.dispatch({
      type: "SUBMIT_CANDIDATE",
      actor: "agent",
      expectedStateVersion: 3,
      idempotencyKey: "candidate-v1",
      planVersion: 1,
      stepId: "artifact",
      content,
      sha256,
    });

    const result = await room.verifyActiveCandidate("verify-candidate-v1");
    const receiptCount = room.getReceipts().length;
    const retry = await room.verifyActiveCandidate("verify-candidate-v1");

    expect(retry).toEqual(result);
    expect(room.getReceipts()).toHaveLength(receiptCount);
    expect(result).toMatchObject({
      accepted: true,
      stateVersion: 5,
      nextLegalAction: "AGENT_REQUEST_COMPLETION",
      ownerRequired: false,
    });
    expect(room.getState()).toMatchObject({
      phase: "VERIFICATION_PASSED",
      activeVerification: {
        candidateSha256: sha256,
        ruleSetId: "workhub_goal_room_release",
        ruleSetVersion: 1,
        verdict: "PASS",
        findingCodes: [],
        actor: "system",
      },
    });
    expect(await replayGoalRoom(input, room.getReceipts())).toEqual(room.getState());
  });

  it("refuses candidate bytes from an actor that does not hold the claim", async () => {
    const { room } = await confirmedRoom();
    await room.dispatch({
      type: "CLAIM_STEP",
      actor: "agent",
      expectedStateVersion: 2,
      idempotencyKey: "claim-artifact",
      planVersion: 1,
      stepId: "artifact",
    });
    const content = JSON.stringify({ demoDurationSeconds: 180 });
    const before = room.getState();

    const result = await room.dispatch({
      type: "SUBMIT_CANDIDATE",
      actor: "owner",
      expectedStateVersion: 3,
      idempotencyKey: "owner-candidate",
      planVersion: 1,
      stepId: "artifact",
      content,
      sha256: await digestText(content),
    });

    expect(result).toMatchObject({
      accepted: false,
      reasonCode: "AGENT_ONLY",
      stateVersion: 3,
      nextLegalAction: "AGENT_SUBMIT_CANDIDATE",
      ownerRequired: false,
    });
    expect(room.getState()).toEqual(before);
  });

  it("refuses content that does not match the declared candidate digest", async () => {
    const { room } = await confirmedRoom();
    await room.dispatch({
      type: "CLAIM_STEP",
      actor: "agent",
      expectedStateVersion: 2,
      idempotencyKey: "claim-artifact",
      planVersion: 1,
      stepId: "artifact",
    });
    const original = JSON.stringify({ demoDurationSeconds: 180 });
    const changed = JSON.stringify({ demoDurationSeconds: 181 });
    const before = room.getState();

    const result = await room.dispatch({
      type: "SUBMIT_CANDIDATE",
      actor: "agent",
      expectedStateVersion: 3,
      idempotencyKey: "candidate-mismatched-digest",
      planVersion: 1,
      stepId: "artifact",
      content: changed,
      sha256: await digestText(original),
    });

    expect(result).toMatchObject({
      accepted: false,
      reasonCode: "CANDIDATE_DIGEST_MISMATCH",
      stateVersion: 3,
      nextLegalAction: "AGENT_SUBMIT_CANDIDATE",
      ownerRequired: false,
    });
    expect(room.getState()).toEqual(before);
    expect(room.getState().candidateHistory).toEqual([]);
  });

  it("refuses candidate submission before the exact step is claimed", async () => {
    const { room } = await confirmedRoom();
    const before = room.getState();
    const content = JSON.stringify({
      publicUrl: "https://example.test/goal-room",
      demoDurationSeconds: 180,
      verificationCommand: "npm test",
    });

    const result = await room.dispatch({
      type: "SUBMIT_CANDIDATE",
      actor: "agent",
      expectedStateVersion: 2,
      idempotencyKey: "candidate-before-claim",
      planVersion: 1,
      stepId: "artifact",
      content,
      sha256: await digestText(content),
    } as never);

    expect(result).toMatchObject({
      accepted: false,
      reasonCode: "STEP_CLAIM_REQUIRED",
      stateVersion: 2,
      nextLegalAction: "AGENT_CLAIM_OPEN_STEP",
      ownerRequired: false,
    });
    expect(room.getState()).toEqual(before);
  });
});

describe("Goal Room governed completion", () => {
  it("lets only the owner accept the exact verified completion candidate", async () => {
    const { input, room } = await confirmedRoom();
    await room.dispatch({
      type: "CLAIM_STEP",
      actor: "agent",
      expectedStateVersion: 2,
      idempotencyKey: "claim-artifact",
      planVersion: 1,
      stepId: "artifact",
    });
    const content = JSON.stringify({
      publicUrl: "https://example.test/goal-room",
      demoDurationSeconds: 180,
      verificationCommand: "npm test",
    });
    const sha256 = await digestText(content);
    await room.dispatch({
      type: "SUBMIT_CANDIDATE",
      actor: "agent",
      expectedStateVersion: 3,
      idempotencyKey: "candidate-v1",
      planVersion: 1,
      stepId: "artifact",
      content,
      sha256,
    });
    await room.verifyActiveCandidate("verify-v1");
    await room.dispatch({
      type: "REQUEST_COMPLETION",
      actor: "agent",
      expectedStateVersion: 5,
      idempotencyKey: "request-completion",
      candidateSha256: sha256,
    });

    const stale = await room.dispatch({
      type: "ACCEPT_GOAL",
      actor: "owner",
      expectedStateVersion: 5,
      idempotencyKey: "stale-owner-accept",
      candidateSha256: sha256,
    });
    expect(stale).toMatchObject({
      accepted: false,
      reasonCode: "STALE_STATE",
      stateVersion: 6,
      nextLegalAction: "OWNER_ACCEPT_OR_REQUEST_WORK",
      ownerRequired: true,
    });

    const command = {
      type: "ACCEPT_GOAL" as const,
      actor: "owner" as const,
      expectedStateVersion: 6,
      idempotencyKey: "owner-accept",
      candidateSha256: sha256,
    };
    const result = await room.dispatch(command);
    const receiptCount = room.getReceipts().length;

    expect(result).toMatchObject({
      accepted: true,
      stateVersion: 7,
      nextLegalAction: "GOAL_ACCEPTED_NO_FURTHER_ACTION",
      ownerRequired: false,
    });
    expect(room.getState()).toMatchObject({
      phase: "GOAL_ACCEPTED",
      goalAcceptance: {
        candidateSha256: sha256,
        acceptedBy: "owner",
      },
    });
    expect(await room.dispatch(command)).toEqual(result);
    expect(room.getReceipts()).toHaveLength(receiptCount);
    expect(await replayGoalRoom(input, room.getReceipts())).toEqual(room.getState());
  });

  it("refuses owner acceptance for a digest outside the completion custody chain", async () => {
    const { room } = await confirmedRoom();
    await room.dispatch({
      type: "CLAIM_STEP",
      actor: "agent",
      expectedStateVersion: 2,
      idempotencyKey: "claim-artifact",
      planVersion: 1,
      stepId: "artifact",
    });
    const content = JSON.stringify({
      publicUrl: "https://example.test/goal-room",
      demoDurationSeconds: 180,
      verificationCommand: "npm test",
    });
    const sha256 = await digestText(content);
    await room.dispatch({
      type: "SUBMIT_CANDIDATE",
      actor: "agent",
      expectedStateVersion: 3,
      idempotencyKey: "candidate-v1",
      planVersion: 1,
      stepId: "artifact",
      content,
      sha256,
    });
    await room.verifyActiveCandidate("verify-v1");
    await room.dispatch({
      type: "REQUEST_COMPLETION",
      actor: "agent",
      expectedStateVersion: 5,
      idempotencyKey: "request-completion",
      candidateSha256: sha256,
    });
    const before = room.getState();

    const result = await room.dispatch({
      type: "ACCEPT_GOAL",
      actor: "owner",
      expectedStateVersion: 6,
      idempotencyKey: "wrong-candidate-accept",
      candidateSha256: "0".repeat(64),
    });

    expect(result).toMatchObject({
      accepted: false,
      reasonCode: "CANDIDATE_BINDING_MISMATCH",
      stateVersion: 6,
      nextLegalAction: "OWNER_ACCEPT_OR_REQUEST_WORK",
      ownerRequired: true,
    });
    expect(room.getState()).toEqual(before);
  });

  it("refuses agent self-acceptance after requesting completion", async () => {
    const { room } = await confirmedRoom();
    await room.dispatch({
      type: "CLAIM_STEP",
      actor: "agent",
      expectedStateVersion: 2,
      idempotencyKey: "claim-artifact",
      planVersion: 1,
      stepId: "artifact",
    });
    const content = JSON.stringify({
      publicUrl: "https://example.test/goal-room",
      demoDurationSeconds: 180,
      verificationCommand: "npm test",
    });
    const sha256 = await digestText(content);
    await room.dispatch({
      type: "SUBMIT_CANDIDATE",
      actor: "agent",
      expectedStateVersion: 3,
      idempotencyKey: "candidate-v1",
      planVersion: 1,
      stepId: "artifact",
      content,
      sha256,
    });
    await room.verifyActiveCandidate("verify-v1");
    await room.dispatch({
      type: "REQUEST_COMPLETION",
      actor: "agent",
      expectedStateVersion: 5,
      idempotencyKey: "request-completion",
      candidateSha256: sha256,
    });
    const before = room.getState();

    const result = await room.dispatch({
      type: "ACCEPT_GOAL",
      actor: "agent",
      expectedStateVersion: 6,
      idempotencyKey: "agent-self-accept",
      candidateSha256: sha256,
    } as never);

    expect(result).toMatchObject({
      accepted: false,
      reasonCode: "OWNER_ONLY",
      stateVersion: 6,
      nextLegalAction: "OWNER_ACCEPT_OR_REQUEST_WORK",
      ownerRequired: true,
    });
    expect(room.getState()).toEqual(before);
  });

  it("turns a verified candidate into an owner-gated completion request", async () => {
    const { input, room } = await confirmedRoom();
    await room.dispatch({
      type: "CLAIM_STEP",
      actor: "agent",
      expectedStateVersion: 2,
      idempotencyKey: "claim-artifact",
      planVersion: 1,
      stepId: "artifact",
    });
    const content = JSON.stringify({
      publicUrl: "https://example.test/goal-room",
      demoDurationSeconds: 180,
      verificationCommand: "npm test",
    });
    const sha256 = await digestText(content);
    await room.dispatch({
      type: "SUBMIT_CANDIDATE",
      actor: "agent",
      expectedStateVersion: 3,
      idempotencyKey: "candidate-v1",
      planVersion: 1,
      stepId: "artifact",
      content,
      sha256,
    });
    await room.verifyActiveCandidate("verify-v1");

    const ownerAttempt = await room.dispatch({
      type: "REQUEST_COMPLETION",
      actor: "owner",
      expectedStateVersion: 5,
      idempotencyKey: "owner-completion-attempt",
      candidateSha256: sha256,
    });
    expect(ownerAttempt).toMatchObject({
      accepted: false,
      reasonCode: "AGENT_ONLY",
      stateVersion: 5,
      nextLegalAction: "AGENT_REQUEST_COMPLETION",
      ownerRequired: false,
    });

    const result = await room.dispatch({
      type: "REQUEST_COMPLETION",
      actor: "agent",
      expectedStateVersion: 5,
      idempotencyKey: "request-completion",
      candidateSha256: sha256,
    });

    expect(result).toMatchObject({
      accepted: true,
      stateVersion: 6,
      nextLegalAction: "OWNER_ACCEPT_OR_REQUEST_WORK",
      ownerRequired: true,
    });
    expect(room.getState()).toMatchObject({
      phase: "COMPLETION_REQUESTED",
      activeCompletionRequest: {
        candidateSha256: sha256,
        requestedBy: "agent",
      },
    });
    expect(room.getState().phase).not.toBe("GOAL_ACCEPTED");
    expect(await replayGoalRoom(input, room.getReceipts())).toEqual(room.getState());
  });

  it("refuses completion until the active candidate has deterministic PASS", async () => {
    const { room } = await confirmedRoom();
    await room.dispatch({
      type: "CLAIM_STEP",
      actor: "agent",
      expectedStateVersion: 2,
      idempotencyKey: "claim-artifact",
      planVersion: 1,
      stepId: "artifact",
    });
    const content = JSON.stringify({
      publicUrl: "https://example.test/goal-room",
      demoDurationSeconds: 180,
      verificationCommand: "npm test",
    });
    const sha256 = await digestText(content);
    await room.dispatch({
      type: "SUBMIT_CANDIDATE",
      actor: "agent",
      expectedStateVersion: 3,
      idempotencyKey: "candidate-v1",
      planVersion: 1,
      stepId: "artifact",
      content,
      sha256,
    });
    const before = room.getState();

    const result = await room.dispatch({
      type: "REQUEST_COMPLETION",
      actor: "agent",
      expectedStateVersion: 4,
      idempotencyKey: "premature-completion",
      candidateSha256: sha256,
    } as never);

    expect(result).toMatchObject({
      accepted: false,
      reasonCode: "VERIFICATION_REQUIRED",
      missingConditions: ["ACTIVE_CANDIDATE_MUST_PASS_RELEASE_RULES"],
      stateVersion: 4,
      nextLegalAction: "SYSTEM_VERIFY_CANDIDATE",
      ownerRequired: false,
    });
    expect(room.getState()).toEqual(before);
  });
});

describe("Goal Room admitted-step custody", () => {
  it("lets the agent claim an exact step from the confirmed Plan", async () => {
    const { input, room } = await confirmedRoom();

    const result = await room.dispatch({
      type: "CLAIM_STEP",
      actor: "agent",
      expectedStateVersion: 2,
      idempotencyKey: "claim-artifact-v1",
      planVersion: 1,
      stepId: "artifact",
    } as never);

    expect(result).toMatchObject({
      accepted: true,
      stateVersion: 3,
      nextLegalAction: "AGENT_SUBMIT_CANDIDATE",
      ownerRequired: false,
    });
    expect(room.getState()).toMatchObject({
      phase: "STEP_CLAIMED",
      activeClaim: {
        planVersion: 1,
        stepId: "artifact",
        claimedBy: "agent",
      },
    });
    expect(await replayGoalRoom(input, room.getReceipts())).toEqual(room.getState());
  });

  it("refuses a step that is not admitted by the confirmed Plan", async () => {
    const { room } = await confirmedRoom();
    const before = room.getState();

    const result = await room.dispatch({
      type: "CLAIM_STEP",
      actor: "agent",
      expectedStateVersion: 2,
      idempotencyKey: "claim-invented-step",
      planVersion: 1,
      stepId: "deploy-production",
    });

    expect(result).toMatchObject({
      accepted: false,
      reasonCode: "STEP_NOT_ADMITTED",
      stateVersion: 2,
      nextLegalAction: "AGENT_CLAIM_OPEN_STEP",
      ownerRequired: false,
    });
    expect(room.getState()).toEqual(before);
  });

  it("refuses non-agent step custody without mutating authority", async () => {
    const { room } = await confirmedRoom();
    const before = room.getState();

    const result = await room.dispatch({
      type: "CLAIM_STEP",
      actor: "owner",
      expectedStateVersion: 2,
      idempotencyKey: "owner-claim",
      planVersion: 1,
      stepId: "artifact",
    });

    expect(result).toMatchObject({
      accepted: false,
      reasonCode: "AGENT_ONLY",
      stateVersion: 2,
      nextLegalAction: "AGENT_CLAIM_OPEN_STEP",
      ownerRequired: false,
    });
    expect(room.getState()).toEqual(before);
  });
});
