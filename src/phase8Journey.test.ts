import {
  RELEASE_GUARDIAN_SOURCE_BASE_COMMIT,
  createReleaseGuardianEnvelope,
} from "./verifier/releaseRules";
import { describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  HISTORICAL_V1_REPLAY_ALLOWLIST,
  createGoalRoom,
  replayGoalRoom,
  type GoalRoomState,
} from "./core/goalRoom";
import { createOwnerDecisionController } from "./ownerController";
import { installGoalRoomTools } from "./webmcp";

const execFileAsync = promisify(execFile);

async function digestText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const goalV1 = {
  goal: "Qualify the exact governed release",
  why: "Keep owner authority and immutable evidence visible.",
  doneLooksLike: ["Owner accepts the exact corrected candidate after deterministic PASS"],
  constraints: ["No external effects"],
  nonGoals: ["Autonomous model selection"],
  evidenceRequired: ["Replayable receipt chain"],
  openQuestions: ["Which exact Plan step is bound?"],
};

function mutationSnapshot(state: GoalRoomState, receiptCount: number) {
  return {
    version: state.stateVersion,
    phase: state.phase,
    goalVersions: state.goalContractHistory.map(({ version, status }) => `${version}:${status}`),
    planBindings: state.planHistory.map(({ version, status, goalContractVersion }) => `${version}:${status}:g${goalContractVersion}`),
    candidates: state.candidateHistory.map(({ version, sha256 }) => `${version}:${sha256.slice(0, 12)}`),
    verdicts: state.verificationHistory.map(({ verdict, candidateSha256 }) => `${verdict}:${candidateSha256.slice(0, 12)}`),
    accepted: state.goalAcceptance !== null,
    receipts: receiptCount,
  };
}

async function runFullJourney() {
  const input = { ownerIntent: null } as const;
  const room = createGoalRoom(input);
  const rendered: GoalRoomState[] = [];
  const owner = createOwnerDecisionController({
    room,
    render: () => rendered.push(room.getState()),
  });
  const registerTool = vi.fn();
  installGoalRoomTools({
    documentLike: { modelContext: { registerTool } },
    navigatorLike: {},
    room,
    onInvocation: vi.fn(),
  });
  const definitions = registerTool.mock.calls.map(([definition]) => definition);
  const tools = new Map<string, any>(definitions.map((definition) => [definition.name, definition]));
  const invoke = (name: string, value: unknown) => tools.get(name).execute(value);
  const checkpoints: ReturnType<typeof mutationSnapshot>[] = [];
  const snap = () => checkpoints.push(mutationSnapshot(room.getState(), room.getReceipts().length));

  expect(definitions.map(({ name }) => name)).toEqual([
    "get_goal_room_state", "propose_goal_contract", "propose_plan",
    "claim_step", "submit_artifact", "request_completion",
  ]);
  expect(await invoke("get_goal_room_state", {})).toMatchObject({
    accepted: true, readOnly: true, currentStateVersion: 0,
    currentActor: "owner", nextLegalAction: "OWNER_SET_INTENT", ownerRequired: true,
  });

  await owner.setOwnerIntent("Qualify one public-safe governed journey.");
  snap();
  const goal1Input = { expectedStateVersion: 1, idempotencyKey: "p8-goal-v1", ...goalV1 };
  const goal1 = await invoke("propose_goal_contract", goal1Input);
  expect(goal1).toMatchObject({ accepted: true, currentStateVersion: 2, ownerRequired: true });
  expect(await invoke("propose_goal_contract", structuredClone(goal1Input))).toEqual(goal1);
  snap();

  const malformedBefore = { state: room.getState(), receipts: room.getReceipts() };
  expect(await invoke("propose_goal_contract", { ...goal1Input, actor: "owner" })).toMatchObject({
    accepted: false, reasonCode: "INVALID_TOOL_INPUT", currentStateVersion: 2,
  });
  expect({ state: room.getState(), receipts: room.getReceipts() }).toEqual(malformedBefore);
  await owner.requestGoalRevision("Bind the Plan to the corrected Goal and close the question.");
  snap();

  const staleBefore = room.getState();
  expect(await invoke("propose_goal_contract", {
    ...goalV1, expectedStateVersion: 2, idempotencyKey: "p8-stale-goal-v2", openQuestions: [],
  })).toMatchObject({ accepted: false, reasonCode: "STALE_STATE", currentStateVersion: 3 });
  expect(room.getState()).toEqual(staleBefore);
  const goal2Input = {
    ...goalV1, expectedStateVersion: 3, idempotencyKey: "p8-goal-v2",
    doneLooksLike: ["Owner accepts corrected candidate v2 after deterministic PASS"], openQuestions: [],
  };
  const goal2 = await invoke("propose_goal_contract", goal2Input);
  expect(await invoke("propose_goal_contract", structuredClone(goal2Input))).toEqual(goal2);
  await owner.confirmGoalContract();
  snap();

  const plan1Input = {
    expectedStateVersion: 5, idempotencyKey: "p8-plan-v1", goalContractVersion: 2,
    steps: [{ id: "release", title: "Produce exact governed release evidence" }],
  };
  const plan1 = await invoke("propose_plan", plan1Input);
  expect(plan1).toMatchObject({ accepted: true, currentStateVersion: 6, ownerRequired: true });
  expect(await invoke("propose_plan", structuredClone(plan1Input))).toEqual(plan1);
  await owner.requestRevision("Make the step explicitly bind corrected candidate v2.");
  snap();
  const plan2Input = {
    expectedStateVersion: 7, idempotencyKey: "p8-plan-v2", goalContractVersion: 2,
    steps: [{ id: "release", title: "Produce corrected candidate v2 and deterministic evidence" }],
  };
  const plan2 = await invoke("propose_plan", plan2Input);
  expect(await invoke("propose_plan", structuredClone(plan2Input))).toEqual(plan2);
  await owner.confirmPlan();
  snap();

  const claimInput = { expectedStateVersion: 9, idempotencyKey: "p8-claim", planVersion: 2, stepId: "release" };
  const claim = await invoke("claim_step", claimInput);
  expect(await invoke("claim_step", structuredClone(claimInput))).toEqual(claim);
  snap();

  const failedContent = createReleaseGuardianEnvelope({ proofManifestSha256: "a9a9aac7896a3583a0db78ec5e801e906f0872659e1bf6d36922d091b4294c60" });
  const failedSha = await digestText(failedContent);
  const submit1Input = {
    expectedStateVersion: 10, idempotencyKey: "p8-candidate-v1", planVersion: 2,
    stepId: "release", content: failedContent, sha256: failedSha,
  };
  const submit1 = await invoke("submit_artifact", submit1Input);
  expect(await invoke("submit_artifact", structuredClone(submit1Input))).toEqual(submit1);
  snap();
  const earlyCompletionState = room.getState();
  expect(await invoke("request_completion", {
    expectedStateVersion: 11, idempotencyKey: "p8-completion-too-early", candidateSha256: failedSha,
  })).toMatchObject({ accepted: false, reasonCode: "VERIFICATION_REQUIRED", currentStateVersion: 11 });
  expect(room.getState()).toEqual(earlyCompletionState);

  const fail = await room.verifyActiveCandidate("p8-system-verify-v1");
  expect(await room.verifyActiveCandidate("p8-system-verify-v1")).toEqual(fail);
  expect(room.getState()).toMatchObject({
    phase: "VERIFICATION_FAILED",
    activeVerification: {
      actor: "system", verdict: "FAIL", candidateSha256: failedSha,
      ruleSetId: "workhub_goal_room_release", ruleSetVersion: 2,
      findingCodes: ["PROOF_MANIFEST_MISMATCH"],
    },
    goalAcceptance: null,
  });
  snap();

  const passedContent = createReleaseGuardianEnvelope();
  const passedSha = await digestText(passedContent);
  const submit2Input = {
    expectedStateVersion: 12, idempotencyKey: "p8-candidate-v2", planVersion: 2,
    stepId: "release", content: passedContent, sha256: passedSha,
  };
  const submit2 = await invoke("submit_artifact", submit2Input);
  expect(await invoke("submit_artifact", structuredClone(submit2Input))).toEqual(submit2);
  const pass = await room.verifyActiveCandidate("p8-system-verify-v2");
  expect(await room.verifyActiveCandidate("p8-system-verify-v2")).toEqual(pass);
  expect(room.getState()).toMatchObject({
    phase: "VERIFICATION_PASSED", stateVersion: 14,
    activeVerification: { actor: "system", verdict: "PASS", candidateSha256: passedSha },
    activeCompletionRequest: null, goalAcceptance: null,
  });
  snap();

  const completionInput = {
    expectedStateVersion: 14, idempotencyKey: "p8-completion", candidateSha256: passedSha,
  };
  const completion = await invoke("request_completion", completionInput);
  expect(await invoke("request_completion", structuredClone(completionInput))).toEqual(completion);
  expect(room.getState()).toMatchObject({
    phase: "COMPLETION_REQUESTED", stateVersion: 15,
    activeCompletionRequest: { requestedBy: "agent", candidateSha256: passedSha },
    goalAcceptance: null,
  });
  snap();
  await owner.acceptGoal();
  snap();

  const finalState = room.getState();
  const receipts = room.getReceipts();
  expect(finalState).toMatchObject({
    phase: "GOAL_ACCEPTED", stateVersion: 16,
    activeGoalContract: { version: 2, status: "CONFIRMED" },
    activePlan: { version: 2, status: "CONFIRMED", goalContractVersion: 2 },
    activeClaim: { planVersion: 2, stepId: "release", claimedBy: "agent" },
    activeCandidate: { version: 2, planVersion: 2, stepId: "release", sha256: passedSha },
    goalAcceptance: { acceptedBy: "owner", candidateSha256: passedSha },
  });
  expect(finalState.goalContractHistory).toMatchObject([
    { version: 1, status: "REVISION_REQUESTED", revisionRequest: { requestedBy: "owner" } },
    { version: 2, status: "CONFIRMED", openQuestions: [] },
  ]);
  expect(finalState.planHistory).toMatchObject([
    { version: 1, status: "REVISION_REQUESTED", goalContractVersion: 2, revisionRequest: { requestedBy: "owner" } },
    { version: 2, status: "CONFIRMED", goalContractVersion: 2 },
  ]);
  expect(finalState.candidateHistory.map(({ version, sha256 }) => ({ version, sha256 }))).toEqual([
    { version: 1, sha256: failedSha }, { version: 2, sha256: passedSha },
  ]);
  expect(finalState.verificationHistory.map(({ verdict, candidateSha256 }) => ({ verdict, candidateSha256 }))).toEqual([
    { verdict: "FAIL", candidateSha256: failedSha }, { verdict: "PASS", candidateSha256: passedSha },
  ]);
  expect(receipts).toHaveLength(18);
  expect(receipts[0].previousHash).toBe("GENESIS");
  receipts.forEach((receipt, index) => {
    expect(receipt.sequence).toBe(index + 1);
    expect(receipt.hash).toMatch(/^[0-9a-f]{64}$/);
    if (index > 0) expect(receipt.previousHash).toBe(receipts[index - 1].hash);
  });
  expect(await replayGoalRoom(input, receipts)).toEqual(finalState);
  expect(await invoke("get_goal_room_state", {})).toMatchObject({
    accepted: true, readOnly: true, currentStateVersion: 16,
    currentActor: "none", nextLegalAction: "GOAL_ACCEPTED_NO_FURTHER_ACTION", ownerRequired: false,
    acceptance: { status: "ACCEPTED", candidateDigest: passedSha },
  });
  expect(rendered.at(-1)).toEqual(finalState);
  return { finalState, checkpoints };
}

describe("Phase 8 installed-surface full journey qualification", () => {
  it("replays the exact governed Goal-to-acceptance journey", async () => {
    const result = await runFullJourney();
    expect(result.finalState).toMatchObject({ phase: "GOAL_ACCEPTED", stateVersion: 16 });
    expect(result.checkpoints).toMatchSnapshot();
  });

  it("replays the captured real-production browser receipt ledger", async () => {
    const evidencePath = resolve("evaluation/production-journey/journey.json");
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    expect(evidence.kind).toBe("goal-room-real-production-journey");
    expect(evidence.route).toMatchObject({ entry: "/index.html", fixtureImports: [] });
    expect(evidence.invocation.class).toBe("captured-registered-webmcp-descriptor-callbacks");
    expect(evidence.receipts).toHaveLength(22);
    expect(await replayGoalRoom({ ownerIntent: null }, evidence.receipts)).toEqual(evidence.finalState);
    expect(evidence.finalState).toMatchObject({ phase: "GOAL_ACCEPTED", stateVersion: 16 });
    expect(evidence.terminal).toMatchObject({ actor: "none", currentActor: "none", buttons: 0 });
  });
});

/** Byte-identical reimplementation of the core receipt canonicalization. */
function canonicalise(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalise(record[key])}`)
    .join(",")}}`;
}

/**
 * Re-links and re-hashes a tampered ledger exactly as the core would, so the
 * forgery tests below prove the replay *evaluator* rejects the forged verdict
 * rather than merely detecting a broken hash chain.
 */
async function rehashLedger(receipts: Record<string, unknown>[]) {
  let previousHash = "GENESIS";
  const rebuilt = [];
  for (const [index, receipt] of receipts.entries()) {
    const body: Record<string, unknown> = {
      sequence: index + 1,
      previousHash,
      command: receipt.command,
      accepted: receipt.accepted,
      ...(receipt.reasonCode ? { reasonCode: receipt.reasonCode } : {}),
      ...(receipt.missingConditions ? { missingConditions: receipt.missingConditions } : {}),
      stateVersion: receipt.stateVersion,
    };
    previousHash = await digestText(canonicalise(body));
    rebuilt.push({ ...body, hash: previousHash });
  }
  return rebuilt;
}

async function historicalV1Ledger() {
  const { stdout } = await execFileAsync(
    "git",
    [
      "show",
      `${RELEASE_GUARDIAN_SOURCE_BASE_COMMIT}:evaluation/production-journey/journey.json`,
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  const evidence = JSON.parse(stdout);
  return evidence as {
    receipts: Record<string, unknown>[];
    finalState: GoalRoomState;
  };
}

describe("immutable historical v1 receipts remain replayable but unforgeable", () => {
  it("confirms the captured ledger really does declare the retired v1 ruleset", async () => {
    const { receipts } = await historicalV1Ledger();
    const verifications = receipts
      .map((receipt) => receipt.command as Record<string, unknown>)
      .filter((command) => command.type === "RECORD_VERIFICATION");

    expect(verifications.length).toBeGreaterThan(0);
    expect(verifications.every((command) => command.ruleSetVersion === 1)).toBe(true);
    expect(HISTORICAL_V1_REPLAY_ALLOWLIST).toEqual([{
      inputSha256: "1a18f00a32bf9782c8f688ce5291c68a6482a808c2c6aec821302202bc5158ef",
      receiptCount: 22,
      receiptRootHash: "27dd043bfbefc422de2d76214f3170f6717cb3f44618bf350dcc492849803c5f",
      ledgerSha256: "8a3895275bbbcdd6271a34db8127907199c9d36033c13badb1a60b5bd36e999a",
    }]);
    expect(receipts.at(-1)?.hash).toBe(HISTORICAL_V1_REPLAY_ALLOWLIST[0].receiptRootHash);
    expect(await digestText(canonicalise(receipts))).toBe(
      HISTORICAL_V1_REPLAY_ALLOWLIST[0].ledgerSha256,
    );
  });

  it("replays the untouched historical ledger after a lossless rehash", async () => {
    const { receipts, finalState } = await historicalV1Ledger();
    const rebuilt = await rehashLedger(receipts);

    expect(rebuilt.map(({ hash }) => hash)).toEqual(receipts.map((receipt) => receipt.hash));
    expect(await replayGoalRoom({ ownerIntent: null }, rebuilt as never)).toEqual(finalState);
  });

  it("refuses a forged historical v1 PASS even with a perfectly re-linked chain", async () => {
    const { receipts } = await historicalV1Ledger();
    const forged = structuredClone(receipts);
    const target = forged.find((receipt) => {
      const command = receipt.command as Record<string, unknown>;
      return command.type === "RECORD_VERIFICATION" && command.verdict === "FAIL";
    });
    expect(target).toBeDefined();
    const forgedCommand = target!.command as Record<string, unknown>;
    forgedCommand.verdict = "PASS";
    forgedCommand.findingCodes = [];

    const rebuilt = await rehashLedger(forged);
    expect(rebuilt.at(-1)!.hash).not.toBe(receipts.at(-1)!.hash);

    await expect(replayGoalRoom({ ownerIntent: null }, rebuilt as never)).rejects.toThrow(
      "HISTORICAL_V1_PROVENANCE_REQUIRED",
    );
  });

  it("refuses a historical v1 verdict re-labelled as the live v2 ruleset", async () => {
    const { receipts } = await historicalV1Ledger();
    const forged = structuredClone(receipts);
    for (const receipt of forged) {
      const command = receipt.command as Record<string, unknown>;
      if (command.type === "RECORD_VERIFICATION") command.ruleSetVersion = 2;
    }

    await expect(
      replayGoalRoom({ ownerIntent: null }, (await rehashLedger(forged)) as never),
    ).rejects.toThrow("VERIFICATION_RESULT_MISMATCH");
  });

  it("refuses a historical v1 verdict bound to substituted candidate bytes", async () => {
    const { receipts } = await historicalV1Ledger();
    const forged = structuredClone(receipts);
    const submission = forged.find(
      (receipt) =>
        receipt.accepted === true &&
        (receipt.command as Record<string, unknown>).type === "SUBMIT_CANDIDATE",
    );
    expect(submission).toBeDefined();
    const submissionCommand = submission!.command as Record<string, string>;
    expect(submissionCommand.content).not.toBe(createReleaseGuardianEnvelope());
    submissionCommand.content = createReleaseGuardianEnvelope();

    await expect(
      replayGoalRoom({ ownerIntent: null }, (await rehashLedger(forged)) as never),
    ).rejects.toThrow("HISTORICAL_V1_PROVENANCE_REQUIRED");
  });

  it("refuses the authentic v1 ledger under a non-allowlisted initial input", async () => {
    const { receipts } = await historicalV1Ledger();
    await expect(
      replayGoalRoom({ ownerIntent: "Substituted initial provenance" }, receipts as never),
    ).rejects.toThrow("HISTORICAL_V1_PROVENANCE_REQUIRED");
  });

  it("refuses a re-linked splice of the historical v1 chain", async () => {
    const { receipts } = await historicalV1Ledger();
    const spliced = structuredClone(receipts);
    spliced.splice(5, 1);
    await expect(
      replayGoalRoom({ ownerIntent: null }, (await rehashLedger(spliced)) as never),
    ).rejects.toThrow("HISTORICAL_V1_PROVENANCE_REQUIRED");
  });
});
