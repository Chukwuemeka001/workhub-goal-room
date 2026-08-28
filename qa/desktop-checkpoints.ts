import { createGoalRoom, type GoalRoomState, type Receipt } from "../src/core/goalRoom";

export type DesktopCheckpoint = { state: GoalRoomState; receipts: Receipt[] };

export const hostile = "<img src=x onerror=alert(1)>";
export const failContent = JSON.stringify({ publicUrl: "http://bad.test", demoDurationSeconds: 181, verificationCommand: "npm run build" });
export const passContent = JSON.stringify({ publicUrl: "https://example.test/goal-room", demoDurationSeconds: 180, verificationCommand: "npm test" });
const knownDigests = new Map([
  [failContent, "7bb1bb5f50b22429cc8c361f5b53de0458b317ebced5d0fc5869bf5ae3439169"],
  [passContent, "7bb959aebadc1b0d557990440771bda517f53dfeca69b78f651650c941ffdf27"],
]);
export const digest = (text: string) => {
  const value = knownDigests.get(text);
  if (!value) throw new Error("UNKNOWN_QA_CANDIDATE");
  return value;
};

export async function createDesktopCheckpoints(ownerIntent = "Build a governed desktop Mission Room.") {
  const room = createGoalRoom({ ownerIntent: null });
  const out = new Map<string, DesktopCheckpoint>();
  const snap = (name: string) => out.set(name, { state: room.getState(), receipts: room.getReceipts() });
  snap("empty");
  await room.dispatch({ type: "SET_OWNER_INTENT", actor: "owner", expectedStateVersion: 0, idempotencyKey: "intent", intent: ownerIntent });
  snap("captured");
  const goal = { goal: `Publish a verified entry ${hostile}`, why: "Prove governed human–agent work", doneLooksLike: ["Public app works", "Deterministic verification passes", "Owner accepts exact evidence"], constraints: ["Demo remains under 180 seconds"], nonGoals: ["No invented conversation"], evidenceRequired: ["Exact candidate digest receives PASS"], openQuestions: [] };
  await room.dispatch({ type: "PROPOSE_GOAL_CONTRACT", actor: "agent", expectedStateVersion: 1, idempotencyKey: "goal-1", ...goal });
  snap("goal");
  await room.dispatch({ type: "REQUEST_GOAL_REVISION", actor: "owner", expectedStateVersion: 2, idempotencyKey: "goal-revise", goalContractVersion: 1, note: `Keep ${hostile} literal and make proof judge-visible.` });
  snap("goal-revision");
  await room.dispatch({ type: "PROPOSE_GOAL_CONTRACT", actor: "agent", expectedStateVersion: 3, idempotencyKey: "goal-2", ...goal, goal: "Publish the corrected verified entry" });
  await room.dispatch({ type: "CONFIRM_GOAL_CONTRACT", actor: "owner", expectedStateVersion: 4, idempotencyKey: "goal-confirm", goalContractVersion: 2 });
  snap("goal-confirmed");
  const steps = [
    { id: "release", title: `Prepare and ship the exact release ${hostile}` },
    { id: "verify", title: "Run deterministic release verification" },
    { id: "evidence", title: "Present exact proof for owner acceptance" },
  ];
  await room.dispatch({ type: "PROPOSE_PLAN", actor: "agent", expectedStateVersion: 5, idempotencyKey: "plan-1", goalContractVersion: 2, steps });
  snap("plan");
  await room.dispatch({ type: "REQUEST_PLAN_REVISION", actor: "owner", expectedStateVersion: 6, idempotencyKey: "plan-revise", planVersion: 1, note: "Separate verification from final owner acceptance." });
  snap("plan-revision");
  await room.dispatch({ type: "PROPOSE_PLAN", actor: "agent", expectedStateVersion: 7, idempotencyKey: "plan-2", goalContractVersion: 2, steps });
  await room.dispatch({ type: "CONFIRM_PLAN", actor: "owner", expectedStateVersion: 8, idempotencyKey: "plan-confirm", planVersion: 2 });
  snap("plan-confirmed");
  await room.dispatch({ type: "CLAIM_STEP", actor: "agent", expectedStateVersion: 9, idempotencyKey: "claim", planVersion: 2, stepId: "release" });
  snap("claimed");
  await room.dispatch({ type: "SUBMIT_CANDIDATE", actor: "agent", expectedStateVersion: 10, idempotencyKey: "candidate-1", planVersion: 2, stepId: "release", content: failContent, sha256: digest(failContent) });
  snap("candidate");
  await room.verifyActiveCandidate("verify-1");
  snap("fail");
  await room.dispatch({ type: "SUBMIT_CANDIDATE", actor: "agent", expectedStateVersion: 12, idempotencyKey: "candidate-2", planVersion: 2, stepId: "release", content: passContent, sha256: digest(passContent) });
  await room.verifyActiveCandidate("verify-2");
  snap("pass");
  await room.dispatch({ type: "REQUEST_COMPLETION", actor: "agent", expectedStateVersion: 14, idempotencyKey: "completion", candidateSha256: digest(passContent) });
  snap("completion");
  await room.dispatch({ type: "ACCEPT_GOAL", actor: "owner", expectedStateVersion: 15, idempotencyKey: "accept", candidateSha256: digest(passContent) });
  snap("accepted");
  return out;
}
