import { getGoalRoomFrontier, type Actor, type GoalRoomState, type Receipt } from "./core/goalRoom";

export type CustodyLane = {
  actor: Actor;
  label: "Agent" | "System Verifier" | "Owner";
  qualifier: string;
  current: boolean;
  status: "active" | "idle" | "complete" | "failed" | "sealed";
};

export type CustodyView = {
  phase: GoalRoomState["phase"];
  stateVersion: number;
  chapter: "Define" | "Plan" | "Work" | "Verify" | "Accept";
  currentActor: Actor | null;
  legalNextAction: string;
  ownerAttention: boolean;
  candidate: null | {
    version: number;
    digest: string;
    compactDigest: string;
    completionBound: boolean;
    acceptanceBound: boolean;
  };
  verification: null | {
    verdict: "PASS" | "FAIL";
    ruleSet: string;
    findingCodes: string[];
  };
  receiptCount: number;
  terminal: boolean;
  sealed: boolean;
  lanes: CustodyLane[];
};

const chapterByPhase: Record<GoalRoomState["phase"], CustodyView["chapter"]> = {
  INTENT_DRAFT: "Define",
  GOAL_CONTRACT_PROPOSED: "Define",
  GOAL_CONTRACT_REVISION_REQUESTED: "Define",
  GOAL_CONTRACT_CONFIRMED: "Plan",
  DRAFT: "Plan",
  PLAN_PROPOSED: "Plan",
  PLAN_REVISION_REQUESTED: "Plan",
  PLAN_CONFIRMED: "Work",
  STEP_CLAIMED: "Work",
  CANDIDATE_SUBMITTED: "Verify",
  VERIFICATION_FAILED: "Verify",
  VERIFICATION_PASSED: "Verify",
  COMPLETION_REQUESTED: "Accept",
  GOAL_ACCEPTED: "Accept",
};

function actorFor(action: string, state: GoalRoomState): Actor | null {
  if (action.startsWith("OWNER_")) return "owner";
  if (action.startsWith("SYSTEM_")) return "system";
  if (action.startsWith("AGENT_")) return "agent";
  return state.phase === "GOAL_ACCEPTED" ? null : "agent";
}

export function createCustodyView(state: GoalRoomState, receipts: Receipt[]): CustodyView {
  const frontier = getGoalRoomFrontier(state);
  const terminal = state.phase === "GOAL_ACCEPTED";
  const currentActor = actorFor(frontier.nextLegalAction, state);
  const completionDigest = state.activeCompletionRequest?.candidateSha256 ?? null;
  const acceptanceDigest = state.goalAcceptance?.candidateSha256 ?? null;
  const candidate = state.activeCandidate;
  const verification = state.activeVerification;
  const definitions: Array<Pick<CustodyLane, "actor" | "label" | "qualifier">> = [
    { actor: "agent", label: "Agent", qualifier: "bounded static-six tools" },
    { actor: "system", label: "System Verifier", qualifier: "deterministic rules only" },
    { actor: "owner", label: "Owner", qualifier: "sole decision authority" },
  ];
  const lanes = definitions.map<CustodyLane>((lane) => {
    const current = !terminal && lane.actor === currentActor;
    let status: CustodyLane["status"] = current ? "active" : "idle";
    if (terminal) status = "sealed";
    else if (lane.actor === "system" && verification?.verdict === "FAIL") status = "failed";
    else if (lane.actor === "system" && verification?.verdict === "PASS") status = "complete";
    return { ...lane, current, status };
  });

  return {
    phase: state.phase,
    stateVersion: state.stateVersion,
    chapter: chapterByPhase[state.phase],
    currentActor,
    legalNextAction: frontier.nextLegalAction,
    ownerAttention: frontier.ownerRequired,
    candidate: candidate ? {
      version: candidate.version,
      digest: candidate.sha256,
      compactDigest: `${candidate.sha256.slice(0, 10)}…${candidate.sha256.slice(-8)}`,
      completionBound: completionDigest === candidate.sha256,
      acceptanceBound: acceptanceDigest === candidate.sha256,
    } : null,
    verification: verification ? {
      verdict: verification.verdict,
      ruleSet: `${verification.ruleSetId}/v${verification.ruleSetVersion}`,
      findingCodes: [...verification.findingCodes],
    } : null,
    receiptCount: receipts.length,
    terminal,
    sealed: terminal,
    lanes,
  };
}
