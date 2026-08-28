import { describe, expect, it, vi } from "vitest";
import { createGoalRoom, type DispatchResult, type GoalRoomState } from "./core/goalRoom";
import { createSystemVerifierAdapter } from "./systemVerifierAdapter";

const candidateDigest = "a".repeat(64);

async function digestText(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function submittedState(version = 1, sha256 = candidateDigest): GoalRoomState {
  return {
    goal: "Ship a governed release",
    doneLooksLike: ["Owner accepts exact verified evidence"],
    ownerIntent: null,
    seededOwnerIntent: null,
    activeGoalContract: null,
    goalContractHistory: [],
    phase: "CANDIDATE_SUBMITTED",
    stateVersion: 4,
    activePlan: null,
    planHistory: [],
    activeClaim: null,
    activeCandidate: {
      version,
      planVersion: 1,
      stepId: "artifact",
      content: "candidate",
      sha256,
      submittedBy: "agent",
    },
    candidateHistory: [],
    activeVerification: null,
    verificationHistory: [],
    activeCompletionRequest: null,
    goalAcceptance: null,
  };
}

describe("production System verifier adapter", () => {
  it("ignores non-submit, refused, and canonically inadmissible observations", () => {
    const verifyActiveCandidate = vi.fn();
    const state = submittedState();
    const room = { getState: () => state, verifyActiveCandidate };
    const adapter = createSystemVerifierAdapter({ room });

    expect(() => adapter.observe({
      toolName: "propose_plan",
      result: { accepted: true },
    })).not.toThrow();
    expect(() => adapter.observe({
      toolName: "submit_artifact",
      result: { accepted: false },
    })).not.toThrow();
    state.phase = "STEP_CLAIMED";
    expect(() => adapter.observe({
      toolName: "submit_artifact",
      result: { accepted: true },
    })).not.toThrow();

    expect(verifyActiveCandidate).not.toHaveBeenCalled();
  });

  it("verifies the canonical candidate once with a version-and-digest key before settling", async () => {
    const state = submittedState(7, candidateDigest);
    let resolveVerification!: (result: DispatchResult) => void;
    const verification = new Promise<DispatchResult>((resolve) => {
      resolveVerification = resolve;
    });
    const verifyActiveCandidate = vi.fn(() => verification);
    const onSettled = vi.fn();
    const adapter = createSystemVerifierAdapter({
      room: { getState: () => state, verifyActiveCandidate },
      onSettled,
    });

    adapter.observe({
      toolName: "submit_artifact",
      result: {
        accepted: true,
        candidateVersion: 999,
        candidateSha256: "f".repeat(64),
      },
    });

    await vi.waitFor(() => expect(verifyActiveCandidate).toHaveBeenCalledOnce());
    expect(verifyActiveCandidate).toHaveBeenCalledWith(
      `system-verify:v7:${candidateDigest}`,
    );
    expect(onSettled).not.toHaveBeenCalled();

    resolveVerification({
      accepted: true,
      stateVersion: 5,
      nextLegalAction: "AGENT_REQUEST_COMPLETION",
      ownerRequired: false,
    });
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledOnce());
  });

  it("serializes duplicate observations so one candidate is never verified concurrently", async () => {
    const state = submittedState();
    let resolveVerification!: (result: DispatchResult) => void;
    const verification = new Promise<DispatchResult>((resolve) => {
      resolveVerification = resolve;
    });
    const verifyActiveCandidate = vi.fn(() => verification);
    const adapter = createSystemVerifierAdapter({
      room: { getState: () => state, verifyActiveCandidate },
    });
    const record = { toolName: "submit_artifact", result: { accepted: true } };

    adapter.observe(record);
    adapter.observe(record);

    await vi.waitFor(() => expect(verifyActiveCandidate).toHaveBeenCalledOnce());
    resolveVerification({
      accepted: true,
      stateVersion: 5,
      nextLegalAction: "AGENT_REQUEST_COMPLETION",
      ownerRequired: false,
    });
    await Promise.resolve();
    expect(verifyActiveCandidate).toHaveBeenCalledOnce();
  });

  it("drops a queued observation when canonical candidate custody changes", async () => {
    const state = submittedState(1);
    let resolveFirst!: (result: DispatchResult) => void;
    const first = new Promise<DispatchResult>((resolve) => {
      resolveFirst = resolve;
    });
    const verifyActiveCandidate = vi.fn(() => first);
    const adapter = createSystemVerifierAdapter({
      room: { getState: () => state, verifyActiveCandidate },
    });

    adapter.observe({ toolName: "submit_artifact", result: { accepted: true } });
    await vi.waitFor(() => expect(verifyActiveCandidate).toHaveBeenCalledOnce());
    state.activeCandidate = submittedState(2).activeCandidate;
    adapter.observe({ toolName: "submit_artifact", result: { accepted: true } });
    state.phase = "VERIFICATION_FAILED";
    resolveFirst({
      accepted: true,
      stateVersion: 5,
      nextLegalAction: "AGENT_SUBMIT_CORRECTED_CANDIDATE",
      ownerRequired: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(verifyActiveCandidate).toHaveBeenCalledOnce();
  });

  it("uses distinct keys for candidate versions even when bytes are identical", async () => {
    const state = submittedState(1);
    const verifyActiveCandidate = vi.fn(async (_key: string): Promise<DispatchResult> => ({
      accepted: true,
      stateVersion: state.stateVersion + 1,
      nextLegalAction: "AGENT_SUBMIT_CORRECTED_CANDIDATE",
      ownerRequired: false,
    }));
    const onSettled = vi.fn();
    const adapter = createSystemVerifierAdapter({
      room: { getState: () => state, verifyActiveCandidate },
      onSettled,
    });

    adapter.observe({ toolName: "submit_artifact", result: { accepted: true } });
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    state.activeCandidate = submittedState(2).activeCandidate;
    adapter.observe({ toolName: "submit_artifact", result: { accepted: true } });
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledTimes(2));

    expect(verifyActiveCandidate.mock.calls.map(([key]) => key)).toEqual([
      `system-verify:v1:${candidateDigest}`,
      `system-verify:v2:${candidateDigest}`,
    ]);
  });

  it("drives real candidates through deterministic System FAIL then PASS", async () => {
    const room = createGoalRoom({
      goal: "Ship",
      doneLooksLike: ["Owner accepts exact verified evidence"],
    });
    await room.dispatch({
      type: "PROPOSE_PLAN", actor: "agent", expectedStateVersion: 0,
      idempotencyKey: "plan", steps: [{ id: "artifact", title: "Release artifact" }],
    });
    await room.dispatch({
      type: "CONFIRM_PLAN", actor: "owner", expectedStateVersion: 1,
      idempotencyKey: "confirm", planVersion: 1,
    });
    await room.dispatch({
      type: "CLAIM_STEP", actor: "agent", expectedStateVersion: 2,
      idempotencyKey: "claim", planVersion: 1, stepId: "artifact",
    });
    const failedContent = JSON.stringify({
      publicUrl: "http://example.test",
      demoDurationSeconds: 181,
      verificationCommand: "npm run build",
    });
    await room.dispatch({
      type: "SUBMIT_CANDIDATE", actor: "agent", expectedStateVersion: 3,
      idempotencyKey: "candidate-v1", planVersion: 1, stepId: "artifact",
      content: failedContent, sha256: await digestText(failedContent),
    });
    const adapter = createSystemVerifierAdapter({ room });

    adapter.observe({ toolName: "submit_artifact", result: { accepted: true } });
    await vi.waitFor(() => expect(room.getState().phase).toBe("VERIFICATION_FAILED"));

    const passingContent = JSON.stringify({
      publicUrl: "https://example.test",
      demoDurationSeconds: 180,
      verificationCommand: "npm test",
    });
    await room.dispatch({
      type: "SUBMIT_CANDIDATE", actor: "agent", expectedStateVersion: 5,
      idempotencyKey: "candidate-v2", planVersion: 1, stepId: "artifact",
      content: passingContent, sha256: await digestText(passingContent),
    });
    adapter.observe({ toolName: "submit_artifact", result: { accepted: true } });
    await vi.waitFor(() => expect(room.getState().phase).toBe("VERIFICATION_PASSED"));

    expect(room.getState().verificationHistory.map(({ verdict, actor }) => ({ verdict, actor }))).toEqual([
      { verdict: "FAIL", actor: "system" },
      { verdict: "PASS", actor: "system" },
    ]);
  });

  it("recovers the queue after a canonical candidate re-read fails", async () => {
    const state = submittedState();
    const failure = new Error("CANONICAL_REREAD_FAILED");
    let reads = 0;
    const getState = vi.fn(() => {
      reads += 1;
      if (reads === 2) throw failure;
      return state;
    });
    const verifyActiveCandidate = vi.fn(async (): Promise<DispatchResult> => ({
      accepted: true,
      stateVersion: 5,
      nextLegalAction: "AGENT_REQUEST_COMPLETION",
      ownerRequired: false,
    }));
    const onError = vi.fn();
    const onSettled = vi.fn();
    const adapter = createSystemVerifierAdapter({
      room: { getState, verifyActiveCandidate },
      onError,
      onSettled,
    });
    const record = { toolName: "submit_artifact", result: { accepted: true } };

    adapter.observe(record);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
    expect(verifyActiveCandidate).not.toHaveBeenCalled();

    adapter.observe(record);
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledOnce());
    expect(verifyActiveCandidate).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("retries an exact candidate after verification rejects before an authoritative verdict", async () => {
    const state = submittedState();
    const before = structuredClone(state);
    const failure = new Error("VERIFIER_UNAVAILABLE");
    let attempts = 0;
    const verifyActiveCandidate = vi.fn(async (): Promise<DispatchResult> => {
      attempts += 1;
      if (attempts === 1) throw failure;
      return {
        accepted: true,
        stateVersion: 5,
        nextLegalAction: "AGENT_REQUEST_COMPLETION",
        ownerRequired: false,
      };
    });
    const onError = vi.fn();
    const onSettled = vi.fn();
    const adapter = createSystemVerifierAdapter({
      room: { getState: () => state, verifyActiveCandidate },
      onError,
      onSettled,
    });
    const record = { toolName: "submit_artifact", result: { accepted: true } };

    adapter.observe(record);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
    expect(state).toEqual(before);
    expect(state.phase).toBe("CANDIDATE_SUBMITTED");
    expect(state.verificationHistory).toEqual([]);
    expect(onSettled).not.toHaveBeenCalled();

    adapter.observe(record);
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledOnce());
    adapter.observe(record);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(verifyActiveCandidate).toHaveBeenCalledTimes(2);
    expect(onSettled).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("fails closed and swallows a throwing error reporter without retrying authority", async () => {
    const state = submittedState();
    const before = structuredClone(state);
    const failure = new Error("VERIFIER_UNAVAILABLE");
    const verifyActiveCandidate = vi.fn(async () => { throw failure; });
    const onError = vi.fn(() => { throw new Error("REPORTER_FAILED"); });
    const onSettled = vi.fn();
    const adapter = createSystemVerifierAdapter({
      room: { getState: () => state, verifyActiveCandidate },
      onError,
      onSettled,
    });
    const record = { toolName: "submit_artifact", result: { accepted: true } };

    adapter.observe(record);
    adapter.observe(record);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
    expect(verifyActiveCandidate).toHaveBeenCalledOnce();
    expect(onSettled).not.toHaveBeenCalled();
    expect(state).toEqual(before);
  });
});
