import { createReleaseGuardianEnvelope } from "../src/verifier/releaseRules";
import { createGoalRoom, type GoalRoomState, type Receipt } from "../src/core/goalRoom";

export type DesktopCheckpoint = { state: GoalRoomState; receipts: Receipt[] };

export const hostile = "<img src=x onerror=alert(1)>";
export const failContent = createReleaseGuardianEnvelope({ proofManifestSha256: "a9a9aac7896a3583a0db78ec5e801e906f0872659e1bf6d36922d091b4294c60" });
export const passContent = createReleaseGuardianEnvelope();
const knownDigests = new Map([
  [failContent, "f1949fb677e0f683b2c5e8cbdc432532f0e5e9f334dc136df4526038e83f9901"],
  [passContent, "850d1b62cb4243650372ded9c3ba50926c9b304467d13e9705c03f3d2684fb15"],
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
