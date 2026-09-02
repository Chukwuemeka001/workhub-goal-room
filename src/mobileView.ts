import type { GoalRoomState, Receipt } from "./core/goalRoom";
import type { OwnerViewModel } from "./ownerView";
import { createReceiptLabels } from "./ownerUi";
import { createCustodyView, type CustodyView } from "./custodyView";
import { RELEASE_V2_PASSED_CHECKS } from "./verifier/releaseRules";

export type MobileTabId = "now" | "plan" | "proof" | "activity";
export type MobileActionKind =
  | "set-intent"
  | "revise-intent"
  | "confirm-goal"
  | "confirm-plan"
  | "accept-goal"
  | "waiting"
  | "terminal";

export type MobileView = {
  chapter: "Intent" | "Goal" | "Plan" | "Work" | "Proof" | "Acceptance" | "Accepted";
  status: string;
  goal: {
    title: string;
    version: number | null;
    status: "NOT_ADMITTED" | "PROPOSED" | "REVISION_REQUESTED" | "CONFIRMED";
    origin: string;
    doneLooksLike: string[];
    constraints: string[];
    nonGoals: string[];
  };
  frontier: { actor: "agent" | "owner" | "system" | "none"; text: string; liveText: string; boundary: string };
  ownerAttention: boolean;
  custody: CustodyView;
  actionDock: {
    kind: MobileActionKind;
    primaryLabel: string | null;
    secondaryKind: "request-goal-revision" | "request-plan-revision" | null;
    secondaryLabel: string | null;
    waitingText: string;
  };
  tabs: { id: MobileTabId; label: string; panelHeading: string }[];
  plan: {
    version: number | null;
    goalContractVersion: number | null;
    status: string;
    steps: { id: string; title: string }[];
    revisionDelta?: string;
  };
  proof: {
    candidateVersion: number | null;
    digest: string | null;
    checks: string[];
    findings: string[];
    verdict: "PASS" | "FAIL" | "WAITING";
    passIsNotAcceptance: boolean;
    completionCandidateDigest: string | null;
    acceptedCandidateDigest: string | null;
    history: { version: number; digest: string; verdict: "PASS" | "FAIL" | "WAITING" }[];
  };
  activity: {
    origin: OwnerViewModel["goalContract"]["history"];
    receipts: { sequence: number; accepted: boolean; label: string; source: "Owner" | "WebMCP agent" | "Internal verifier" }[];
  };
};

const chapterByPhase: Record<GoalRoomState["phase"], MobileView["chapter"]> = {
  INTENT_DRAFT: "Intent",
  GOAL_CONTRACT_PROPOSED: "Goal",
  GOAL_CONTRACT_REVISION_REQUESTED: "Goal",
  GOAL_CONTRACT_CONFIRMED: "Plan",
  DRAFT: "Plan",
  PLAN_PROPOSED: "Plan",
  PLAN_REVISION_REQUESTED: "Plan",
  PLAN_CONFIRMED: "Work",
  STEP_CLAIMED: "Work",
  CANDIDATE_SUBMITTED: "Proof",
  VERIFICATION_FAILED: "Proof",
  VERIFICATION_PASSED: "Proof",
  COMPLETION_REQUESTED: "Acceptance",
  GOAL_ACCEPTED: "Accepted",
};

const tabs: MobileView["tabs"] = [
  { id: "now", label: "Now", panelHeading: "Current frontier" },
  { id: "plan", label: "Plan", panelHeading: "Goal and Plan" },
  { id: "proof", label: "Proof", panelHeading: "Evidence and verification" },
  { id: "activity", label: "Activity", panelHeading: "Origin, decisions, and receipts" },
];

function actionDock(state: GoalRoomState, view: OwnerViewModel): MobileView["actionDock"] {
  const waiting = {
    primaryLabel: null,
    secondaryKind: null,
    secondaryLabel: null,
    waitingText: view.ownerAttention.body,
  } as const;
  if (state.phase === "INTENT_DRAFT") {
    return {
      ...waiting,
      kind: state.ownerIntent === null ? "set-intent" : "revise-intent",
      primaryLabel: state.ownerIntent === null ? "Set owner intent" : "Revise owner intent",
    };
  }
  if (state.phase === "GOAL_CONTRACT_PROPOSED") {
    return {
      kind: "confirm-goal",
      primaryLabel: view.actions.confirm.label,
      secondaryKind: "request-goal-revision",
      secondaryLabel: view.actions.revise.label,
      waitingText: view.ownerAttention.body,
    };
  }
  if (state.phase === "PLAN_PROPOSED") {
    return {
      kind: "confirm-plan",
      primaryLabel: view.actions.confirm.label,
      secondaryKind: "request-plan-revision",
      secondaryLabel: view.actions.revise.label,
      waitingText: view.ownerAttention.body,
    };
  }
  if (state.phase === "COMPLETION_REQUESTED" && view.actions.acceptGoal.visible) {
    return { ...waiting, kind: "accept-goal", primaryLabel: view.actions.acceptGoal.label };
  }
  if (state.phase === "GOAL_ACCEPTED") return { ...waiting, kind: "terminal" };
  return { ...waiting, kind: "waiting" };
}

function receiptSource(receipt: Receipt): "Owner" | "WebMCP agent" | "Internal verifier" {
  if (receipt.command.actor === "owner") return "Owner";
  if (receipt.command.actor === "system") return "Internal verifier";
  return "WebMCP agent";
}

function goalOrigin(state: GoalRoomState): string {
  if (!state.activeGoalContract) return "Owner intent · context only";
  if (state.activeGoalContract.status === "PROPOSED") return "Agent proposal awaiting Owner";
  if (state.activeGoalContract.status === "REVISION_REQUESTED") return "Owner revision request on immutable Agent proposal";
  return "Agent proposal confirmed by Owner";
}

export function createMobileView(
  state: GoalRoomState,
  view: OwnerViewModel,
  receipts: Receipt[],
): MobileView {
  const activeGoal = state.activeGoalContract;
  const goalStatus = activeGoal?.status ?? "NOT_ADMITTED";
  const priorRevision = [...state.planHistory]
    .reverse()
    .find((plan) => plan.revisionRequest)?.revisionRequest?.note;
  const labels = createReceiptLabels(receipts);
  const verification = state.activeVerification;
  const verificationByDigest = new Map(state.verificationHistory.map((record) => [record.candidateSha256, record.verdict]));
  const custody = createCustodyView(state, receipts);
  const checks = custody.releaseCustody ? [...RELEASE_V2_PASSED_CHECKS] : [];

  return {
    chapter: chapterByPhase[state.phase],
    status: view.statusLabel,
    goal: {
      title: activeGoal?.goal ?? state.ownerIntent ?? "Goal not yet admitted",
      version: activeGoal?.version ?? null,
      status: goalStatus,
      origin: goalOrigin(state),
      doneLooksLike: activeGoal ? [...activeGoal.doneLooksLike] : [],
      constraints: activeGoal ? [...activeGoal.constraints] : [],
      nonGoals: activeGoal ? [...activeGoal.nonGoals] : [],
    },
    frontier: {
      actor: custody.currentActor ?? "none",
      text: view.nextLegalAction.label,
      liveText: custody.currentActor === null
        ? `Room sealed: ${view.nextLegalAction.label}`
        : `${custody.currentActor}: ${view.nextLegalAction.label}`,
      boundary: view.ownerAttention.body,
    },
    ownerAttention: view.ownerAttention.required,
    custody,
    actionDock: actionDock(state, view),
    tabs: tabs.map((tab) => ({ ...tab })),
    plan: {
      version: state.activePlan?.version ?? null,
      goalContractVersion: state.activePlan?.goalContractVersion ?? null,
      status: state.activePlan?.status ?? "NOT PROPOSED",
      steps: state.activePlan?.steps.map((step) => ({ ...step })) ?? [],
      ...(priorRevision ? { revisionDelta: priorRevision } : {}),
    },
    proof: {
      candidateVersion: state.activeCandidate?.version ?? null,
      digest: state.activeCandidate?.sha256 ?? null,
      checks,
      findings: verification ? [...verification.findingCodes] : [],
      verdict: verification?.verdict ?? "WAITING",
      passIsNotAcceptance: verification?.verdict === "PASS" && state.goalAcceptance === null,
      completionCandidateDigest: state.activeCompletionRequest?.candidateSha256 ?? null,
      acceptedCandidateDigest: state.goalAcceptance?.candidateSha256 ?? null,
      history: state.candidateHistory.map((candidate) => ({ version: candidate.version, digest: candidate.sha256, verdict: verificationByDigest.get(candidate.sha256) ?? "WAITING" })),
    },
    activity: {
      origin: view.goalContract.history.map((event) => ({ ...event })),
      receipts: receipts.map((receipt, index) => ({
        sequence: receipt.sequence,
        accepted: receipt.accepted,
        label: labels[index],
        source: receiptSource(receipt),
      })),
    },
  };
}
