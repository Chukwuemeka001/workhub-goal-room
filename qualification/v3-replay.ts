import {
  createGoalRoom,
  replayGoalRoom,
  type GoalRoomState,
  type Receipt,
} from "../src/core/goalRoom";
import { createOwnerDecisionController } from "../src/ownerController";
import { installGoalRoomTools } from "../src/webmcp";

export const V3_HOSTILE_MARKERS = [
  "<script>v3Qualification()</script>",
  "<img src=x onerror=v3Qualification()>",
  "<svg onload=v3Qualification()>",
  "</textarea><input autofocus onfocus=v3Qualification()>",
] as const;

export const V3_STORY_CATALOG = [
  { id: "S01", label: "Owner intent recorded", kernelPhase: "INTENT_DRAFT", presentation: "canonical" },
  { id: "S02", label: "Goal Contract proposed", kernelPhase: "GOAL_CONTRACT_PROPOSED", presentation: "canonical" },
  { id: "S03", label: "Goal revision requested", kernelPhase: "GOAL_CONTRACT_REVISION_REQUESTED", presentation: "canonical" },
  { id: "S04", label: "Goal Contract confirmed", kernelPhase: "GOAL_CONTRACT_CONFIRMED", presentation: "canonical" },
  { id: "S05", label: "Plan proposed", kernelPhase: "PLAN_PROPOSED", presentation: "canonical" },
  { id: "S06", label: "Plan revision requested", kernelPhase: "PLAN_REVISION_REQUESTED", presentation: "canonical" },
  { id: "S07", label: "Plan confirmed", kernelPhase: "PLAN_CONFIRMED", presentation: "canonical" },
  { id: "S08", label: "Step claimed", kernelPhase: "STEP_CLAIMED", presentation: "canonical" },
  { id: "S09", label: "Verification in progress", kernelPhase: "CANDIDATE_SUBMITTED", presentation: "synthetic-test-only-transient" },
  { id: "S10", label: "Verification failed", kernelPhase: "VERIFICATION_FAILED", presentation: "canonical" },
  { id: "S11", label: "Corrected candidate submitted", kernelPhase: "CANDIDATE_SUBMITTED", presentation: "canonical" },
  { id: "S12", label: "Verification passed, not accepted", kernelPhase: "VERIFICATION_PASSED", presentation: "canonical" },
  { id: "S13", label: "Completion requested", kernelPhase: "COMPLETION_REQUESTED", presentation: "canonical" },
  { id: "S14", label: "Goal accepted", kernelPhase: "GOAL_ACCEPTED", presentation: "canonical" },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  kernelPhase: GoalRoomState["phase"];
  presentation: "canonical" | "synthetic-test-only-transient";
}>;

export type V3StoryId = typeof V3_STORY_CATALOG[number]["id"];
export type V3QualificationStory = {
  id: V3StoryId;
  label: string;
  kernelPhase: GoalRoomState["phase"];
  presentation: "canonical" | "synthetic-test-only-transient";
  state: GoalRoomState;
  receipts: Receipt[];
  stateDigest: string;
};

type RegisteredTool = {
  name: string;
  execute(input: unknown): Promise<Record<string, unknown>>;
};

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function digestState(state: GoalRoomState) {
  return sha256Text(JSON.stringify(state));
}

export async function buildV3QualificationReplay(options: { hostile?: boolean } = {}) {
  const input = { ownerIntent: null } as const;
  const room = createGoalRoom(input);
  const owner = createOwnerDecisionController({ room, render: () => undefined });
  const registered: RegisteredTool[] = [];
  const installation = installGoalRoomTools({
    documentLike: { modelContext: { registerTool: (tool) => registered.push(tool as RegisteredTool) } },
    navigatorLike: {},
    room,
  });
  const stories: V3QualificationStory[] = [];
  const catalog = new Map(V3_STORY_CATALOG.map((entry) => [entry.id, entry]));
  const snap = async (id: V3StoryId) => {
    const definition = catalog.get(id)!;
    const state = room.getState();
    if (state.phase !== definition.kernelPhase) throw new Error(`V3_STORY_PHASE_MISMATCH:${id}:${state.phase}`);
    stories.push({
      ...definition,
      state,
      receipts: room.getReceipts(),
      stateDigest: await digestState(state),
    });
  };
  const invoke = async (name: string, inputValue: unknown) => {
    const tool = registered.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`V3_TOOL_NOT_REGISTERED:${name}`);
    const result = await tool.execute(inputValue);
    if (result.accepted !== true) throw new Error(`V3_TOOL_REFUSED:${name}:${String(result.reasonCode)}`);
    return result;
  };

  const hostileRun = options.hostile ? ` ${V3_HOSTILE_MARKERS.join(" | ")} ${"W".repeat(128)} 你好 🧭` : "";
  await owner.setOwnerIntent(`Publish one governed, verified Goal Room release.${hostileRun}`);
  await snap("S01");

  const goalBase = {
    why: `Make custody and owner authority inspectable.${options.hostile ? ` ${V3_HOSTILE_MARKERS[1]}` : ""}`,
    doneLooksLike: [
      "The exact corrected candidate receives deterministic PASS",
      "PASS remains distinct from final owner acceptance",
      options.hostile ? `Hostile text remains literal: ${V3_HOSTILE_MARKERS[2]}` : "Owner acceptance remains a separate final decision",
    ],
    constraints: [
      "No deployment, publishing, payment, or messaging effects",
      options.hostile ? `Wrap long content ${"Z".repeat(210)}` : "Preserve exact candidate and receipt bindings",
    ],
    nonGoals: ["No autonomous owner decisions"],
    evidenceRequired: ["Append-only receipts and exact candidate digest"],
    openQuestions: ["How is failed candidate history retained?"],
  };
  await invoke("propose_goal_contract", {
    expectedStateVersion: 1,
    idempotencyKey: "v3-goal-v1",
    goal: `Qualify the governed editorial Goal Room${options.hostile ? ` ${V3_HOSTILE_MARKERS[0]}` : ""}`,
    ...goalBase,
  });
  await snap("S02");
  await owner.requestGoalRevision(`Retain the failed candidate and make PASS boundaries visible.${options.hostile ? ` ${V3_HOSTILE_MARKERS[3]}` : ""}`);
  await snap("S03");
  await invoke("propose_goal_contract", {
    expectedStateVersion: 3,
    idempotencyKey: "v3-goal-v2",
    goal: "Qualify the governed editorial Goal Room with immutable evidence",
    ...goalBase,
    openQuestions: [],
  });
  await owner.confirmGoalContract();
  await snap("S04");

  const stepsV1 = [
    { id: "release", title: `Prepare the exact candidate${options.hostile ? ` ${V3_HOSTILE_MARKERS[1]}` : ""}` },
    { id: "verify", title: "Run deterministic verification" },
    { id: "present", title: "Present exact evidence for owner acceptance" },
  ];
  await invoke("propose_plan", {
    expectedStateVersion: 5,
    idempotencyKey: "v3-plan-v1",
    goalContractVersion: 2,
    steps: stepsV1,
  });
  await snap("S05");
  await owner.requestRevision(`Separate verification from acceptance.${options.hostile ? ` ${V3_HOSTILE_MARKERS[2]}` : ""}`);
  await snap("S06");
  const stepsV2 = [
    { id: "release", title: "Prepare the exact corrected candidate" },
    { id: "verify", title: "Run deterministic verification without accepting" },
    { id: "present", title: "Present digest-bound proof to the owner" },
  ];
  await invoke("propose_plan", {
    expectedStateVersion: 7,
    idempotencyKey: "v3-plan-v2",
    goalContractVersion: 2,
    steps: stepsV2,
  });
  await owner.confirmPlan();
  await snap("S07");
  await invoke("claim_step", {
    expectedStateVersion: 9,
    idempotencyKey: "v3-claim-release",
    planVersion: 2,
    stepId: "release",
  });
  await snap("S08");

  const failedContent = JSON.stringify({
    publicUrl: "http://v3.invalid",
    demoDurationSeconds: 181,
    verificationCommand: "npm run build",
  });
  const failedSha = await sha256Text(failedContent);
  await invoke("submit_artifact", {
    expectedStateVersion: 10,
    idempotencyKey: "v3-candidate-v1",
    planVersion: 2,
    stepId: "release",
    content: failedContent,
    sha256: failedSha,
  });
  // S09 adds presentation metadata only. Its state and receipts are real kernel output.
  await snap("S09");
  await room.verifyActiveCandidate("v3-system-verify-v1");
  await snap("S10");

  const passedContent = JSON.stringify({
    publicUrl: "https://v3.example.test/goal-room",
    demoDurationSeconds: 180,
    verificationCommand: "npm test",
  });
  const passedSha = await sha256Text(passedContent);
  await invoke("submit_artifact", {
    expectedStateVersion: 12,
    idempotencyKey: "v3-candidate-v2",
    planVersion: 2,
    stepId: "release",
    content: passedContent,
    sha256: passedSha,
  });
  await snap("S11");
  await room.verifyActiveCandidate("v3-system-verify-v2");
  await snap("S12");
  await invoke("request_completion", {
    expectedStateVersion: 14,
    idempotencyKey: "v3-completion",
    candidateSha256: passedSha,
  });
  await snap("S13");
  await owner.acceptGoal();
  await snap("S14");

  const finalState = room.getState();
  const finalReceipts = room.getReceipts();
  const replayedState = await replayGoalRoom(input, finalReceipts);
  if (JSON.stringify(replayedState) !== JSON.stringify(finalState)) throw new Error("V3_REPLAY_DIVERGED");

  return {
    source: "real-kernel-replay" as const,
    installationStatus: installation.status,
    registrationOrder: registered.map(({ name }) => name),
    stories,
    finalState,
    finalReceipts,
    finalReceiptHash: finalReceipts.at(-1)?.hash ?? "GENESIS",
    replayedState,
  };
}

export async function getV3QualificationStory(id: V3StoryId, options: { hostile?: boolean } = {}) {
  const replay = await buildV3QualificationReplay(options);
  const story = replay.stories.find((candidate) => candidate.id === id);
  if (!story) throw new Error(`UNKNOWN_V3_STORY:${id}`);
  return { replay, story };
}
