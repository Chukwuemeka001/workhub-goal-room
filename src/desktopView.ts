import type { GoalRoomState, Receipt } from "./core/goalRoom";
import type { OwnerViewModel } from "./ownerView";
import { createReceiptLabels } from "./ownerUi";
import { createCustodyView, type CustodyView } from "./custodyView";
import { createToolSurfaceView, type ToolSurfaceView } from "./toolSurfaceView";

export type DesktopTabId = "goal" | "plan" | "proof" | "activity";
export type DesktopOwnerActionKind = "set-intent" | "revise-intent" | "confirm-goal" | "confirm-plan" | "accept-goal" | "waiting" | "terminal";

type InspectorGroup = { heading: string; values: string[] };
type ReceiptSummary = { sequence: number; accepted: boolean; label: string; source: "Owner" | "WebMCP agent" | "Internal verifier" };

export type DesktopView = {
  goal: { title: string; version: number | null; status: "NOT_ADMITTED" | "PROPOSED" | "REVISION_REQUESTED" | "CONFIRMED"; origin: string };
  status: string;
  chapter: {
    label: "Define" | "Plan" | "Work" | "Verify" | "Accept";
    currentNode: "intent" | "goal" | "plan" | "work" | "verify" | "accept" | "accepted";
    nodes: { id: "define" | "plan" | "work" | "verify" | "accept"; label: string; status: "complete" | "current" | "pending" | "failed" }[];
  };
  now: { actor: "agent" | "owner" | "system" | "none"; title: string; legalAction: string; boundary: string; ownerAttention: boolean; compactDigest: string | null };
  custody: CustodyView;
  toolSurface: ToolSurfaceView;
  ownerAction: { kind: DesktopOwnerActionKind; visible: boolean; label: string | null; secondaryKind: "request-goal-revision" | "request-plan-revision" | null; secondaryLabel: string | null; waitingText: string };
  tabs: { id: DesktopTabId; label: string; panelHeading: string }[];
  inspectors: {
    goal: { title: string; meta: string; groups: InspectorGroup[]; revisionDelta: string | null };
    plan: { title: string; status: string; binding: string; steps: { id: string; title: string }[]; revisionDelta: string | null };
    proof: { title: string; verdict: "PASS" | "FAIL" | "WAITING"; digest: string | null; ruleSet: string | null; checks: string[]; findings: string[]; passIsNotAcceptance: boolean; completionBinding: string | null; acceptanceBinding: string | null; history: { version: number; digest: string; verdict: "PASS" | "FAIL" | "WAITING" }[] };
    activity: { title: string; origin: OwnerViewModel["goalContract"]["history"]; receipts: ReceiptSummary[] };
  };
  lifecycle: OwnerViewModel["lifecycle"];
  receipts: { count: number; latest: ReceiptSummary[] };
};

const tabs: DesktopView["tabs"] = [
  { id: "goal", label: "Goal", panelHeading: "Goal Contract" },
  { id: "plan", label: "Plan", panelHeading: "Admitted Plan" },
  { id: "proof", label: "Proof", panelHeading: "Evidence and verification" },
  { id: "activity", label: "Activity", panelHeading: "Origin, decisions, and receipts" },
];

const chapterByPhase: Record<GoalRoomState["phase"], DesktopView["chapter"]["label"]> = {
  INTENT_DRAFT: "Define", GOAL_CONTRACT_PROPOSED: "Define", GOAL_CONTRACT_REVISION_REQUESTED: "Define",
  GOAL_CONTRACT_CONFIRMED: "Plan", DRAFT: "Plan", PLAN_PROPOSED: "Plan", PLAN_REVISION_REQUESTED: "Plan",
  PLAN_CONFIRMED: "Work", STEP_CLAIMED: "Work", CANDIDATE_SUBMITTED: "Verify", VERIFICATION_FAILED: "Verify",
  VERIFICATION_PASSED: "Verify", COMPLETION_REQUESTED: "Accept", GOAL_ACCEPTED: "Accept",
};

function currentNode(state: GoalRoomState): DesktopView["chapter"]["currentNode"] {
  if (state.phase === "INTENT_DRAFT") return state.ownerIntent === null ? "intent" : "goal";
  if (["GOAL_CONTRACT_PROPOSED", "GOAL_CONTRACT_REVISION_REQUESTED"].includes(state.phase)) return "goal";
  if (["GOAL_CONTRACT_CONFIRMED", "DRAFT", "PLAN_PROPOSED", "PLAN_REVISION_REQUESTED"].includes(state.phase)) return "plan";
  if (["PLAN_CONFIRMED", "STEP_CLAIMED", "VERIFICATION_FAILED"].includes(state.phase)) return "work";
  if (state.phase === "CANDIDATE_SUBMITTED") return "verify";
  if (["VERIFICATION_PASSED", "COMPLETION_REQUESTED"].includes(state.phase)) return "accept";
  return "accepted";
}

function chapterNodes(state: GoalRoomState): DesktopView["chapter"]["nodes"] {
  const ids = ["define", "plan", "work", "verify", "accept"] as const;
  const labels = ["Define", "Plan", "Work", "Verify", "Accept"];
  const active = labels.indexOf(chapterByPhase[state.phase]);
  return ids.map((id, index) => ({
    id, label: labels[index],
    status: state.phase === "GOAL_ACCEPTED" ? "complete" : state.phase === "VERIFICATION_FAILED" && id === "verify" ? "failed" : index < active ? "complete" : index === active ? "current" : "pending",
  }));
}

function origin(state: GoalRoomState) {
  if (!state.activeGoalContract) return "Owner intent · context only";
  if (state.activeGoalContract.status === "PROPOSED") return "Agent proposal awaiting Owner";
  if (state.activeGoalContract.status === "REVISION_REQUESTED") return "Owner revision request on immutable Agent proposal";
  return "Agent proposal confirmed by Owner";
}

function source(receipt: Receipt): ReceiptSummary["source"] {
  if (receipt.command.actor === "owner") return "Owner";
  if (receipt.command.actor === "system") return "Internal verifier";
  return "WebMCP agent";
}

function ownerAction(state: GoalRoomState, view: OwnerViewModel): DesktopView["ownerAction"] {
  const waiting = { visible: false, label: null, secondaryKind: null, secondaryLabel: null, waitingText: view.ownerAttention.body } as const;
  if (state.phase === "INTENT_DRAFT") return { ...waiting, visible: true, kind: state.ownerIntent === null ? "set-intent" : "revise-intent", label: view.actions.setIntent.label };
  if (state.phase === "GOAL_CONTRACT_PROPOSED") return { ...waiting, visible: true, kind: "confirm-goal", label: view.actions.confirm.label, secondaryKind: "request-goal-revision", secondaryLabel: view.actions.revise.label };
  if (state.phase === "PLAN_PROPOSED") return { ...waiting, visible: true, kind: "confirm-plan", label: view.actions.confirm.label, secondaryKind: "request-plan-revision", secondaryLabel: view.actions.revise.label };
  if (state.phase === "COMPLETION_REQUESTED") return { ...waiting, visible: true, kind: "accept-goal", label: view.actions.acceptGoal.label };
  if (state.phase === "GOAL_ACCEPTED") return { ...waiting, kind: "terminal" };
  return { ...waiting, kind: "waiting" };
}

export function createDesktopView(state: GoalRoomState, view: OwnerViewModel, receipts: Receipt[]): DesktopView {
  const goal = state.activeGoalContract;
  const plan = state.activePlan;
  const verification = state.activeVerification;
  const labels = createReceiptLabels(receipts);
  const receiptSummaries = receipts.map((receipt, index) => ({ sequence: receipt.sequence, accepted: receipt.accepted, label: labels[index], source: source(receipt) }));
  const priorGoalRevision = [...state.goalContractHistory].reverse().find((entry) => entry.revisionRequest)?.revisionRequest?.note ?? null;
  const priorPlanRevision = [...state.planHistory].reverse().find((entry) => entry.revisionRequest)?.revisionRequest?.note ?? null;
  const candidateDigest = state.activeCandidate?.sha256 ?? null;
  const passedChecks = verification?.verdict === "PASS" ? ["HTTPS public URL passed", "Demo duration is within 180 seconds", "Verification command is exactly npm test"] : [];
  const verificationByDigest = new Map(state.verificationHistory.map((record) => [record.candidateSha256, record.verdict]));
  return {
    goal: { title: goal?.goal ?? state.ownerIntent ?? "Goal not yet admitted", version: goal?.version ?? null, status: goal?.status ?? "NOT_ADMITTED", origin: origin(state) },
    status: view.statusLabel,
    chapter: { label: chapterByPhase[state.phase], currentNode: currentNode(state), nodes: chapterNodes(state) },
    now: {
      actor: view.nextLegalAction.actor, title: view.ownerAttention.title, legalAction: view.nextLegalAction.label,
      boundary: view.ownerAttention.body, ownerAttention: view.ownerAttention.required,
      compactDigest: candidateDigest ? `${candidateDigest.slice(0, 10)}…${candidateDigest.slice(-8)}` : null,
    },
    custody: createCustodyView(state, receipts),
    toolSurface: createToolSurfaceView(state),
    ownerAction: ownerAction(state, view), tabs: tabs.map((tab) => ({ ...tab })),
    inspectors: {
      goal: {
        title: goal ? `Goal Contract v${goal.version}` : "Goal not admitted", meta: `${origin(state)} · ${goal?.status.replaceAll("_", " ") ?? "context only"}`,
        groups: [
          { heading: "Why", values: goal ? [goal.why] : state.ownerIntent ? [state.ownerIntent] : ["No owner intent captured"] },
          { heading: "Done looks like", values: goal ? [...goal.doneLooksLike] : [] },
          { heading: "Constraints", values: goal ? [...goal.constraints] : [] },
          { heading: "Non-goals", values: goal ? [...goal.nonGoals] : [] },
          { heading: "Evidence required", values: goal ? [...goal.evidenceRequired] : [] },
          { heading: "Open questions", values: goal ? [...goal.openQuestions] : [] },
        ], revisionDelta: priorGoalRevision,
      },
      plan: { title: plan ? `Plan v${plan.version}` : "Plan not proposed", status: plan?.status ?? "NOT PROPOSED", binding: plan ? `Goal Contract v${plan.goalContractVersion}` : "No admitted binding", steps: plan?.steps.map((step) => ({ ...step })) ?? [], revisionDelta: priorPlanRevision },
      proof: {
        title: state.activeCandidate ? `Candidate v${state.activeCandidate.version}` : "No candidate submitted", verdict: verification?.verdict ?? "WAITING",
        digest: candidateDigest, ruleSet: verification ? `${verification.ruleSetId}/v${verification.ruleSetVersion}` : null,
        checks: passedChecks, findings: verification ? [...verification.findingCodes] : [],
        passIsNotAcceptance: verification?.verdict === "PASS" && state.goalAcceptance === null,
        completionBinding: state.activeCompletionRequest?.candidateSha256 ?? null, acceptanceBinding: state.goalAcceptance?.candidateSha256 ?? null,
        history: state.candidateHistory.map((candidate) => ({ version: candidate.version, digest: candidate.sha256, verdict: verificationByDigest.get(candidate.sha256) ?? "WAITING" })),
      },
      activity: { title: "Authority activity", origin: view.goalContract.history.map((entry) => ({ ...entry })), receipts: receiptSummaries },
    },
    lifecycle: view.lifecycle.map((stage) => ({ ...stage })),
    receipts: { count: receipts.length, latest: [...receiptSummaries].reverse().slice(0, 3) },
  };
}
