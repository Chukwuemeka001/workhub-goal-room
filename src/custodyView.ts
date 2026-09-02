import { getGoalRoomFrontier, type Actor, type GoalRoomState, type Receipt } from "./core/goalRoom";
import {
  RELEASE_GUARDIAN_CANONICAL_ENVELOPE_SHA256,
  RELEASE_RULE_SET_ID,
  RELEASE_RULE_SET_VERSION,
  parseReleaseGuardianEnvelope,
  verifyReleaseCandidate,
} from "./verifier/releaseRules";

/**
 * Exact release identities read back out of the already-submitted candidate
 * bytes. Never derived, never defaulted: if the submitted candidate is not an
 * exactly shaped release envelope this projection is null and the surface omits
 * release bindings entirely.
 */
export type ReleaseCustody = {
  profile: string;
  sourceBaseCommit: string;
  candidateManifestSha256: string;
  proofManifestSha256: string;
  rollbackPatchSha256: string;
  compactCandidateManifest: string;
  compactProofManifest: string;
  compactRollbackPatch: string;
};

const compact = (digest: string) =>
  digest.length > 18 ? `${digest.slice(0, 10)}…${digest.slice(-8)}` : digest;

function createReleaseCustody(state: GoalRoomState): ReleaseCustody | null {
  const candidate = state.activeCandidate;
  const verification = state.activeVerification;
  const completion = state.activeCompletionRequest;
  const accepted = state.goalAcceptance;
  if (
    candidate === null ||
    verification === null ||
    completion === null ||
    (state.phase !== "COMPLETION_REQUESTED" && state.phase !== "GOAL_ACCEPTED") ||
    candidate.sha256 !== RELEASE_GUARDIAN_CANONICAL_ENVELOPE_SHA256 ||
    verification.candidateSha256 !== candidate.sha256 ||
    verification.ruleSetId !== RELEASE_RULE_SET_ID ||
    verification.ruleSetVersion !== RELEASE_RULE_SET_VERSION ||
    verification.verdict !== "PASS" ||
    verification.findingCodes.length !== 0 ||
    completion.candidateSha256 !== candidate.sha256 ||
    (state.phase === "GOAL_ACCEPTED" && accepted?.candidateSha256 !== candidate.sha256) ||
    verifyReleaseCandidate(candidate.content).verdict !== "PASS"
  ) {
    return null;
  }
  const envelope = parseReleaseGuardianEnvelope(candidate.content);
  if (envelope === null) return null;
  return {
    profile: envelope.profile,
    sourceBaseCommit: envelope.sourceBaseCommit,
    candidateManifestSha256: envelope.candidateManifestSha256,
    proofManifestSha256: envelope.proofManifestSha256,
    rollbackPatchSha256: envelope.rollbackPatchSha256,
    compactCandidateManifest: compact(envelope.candidateManifestSha256),
    compactProofManifest: compact(envelope.proofManifestSha256),
    compactRollbackPatch: compact(envelope.rollbackPatchSha256),
  };
}

function hasAcceptedReleaseReceiptCustody(
  state: GoalRoomState,
  receipts: Receipt[],
): boolean {
  const candidate = state.activeCandidate;
  if (candidate === null) return false;
  let submissionIndex = -1;
  for (let index = receipts.length - 1; index >= 0; index -= 1) {
    const receipt = receipts[index];
    if (
      receipt.accepted &&
      receipt.command.type === "SUBMIT_CANDIDATE" &&
      receipt.command.actor === "agent" &&
      receipt.command.planVersion === candidate.planVersion &&
      receipt.command.stepId === candidate.stepId &&
      receipt.command.content === candidate.content &&
      receipt.command.sha256 === candidate.sha256
    ) {
      submissionIndex = index;
      break;
    }
  }
  const verificationIndex = receipts.findIndex((receipt, index) =>
    index > submissionIndex &&
    receipt.accepted &&
    receipt.command.type === "RECORD_VERIFICATION" &&
    receipt.command.actor === "system" &&
    receipt.command.candidateSha256 === candidate.sha256 &&
    receipt.command.ruleSetId === RELEASE_RULE_SET_ID &&
    receipt.command.ruleSetVersion === RELEASE_RULE_SET_VERSION &&
    receipt.command.verdict === "PASS" &&
    receipt.command.findingCodes.length === 0
  );
  const completionIndex = receipts.findIndex((receipt, index) =>
    index > verificationIndex &&
    receipt.accepted &&
    receipt.command.type === "REQUEST_COMPLETION" &&
    receipt.command.actor === "agent" &&
    receipt.command.candidateSha256 === candidate.sha256
  );
  if (submissionIndex < 0 || verificationIndex < 0 || completionIndex < 0) return false;
  if (state.phase !== "GOAL_ACCEPTED") return true;
  return receipts.some((receipt, index) =>
    index > completionIndex &&
    receipt.accepted &&
    receipt.command.type === "ACCEPT_GOAL" &&
    receipt.command.actor === "owner" &&
    receipt.command.candidateSha256 === candidate.sha256
  );
}

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
  releaseCustody: ReleaseCustody | null;
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
  const completionDigest = state.activeCompletionRequest?.candidateSha256 ?? null;
  const acceptanceDigest = state.goalAcceptance?.candidateSha256 ?? null;
  const candidate = state.activeCandidate;
  const verification = state.activeVerification;
  const releaseCustody = hasAcceptedReleaseReceiptCustody(state, receipts)
    ? createReleaseCustody(state)
    : null;
  const ownerReleaseBindingUnavailable =
    state.phase === "COMPLETION_REQUESTED" && releaseCustody === null;
  const currentActor = ownerReleaseBindingUnavailable
    ? null
    : actorFor(frontier.nextLegalAction, state);
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
    legalNextAction: ownerReleaseBindingUnavailable
      ? "AUTHORITATIVE_V2_RELEASE_CUSTODY_REQUIRED"
      : frontier.nextLegalAction,
    ownerAttention: ownerReleaseBindingUnavailable ? false : frontier.ownerRequired,
    candidate: candidate ? {
      version: candidate.version,
      digest: candidate.sha256,
      compactDigest: `${candidate.sha256.slice(0, 10)}…${candidate.sha256.slice(-8)}`,
      completionBound: completionDigest === candidate.sha256,
      acceptanceBound: releaseCustody !== null && acceptanceDigest === candidate.sha256,
    } : null,
    releaseCustody,
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
