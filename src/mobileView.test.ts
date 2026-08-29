/// <reference types="node" />
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createGoalRoom, type GoalRoomState, type Receipt } from "./core/goalRoom";
import { createMobileView } from "./mobileView";
import { createOwnerViewModel } from "./ownerView";

const goal = {
  goal: "Publish a verified entry <script>alert(1)</script>",
  why: "Prove governed work",
  doneLooksLike: ["Owner accepts exact verified evidence"],
  constraints: ["Demo stays under three minutes"],
  nonGoals: ["No invented conversation"],
  evidenceRequired: ["Deterministic PASS"],
  openQuestions: [],
};
const steps = [{ id: "release", title: "Ship <img src=x onerror=alert(1)> exact release" }];
const failContent = JSON.stringify({ publicUrl: "http://bad.test", demoDurationSeconds: 181, verificationCommand: "npm run build" });
const passContent = JSON.stringify({ publicUrl: "https://example.test/goal-room", demoDurationSeconds: 180, verificationCommand: "npm test" });
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

type Snapshot = { state: GoalRoomState; receipts: Receipt[] };

async function checkpoints() {
  const room = createGoalRoom({ ownerIntent: null });
  const out = new Map<string, Snapshot>();
  const snap = (name: string) => out.set(name, { state: room.getState(), receipts: room.getReceipts() });
  snap("empty");
  await room.dispatch({ type: "SET_OWNER_INTENT", actor: "owner", expectedStateVersion: 0, idempotencyKey: "intent", intent: "I".repeat(1000) });
  snap("captured");
  await room.dispatch({ type: "PROPOSE_GOAL_CONTRACT", actor: "agent", expectedStateVersion: 1, idempotencyKey: "goal-1", ...goal });
  snap("goal-proposed");
  await room.dispatch({ type: "REQUEST_GOAL_REVISION", actor: "owner", expectedStateVersion: 2, idempotencyKey: "goal-revise", goalContractVersion: 1, note: "Keep <b>literal</b> revision note" });
  snap("goal-revision");
  await room.dispatch({ type: "PROPOSE_GOAL_CONTRACT", actor: "agent", expectedStateVersion: 3, idempotencyKey: "goal-2", ...goal, goal: "Publish the corrected verified entry" });
  await room.dispatch({ type: "CONFIRM_GOAL_CONTRACT", actor: "owner", expectedStateVersion: 4, idempotencyKey: "goal-confirm", goalContractVersion: 2 });
  snap("goal-confirmed");
  await room.dispatch({ type: "PROPOSE_PLAN", actor: "agent", expectedStateVersion: 5, idempotencyKey: "plan-1", goalContractVersion: 2, steps });
  snap("plan-proposed");
  await room.dispatch({ type: "REQUEST_PLAN_REVISION", actor: "owner", expectedStateVersion: 6, idempotencyKey: "plan-revise", planVersion: 1, note: "Preserve <em>exact</em> Plan title binding" });
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

function project(snapshot: Snapshot) {
  return createMobileView(snapshot.state, createOwnerViewModel(snapshot.state, snapshot.receipts), snapshot.receipts);
}

describe("pure mobile authority projection", () => {
  it("derives every authoritative checkpoint's chapter, actor, frontier, attention, and legal dock", async () => {
    const all = await checkpoints();
    const expected = {
      empty: ["Intent", "owner", "Owner must set initial intent", true, "set-intent"],
      captured: ["Intent", "agent", "Agent must propose Goal Contract v1", false, "revise-intent"],
      "goal-proposed": ["Goal", "owner", "Owner must confirm or request Goal revision", true, "confirm-goal"],
      "goal-revision": ["Goal", "agent", "Agent must propose Goal Contract v2", false, "waiting"],
      "goal-confirmed": ["Plan", "agent", "Agent must propose Plan v1", false, "waiting"],
      "plan-proposed": ["Plan", "owner", "Owner must confirm or request revision", true, "confirm-plan"],
      "plan-revision": ["Plan", "agent", "Agent must propose revised Plan v2", false, "waiting"],
      "plan-confirmed": ["Work", "agent", "Agent may claim the next admitted step", false, "waiting"],
      claimed: ["Work", "agent", "Agent must submit exact candidate evidence", false, "waiting"],
      candidate: ["Proof", "system", "System must verify this exact candidate", false, "waiting"],
      fail: ["Proof", "agent", "Agent must submit a corrected candidate", false, "waiting"],
      pass: ["Proof", "agent", "Agent may request completion for this exact candidate", false, "waiting"],
      completion: ["Acceptance", "owner", "Owner may accept this exact verified candidate", true, "accept-goal"],
      accepted: ["Accepted", "none", "No further governed action", false, "terminal"],
    } as const;
    for (const [name, tuple] of Object.entries(expected)) {
      const view = project(all.get(name)!);
      expect([view.chapter, view.frontier.actor, view.frontier.text, view.ownerAttention, view.actionDock.kind], name).toEqual(tuple);
    }
  });

  it("projects exact Goal, Plan, proof, and activity bindings without inventing conversation", async () => {
    const all = await checkpoints();
    expect(project(all.get("goal-proposed")!).goal.origin).toBe("Agent proposal awaiting Owner");
    expect(project(all.get("goal-revision")!).goal.origin).toBe("Owner revision request on immutable Agent proposal");
    const completion = project(all.get("completion")!);
    expect(completion.goal).toMatchObject({ title: "Publish the corrected verified entry", version: 2, status: "CONFIRMED", origin: "Agent proposal confirmed by Owner" });
    expect(completion.plan).toMatchObject({ version: 2, goalContractVersion: 2, status: "CONFIRMED", steps });
    expect(completion.proof).toMatchObject({ candidateVersion: 2, digest: digest(passContent), verdict: "PASS", passIsNotAcceptance: true, completionCandidateDigest: digest(passContent) });
    expect(completion.activity.origin.map((event) => event.kind)).toEqual(["OWNER_INTENT", "GOAL_PROPOSAL", "GOAL_REVISION_REQUEST", "GOAL_PROPOSAL", "GOAL_CONFIRMATION"]);
    expect(completion.activity.receipts).toHaveLength(all.get("completion")!.receipts.length);
    expect(completion.activity.receipts.at(-1)).toMatchObject({ accepted: true, source: "WebMCP agent", label: expect.stringContaining("requested owner acceptance") });
    expect(completion.activity).not.toHaveProperty("conversation");

    const fail = project(all.get("fail")!);
    expect(fail.proof.findings).toEqual([
      "DEMO_DURATION_OUT_OF_RANGE",
      "PUBLIC_URL_MUST_BE_HTTPS",
      "VERIFICATION_COMMAND_MISMATCH",
    ]);
    expect(fail.plan.revisionDelta).toBe("Preserve <em>exact</em> Plan title binding");
  });

  it("defines stable accessible tab semantics independent of authority", async () => {
    const all = await checkpoints();
    for (const snapshot of all.values()) {
      const view = project(snapshot);
      expect(view.tabs).toEqual([
        { id: "now", label: "Now", panelHeading: "Current frontier" },
        { id: "plan", label: "Plan", panelHeading: "Goal and Plan" },
        { id: "proof", label: "Proof", panelHeading: "Evidence and verification" },
        { id: "activity", label: "Activity", panelHeading: "Origin, decisions, and receipts" },
      ]);
    }
  });

  it("compresses canonical custody into the frontier and preserves failed candidate history", async () => {
    const all = await checkpoints();
    const passed = project(all.get("pass")!);
    expect(passed.custody).toMatchObject({ phase: "VERIFICATION_PASSED", currentActor: "agent", ownerAttention: false });
    expect(passed.proof.history).toEqual([
      expect.objectContaining({ version: 1, verdict: "FAIL" }),
      expect.objectContaining({ version: 2, verdict: "PASS" }),
    ]);
  });
});
