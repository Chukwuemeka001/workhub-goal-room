import {
  RELEASE_RULE_SET_ID,
  RELEASE_RULE_SET_VERSION,
  verifyReleaseCandidate,
  type ReleaseFindingCode,
} from "../verifier/releaseRules";

export type Actor = "agent" | "owner" | "system";

export type PlanStep = {
  id: string;
  title: string;
};

export type PlanVersion = {
  version: number;
  status: "PROPOSED" | "REVISION_REQUESTED" | "CONFIRMED";
  proposedBy: Actor;
  steps: PlanStep[];
  revisionRequest?: {
    requestedBy: "owner";
    note: string;
  };
};

export type GoalRoomInput = {
  goal: string;
  doneLooksLike: string[];
};

export type StepClaim = {
  planVersion: number;
  stepId: string;
  claimedBy: "agent";
};

export type CandidateSubmission = {
  version: number;
  planVersion: number;
  stepId: string;
  content: string;
  sha256: string;
  submittedBy: "agent";
};

export type CompletionRequest = {
  candidateSha256: string;
  requestedBy: "agent";
};

export type GoalAcceptance = {
  candidateSha256: string;
  acceptedBy: "owner";
};

export type VerificationRecord = {
  candidateSha256: string;
  ruleSetId: typeof RELEASE_RULE_SET_ID;
  ruleSetVersion: typeof RELEASE_RULE_SET_VERSION;
  verdict: "PASS" | "FAIL";
  findingCodes: ReleaseFindingCode[];
  actor: "system";
};

export type GoalRoomState = {
  goal: string;
  doneLooksLike: string[];
  phase:
    | "DRAFT"
    | "PLAN_PROPOSED"
    | "PLAN_REVISION_REQUESTED"
    | "PLAN_CONFIRMED"
    | "STEP_CLAIMED"
    | "CANDIDATE_SUBMITTED"
    | "VERIFICATION_PASSED"
    | "VERIFICATION_FAILED"
    | "COMPLETION_REQUESTED"
    | "GOAL_ACCEPTED";
  stateVersion: number;
  activePlan: PlanVersion | null;
  planHistory: PlanVersion[];
  activeClaim: StepClaim | null;
  activeCandidate: CandidateSubmission | null;
  candidateHistory: CandidateSubmission[];
  activeVerification: VerificationRecord | null;
  verificationHistory: VerificationRecord[];
  activeCompletionRequest: CompletionRequest | null;
  goalAcceptance: GoalAcceptance | null;
};

export type ProposePlanCommand = {
  type: "PROPOSE_PLAN";
  actor: Actor;
  expectedStateVersion: number;
  idempotencyKey: string;
  steps: PlanStep[];
};

export type ConfirmPlanCommand = {
  type: "CONFIRM_PLAN";
  actor: Actor;
  expectedStateVersion: number;
  idempotencyKey: string;
  planVersion: number;
};

export type RequestPlanRevisionCommand = {
  type: "REQUEST_PLAN_REVISION";
  actor: Actor;
  expectedStateVersion: number;
  idempotencyKey: string;
  planVersion: number;
  note: string;
};

export type ClaimStepCommand = {
  type: "CLAIM_STEP";
  actor: Actor;
  expectedStateVersion: number;
  idempotencyKey: string;
  planVersion: number;
  stepId: string;
};

export type SubmitCandidateCommand = {
  type: "SUBMIT_CANDIDATE";
  actor: Actor;
  expectedStateVersion: number;
  idempotencyKey: string;
  planVersion: number;
  stepId: string;
  content: string;
  sha256: string;
};

export type RequestCompletionCommand = {
  type: "REQUEST_COMPLETION";
  actor: Actor;
  expectedStateVersion: number;
  idempotencyKey: string;
  candidateSha256: string;
};

export type AcceptGoalCommand = {
  type: "ACCEPT_GOAL";
  actor: Actor;
  expectedStateVersion: number;
  idempotencyKey: string;
  candidateSha256: string;
};

export type RecordVerificationCommand = {
  type: "RECORD_VERIFICATION";
  actor: "system";
  expectedStateVersion: number;
  idempotencyKey: string;
  candidateSha256: string;
  ruleSetId: typeof RELEASE_RULE_SET_ID;
  ruleSetVersion: typeof RELEASE_RULE_SET_VERSION;
  verdict: "PASS" | "FAIL";
  findingCodes: ReleaseFindingCode[];
};

export type Command =
  | ProposePlanCommand
  | ConfirmPlanCommand
  | RequestPlanRevisionCommand
  | ClaimStepCommand
  | SubmitCandidateCommand
  | RequestCompletionCommand
  | AcceptGoalCommand
  | RecordVerificationCommand;
export type ReasonCode =
  | "OWNER_ONLY"
  | "AGENT_ONLY"
  | "PLAN_VERSION_MISMATCH"
  | "PLAN_PROPOSAL_NOT_ALLOWED"
  | "STEP_NOT_ADMITTED"
  | "STEP_CLAIM_REQUIRED"
  | "CANDIDATE_DIGEST_MISMATCH"
  | "VERIFICATION_REQUIRED"
  | "CANDIDATE_BINDING_MISMATCH"
  | "STALE_STATE";

export type DispatchResult = {
  accepted: boolean;
  reasonCode?: ReasonCode;
  missingConditions?: string[];
  stateVersion: number;
  nextLegalAction: string;
  ownerRequired: boolean;
};

export type Receipt = {
  sequence: number;
  previousHash: string;
  hash: string;
  command: Command;
  accepted: boolean;
  reasonCode?: ReasonCode;
  missingConditions?: string[];
  stateVersion: number;
};

function initialState(input: GoalRoomInput): GoalRoomState {
  return {
    goal: input.goal,
    doneLooksLike: [...input.doneLooksLike],
    phase: "DRAFT",
    stateVersion: 0,
    activePlan: null,
    planHistory: [],
    activeClaim: null,
    activeCandidate: null,
    candidateHistory: [],
    activeVerification: null,
    verificationHistory: [],
    activeCompletionRequest: null,
    goalAcceptance: null,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(record: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

const LOWER_HEX_64 = /^[0-9a-f]{64}$/;

function validateCommand(value: unknown): asserts value is Command {
  if (!isPlainRecord(value)) throw new Error("INVALID_COMMAND");
  const commonValid =
    Number.isSafeInteger(value.expectedStateVersion) &&
    (value.expectedStateVersion as number) >= 0 &&
    typeof value.idempotencyKey === "string" &&
    value.idempotencyKey.trim().length > 0 &&
    (value.actor === "agent" || value.actor === "owner" || value.actor === "system");
  if (!commonValid) throw new Error("INVALID_COMMAND");

  if (value.type === "PROPOSE_PLAN") {
    if (
      !hasExactKeys(value, ["type", "actor", "expectedStateVersion", "idempotencyKey", "steps"]) ||
      value.actor !== "agent" ||
      !Array.isArray(value.steps) ||
      value.steps.length === 0
    ) {
      throw new Error("INVALID_COMMAND");
    }
    const ids = new Set<string>();
    for (const step of value.steps) {
      if (
        !isPlainRecord(step) ||
        !hasExactKeys(step, ["id", "title"]) ||
        typeof step.id !== "string" ||
        step.id.trim().length === 0 ||
        typeof step.title !== "string" ||
        step.title.trim().length === 0 ||
        ids.has(step.id)
      ) {
        throw new Error("INVALID_COMMAND");
      }
      ids.add(step.id);
    }
    return;
  }

  if (value.type === "REQUEST_PLAN_REVISION") {
    if (
      !hasExactKeys(value, [
        "type",
        "actor",
        "expectedStateVersion",
        "idempotencyKey",
        "planVersion",
        "note",
      ]) ||
      !Number.isSafeInteger(value.planVersion) ||
      (value.planVersion as number) < 1 ||
      typeof value.note !== "string" ||
      value.note.trim().length === 0
    ) {
      throw new Error("INVALID_COMMAND");
    }
    return;
  }

  if (value.type === "CLAIM_STEP") {
    if (
      !hasExactKeys(value, [
        "type",
        "actor",
        "expectedStateVersion",
        "idempotencyKey",
        "planVersion",
        "stepId",
      ]) ||
      !Number.isSafeInteger(value.planVersion) ||
      (value.planVersion as number) < 1 ||
      typeof value.stepId !== "string" ||
      value.stepId.trim().length === 0
    ) {
      throw new Error("INVALID_COMMAND");
    }
    return;
  }

  if (value.type === "SUBMIT_CANDIDATE") {
    if (
      !hasExactKeys(value, [
        "type",
        "actor",
        "expectedStateVersion",
        "idempotencyKey",
        "planVersion",
        "stepId",
        "content",
        "sha256",
      ]) ||
      !Number.isSafeInteger(value.planVersion) ||
      (value.planVersion as number) < 1 ||
      typeof value.stepId !== "string" ||
      value.stepId.trim().length === 0 ||
      typeof value.content !== "string" ||
      value.content.length === 0 ||
      typeof value.sha256 !== "string" ||
      !LOWER_HEX_64.test(value.sha256)
    ) {
      throw new Error("INVALID_COMMAND");
    }
    return;
  }

  if (value.type === "REQUEST_COMPLETION" || value.type === "ACCEPT_GOAL") {
    if (
      !hasExactKeys(value, [
        "type",
        "actor",
        "expectedStateVersion",
        "idempotencyKey",
        "candidateSha256",
      ]) ||
      typeof value.candidateSha256 !== "string" ||
      !LOWER_HEX_64.test(value.candidateSha256)
    ) {
      throw new Error("INVALID_COMMAND");
    }
    return;
  }

  if (value.type === "RECORD_VERIFICATION") {
    if (
      !hasExactKeys(value, [
        "type",
        "actor",
        "expectedStateVersion",
        "idempotencyKey",
        "candidateSha256",
        "ruleSetId",
        "ruleSetVersion",
        "verdict",
        "findingCodes",
      ]) ||
      value.actor !== "system" ||
      typeof value.candidateSha256 !== "string" ||
      !LOWER_HEX_64.test(value.candidateSha256) ||
      value.ruleSetId !== RELEASE_RULE_SET_ID ||
      value.ruleSetVersion !== RELEASE_RULE_SET_VERSION ||
      (value.verdict !== "PASS" && value.verdict !== "FAIL") ||
      !Array.isArray(value.findingCodes) ||
      value.findingCodes.some((code) => typeof code !== "string")
    ) {
      throw new Error("INVALID_COMMAND");
    }
    return;
  }

  if (
    value.type !== "CONFIRM_PLAN" ||
    !hasExactKeys(value, ["type", "actor", "expectedStateVersion", "idempotencyKey", "planVersion"]) ||
    !Number.isSafeInteger(value.planVersion) ||
    (value.planVersion as number) < 1
  ) {
    throw new Error("INVALID_COMMAND");
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Text(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function applyAcceptedCommand(
  state: GoalRoomState,
  command: Command,
): GoalRoomState {
  if (command.type === "PROPOSE_PLAN") {
    const plan: PlanVersion = {
      version: state.planHistory.length + 1,
      status: "PROPOSED",
      proposedBy: command.actor,
      steps: command.steps.map((step) => ({ ...step })),
    };
    return {
      ...state,
      phase: "PLAN_PROPOSED",
      stateVersion: state.stateVersion + 1,
      activePlan: plan,
      planHistory: [...state.planHistory, plan],
    };
  }

  if (command.type === "REQUEST_PLAN_REVISION") {
    if (
      command.actor !== "owner" ||
      state.activePlan?.status !== "PROPOSED" ||
      state.activePlan.version !== command.planVersion
    ) {
      throw new Error("REPLAY_AUTHORITY_MISMATCH");
    }
    const revisedPlan: PlanVersion = {
      ...state.activePlan,
      status: "REVISION_REQUESTED",
      revisionRequest: {
        requestedBy: "owner",
        note: command.note.trim(),
      },
    };
    return {
      ...state,
      phase: "PLAN_REVISION_REQUESTED",
      stateVersion: state.stateVersion + 1,
      activePlan: revisedPlan,
      planHistory: state.planHistory.map((plan) =>
        plan.version === revisedPlan.version ? revisedPlan : plan,
      ),
    };
  }

  if (command.type === "ACCEPT_GOAL") {
    if (
      command.actor !== "owner" ||
      state.phase !== "COMPLETION_REQUESTED" ||
      state.activeCompletionRequest?.candidateSha256 !== command.candidateSha256 ||
      state.activeCandidate?.sha256 !== command.candidateSha256 ||
      state.activeVerification?.candidateSha256 !== command.candidateSha256 ||
      state.activeVerification.verdict !== "PASS"
    ) {
      throw new Error("REPLAY_AUTHORITY_MISMATCH");
    }
    return {
      ...state,
      phase: "GOAL_ACCEPTED",
      stateVersion: state.stateVersion + 1,
      goalAcceptance: {
        candidateSha256: command.candidateSha256,
        acceptedBy: "owner",
      },
    };
  }

  if (command.type === "REQUEST_COMPLETION") {
    if (
      command.actor !== "agent" ||
      state.phase !== "VERIFICATION_PASSED" ||
      state.activeCandidate?.sha256 !== command.candidateSha256 ||
      state.activeVerification?.candidateSha256 !== command.candidateSha256 ||
      state.activeVerification.verdict !== "PASS"
    ) {
      throw new Error("REPLAY_AUTHORITY_MISMATCH");
    }
    return {
      ...state,
      phase: "COMPLETION_REQUESTED",
      stateVersion: state.stateVersion + 1,
      activeCompletionRequest: {
        candidateSha256: command.candidateSha256,
        requestedBy: "agent",
      },
    };
  }

  if (command.type === "RECORD_VERIFICATION") {
    if (
      command.actor !== "system" ||
      state.phase !== "CANDIDATE_SUBMITTED" ||
      state.activeCandidate?.sha256 !== command.candidateSha256
    ) {
      throw new Error("REPLAY_AUTHORITY_MISMATCH");
    }
    const verification: VerificationRecord = {
      candidateSha256: command.candidateSha256,
      ruleSetId: command.ruleSetId,
      ruleSetVersion: command.ruleSetVersion,
      verdict: command.verdict,
      findingCodes: [...command.findingCodes],
      actor: "system",
    };
    return {
      ...state,
      phase:
        command.verdict === "PASS"
          ? "VERIFICATION_PASSED"
          : "VERIFICATION_FAILED",
      stateVersion: state.stateVersion + 1,
      activeVerification: verification,
      verificationHistory: [...state.verificationHistory, verification],
    };
  }

  if (command.type === "SUBMIT_CANDIDATE") {
    if (
      command.actor !== "agent" ||
      (state.phase !== "STEP_CLAIMED" &&
        state.phase !== "VERIFICATION_FAILED") ||
      state.activeClaim?.planVersion !== command.planVersion ||
      state.activeClaim.stepId !== command.stepId
    ) {
      throw new Error("REPLAY_AUTHORITY_MISMATCH");
    }
    const candidate: CandidateSubmission = {
      version: state.candidateHistory.length + 1,
      planVersion: command.planVersion,
      stepId: command.stepId,
      content: command.content,
      sha256: command.sha256,
      submittedBy: "agent",
    };
    return {
      ...state,
      phase: "CANDIDATE_SUBMITTED",
      stateVersion: state.stateVersion + 1,
      activeCandidate: candidate,
      candidateHistory: [...state.candidateHistory, candidate],
      activeVerification: null,
    };
  }

  if (command.type === "CLAIM_STEP") {
    if (
      command.actor !== "agent" ||
      state.phase !== "PLAN_CONFIRMED" ||
      state.activePlan?.version !== command.planVersion ||
      !state.activePlan.steps.some((step) => step.id === command.stepId)
    ) {
      throw new Error("REPLAY_AUTHORITY_MISMATCH");
    }
    return {
      ...state,
      phase: "STEP_CLAIMED",
      stateVersion: state.stateVersion + 1,
      activeClaim: {
        planVersion: command.planVersion,
        stepId: command.stepId,
        claimedBy: "agent",
      },
    };
  }

  if (
    command.actor !== "owner" ||
    state.activePlan?.status !== "PROPOSED" ||
    state.activePlan.version !== command.planVersion
  ) {
    throw new Error("REPLAY_AUTHORITY_MISMATCH");
  }

  const confirmedPlan: PlanVersion = {
    ...state.activePlan,
    status: "CONFIRMED",
  };
  return {
    ...state,
    phase: "PLAN_CONFIRMED",
    stateVersion: state.stateVersion + 1,
    activePlan: confirmedPlan,
    planHistory: state.planHistory.map((plan) =>
      plan.version === confirmedPlan.version ? confirmedPlan : plan,
    ),
  };
}

function nextLegalAction(state: GoalRoomState): string {
  if (state.phase === "DRAFT") return "AGENT_PROPOSE_PLAN";
  if (state.phase === "PLAN_PROPOSED") return "OWNER_CONFIRM_OR_REVISE_PLAN";
  if (state.phase === "PLAN_REVISION_REQUESTED") return "AGENT_PROPOSE_REVISED_PLAN";
  if (state.phase === "PLAN_CONFIRMED") return "AGENT_CLAIM_OPEN_STEP";
  if (state.phase === "STEP_CLAIMED") return "AGENT_SUBMIT_CANDIDATE";
  if (state.phase === "CANDIDATE_SUBMITTED") return "SYSTEM_VERIFY_CANDIDATE";
  if (state.phase === "VERIFICATION_PASSED") return "AGENT_REQUEST_COMPLETION";
  if (state.phase === "COMPLETION_REQUESTED") return "OWNER_ACCEPT_OR_REQUEST_WORK";
  if (state.phase === "GOAL_ACCEPTED") return "GOAL_ACCEPTED_NO_FURTHER_ACTION";
  return "AGENT_SUBMIT_CORRECTED_CANDIDATE";
}

function currentFrontier(state: GoalRoomState) {
  return {
    nextLegalAction: nextLegalAction(state),
    ownerRequired:
      state.phase === "PLAN_PROPOSED" || state.phase === "COMPLETION_REQUESTED",
  };
}

function evaluate(
  state: GoalRoomState,
  command: Command,
  observedCandidateDigest?: string,
): DispatchResult {
  if (command.expectedStateVersion !== state.stateVersion) {
    return {
      accepted: false,
      reasonCode: "STALE_STATE",
      stateVersion: state.stateVersion,
      ...currentFrontier(state),
    };
  }

  if (command.type === "REQUEST_PLAN_REVISION") {
    if (command.actor !== "owner") {
      return {
        accepted: false,
        reasonCode: "OWNER_ONLY",
        stateVersion: state.stateVersion,
        ...currentFrontier(state),
      };
    }
    if (
      state.activePlan?.status !== "PROPOSED" ||
      state.activePlan.version !== command.planVersion
    ) {
      return {
        accepted: false,
        reasonCode: "PLAN_VERSION_MISMATCH",
        stateVersion: state.stateVersion,
        nextLegalAction: nextLegalAction(state),
        ownerRequired: state.phase === "PLAN_PROPOSED",
      };
    }
    return {
      accepted: true,
      stateVersion: state.stateVersion + 1,
      nextLegalAction: "AGENT_PROPOSE_REVISED_PLAN",
      ownerRequired: false,
    };
  }

  if (command.type === "ACCEPT_GOAL") {
    if (command.actor !== "owner") {
      return {
        accepted: false,
        reasonCode: "OWNER_ONLY",
        stateVersion: state.stateVersion,
        ...currentFrontier(state),
      };
    }
    if (
      state.phase !== "COMPLETION_REQUESTED" ||
      state.activeCompletionRequest?.candidateSha256 !== command.candidateSha256 ||
      state.activeCandidate?.sha256 !== command.candidateSha256 ||
      state.activeVerification?.candidateSha256 !== command.candidateSha256 ||
      state.activeVerification.verdict !== "PASS"
    ) {
      return {
        accepted: false,
        reasonCode: "CANDIDATE_BINDING_MISMATCH",
        stateVersion: state.stateVersion,
        ...currentFrontier(state),
      };
    }
    return {
      accepted: true,
      stateVersion: state.stateVersion + 1,
      nextLegalAction: "GOAL_ACCEPTED_NO_FURTHER_ACTION",
      ownerRequired: false,
    };
  }

  if (command.type === "REQUEST_COMPLETION") {
    if (command.actor !== "agent") {
      return {
        accepted: false,
        reasonCode: "AGENT_ONLY",
        stateVersion: state.stateVersion,
        ...currentFrontier(state),
      };
    }
    if (
      state.phase !== "VERIFICATION_PASSED" ||
      state.activeCandidate?.sha256 !== command.candidateSha256 ||
      state.activeVerification?.candidateSha256 !== command.candidateSha256 ||
      state.activeVerification.verdict !== "PASS"
    ) {
      return {
        accepted: false,
        reasonCode: "VERIFICATION_REQUIRED",
        missingConditions: ["ACTIVE_CANDIDATE_MUST_PASS_RELEASE_RULES"],
        stateVersion: state.stateVersion,
        ...currentFrontier(state),
      };
    }
    return {
      accepted: true,
      stateVersion: state.stateVersion + 1,
      nextLegalAction: "OWNER_ACCEPT_OR_REQUEST_WORK",
      ownerRequired: true,
    };
  }

  if (command.type === "RECORD_VERIFICATION") {
    if (
      command.actor !== "system" ||
      state.phase !== "CANDIDATE_SUBMITTED" ||
      state.activeCandidate?.sha256 !== command.candidateSha256
    ) {
      throw new Error("VERIFICATION_NOT_ALLOWED");
    }
    const expected = verifyReleaseCandidate(state.activeCandidate.content);
    if (
      command.ruleSetId !== expected.ruleSetId ||
      command.ruleSetVersion !== expected.ruleSetVersion ||
      command.verdict !== expected.verdict ||
      canonical(command.findingCodes) !== canonical(expected.findingCodes)
    ) {
      throw new Error("VERIFICATION_RESULT_MISMATCH");
    }
    return {
      accepted: true,
      stateVersion: state.stateVersion + 1,
      nextLegalAction:
        command.verdict === "PASS"
          ? "AGENT_REQUEST_COMPLETION"
          : "AGENT_SUBMIT_CORRECTED_CANDIDATE",
      ownerRequired: false,
    };
  }

  if (command.type === "SUBMIT_CANDIDATE") {
    if (
      (state.phase !== "STEP_CLAIMED" &&
        state.phase !== "VERIFICATION_FAILED") ||
      state.activeClaim?.planVersion !== command.planVersion ||
      state.activeClaim.stepId !== command.stepId
    ) {
      return {
        accepted: false,
        reasonCode: "STEP_CLAIM_REQUIRED",
        stateVersion: state.stateVersion,
        ...currentFrontier(state),
      };
    }
    if (command.actor !== "agent") {
      return {
        accepted: false,
        reasonCode: "AGENT_ONLY",
        stateVersion: state.stateVersion,
        ...currentFrontier(state),
      };
    }
    if (observedCandidateDigest !== command.sha256) {
      return {
        accepted: false,
        reasonCode: "CANDIDATE_DIGEST_MISMATCH",
        stateVersion: state.stateVersion,
        ...currentFrontier(state),
      };
    }
    return {
      accepted: true,
      stateVersion: state.stateVersion + 1,
      nextLegalAction: "SYSTEM_VERIFY_CANDIDATE",
      ownerRequired: false,
    };
  }

  if (command.type === "CLAIM_STEP") {
    if (command.actor !== "agent") {
      return {
        accepted: false,
        reasonCode: "AGENT_ONLY",
        stateVersion: state.stateVersion,
        ...currentFrontier(state),
      };
    }
    if (
      state.phase !== "PLAN_CONFIRMED" ||
      state.activePlan?.version !== command.planVersion ||
      !state.activePlan.steps.some((step) => step.id === command.stepId)
    ) {
      return {
        accepted: false,
        reasonCode: "STEP_NOT_ADMITTED",
        stateVersion: state.stateVersion,
        ...currentFrontier(state),
      };
    }
    return {
      accepted: true,
      stateVersion: state.stateVersion + 1,
      nextLegalAction: "AGENT_SUBMIT_CANDIDATE",
      ownerRequired: false,
    };
  }

  if (command.type === "CONFIRM_PLAN") {
    if (command.actor !== "owner") {
      return {
        accepted: false,
        reasonCode: "OWNER_ONLY",
        stateVersion: state.stateVersion,
        ...currentFrontier(state),
      };
    }
    if (
      state.activePlan?.status !== "PROPOSED" ||
      state.activePlan.version !== command.planVersion
    ) {
      return {
        accepted: false,
        reasonCode: "PLAN_VERSION_MISMATCH",
        stateVersion: state.stateVersion,
        ...currentFrontier(state),
      };
    }
    return {
      accepted: true,
      stateVersion: state.stateVersion + 1,
      nextLegalAction: "AGENT_CLAIM_OPEN_STEP",
      ownerRequired: false,
    };
  }

  if (command.type === "PROPOSE_PLAN") {
    if (
      state.phase !== "DRAFT" &&
      state.phase !== "PLAN_REVISION_REQUESTED"
    ) {
      return {
        accepted: false,
        reasonCode: "PLAN_PROPOSAL_NOT_ALLOWED",
        stateVersion: state.stateVersion,
        nextLegalAction: nextLegalAction(state),
        ownerRequired: state.phase === "PLAN_PROPOSED",
      };
    }
    return {
      accepted: true,
      stateVersion: state.stateVersion + 1,
      nextLegalAction: "OWNER_CONFIRM_OR_REVISE_PLAN",
      ownerRequired: true,
    };
  }

  throw new Error("INVALID_COMMAND");
}

async function makeReceipt(
  receipts: Receipt[],
  command: Command,
  result: DispatchResult,
): Promise<Receipt> {
  const body = {
    sequence: receipts.length + 1,
    previousHash: receipts.at(-1)?.hash ?? "GENESIS",
    command: structuredClone(command),
    accepted: result.accepted,
    ...(result.reasonCode ? { reasonCode: result.reasonCode } : {}),
    ...(result.missingConditions
      ? { missingConditions: [...result.missingConditions] }
      : {}),
    stateVersion: result.stateVersion,
  };
  return { ...body, hash: await sha256(body) };
}

export function createGoalRoom(input: GoalRoomInput) {
  let state = initialState(input);
  const receipts: Receipt[] = [];
  const idempotency = new Map<
    string,
    { command: string; result: DispatchResult }
  >();
  const verificationCommands = new Map<string, RecordVerificationCommand>();

  let dispatchTail: Promise<void> = Promise.resolve();

  async function dispatchOnce(command: Command): Promise<DispatchResult> {
    validateCommand(command);
    const commandValue = canonical(command);
    const prior = idempotency.get(command.idempotencyKey);
    if (prior) {
      if (prior.command !== commandValue) {
        throw new Error("IDEMPOTENCY_KEY_REUSE");
      }
      return structuredClone(prior.result);
    }

    const observedCandidateDigest =
      command.type === "SUBMIT_CANDIDATE"
        ? await sha256Text(command.content)
        : undefined;
    const result = evaluate(state, command, observedCandidateDigest);
    if (result.accepted) {
      state = applyAcceptedCommand(state, command);
    }
    receipts.push(await makeReceipt(receipts, command, result));
    idempotency.set(command.idempotencyKey, {
      command: commandValue,
      result: structuredClone(result),
    });
    return structuredClone(result);
  }

  return {
    dispatch(command: Command): Promise<DispatchResult> {
      let snapshot: Command;
      try {
        snapshot = structuredClone(command);
      } catch {
        return Promise.reject(new Error("INVALID_COMMAND"));
      }
      if (snapshot.type === "RECORD_VERIFICATION") {
        return Promise.reject(new Error("INVALID_COMMAND"));
      }
      const operation = dispatchTail.then(() => dispatchOnce(snapshot));
      dispatchTail = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
    verifyActiveCandidate(idempotencyKey: string): Promise<DispatchResult> {
      const operation = dispatchTail.then(async () => {
        let command = verificationCommands.get(idempotencyKey);
        if (!command) {
          if (state.phase !== "CANDIDATE_SUBMITTED" || !state.activeCandidate) {
            throw new Error("VERIFICATION_NOT_ALLOWED");
          }
          const verification = verifyReleaseCandidate(state.activeCandidate.content);
          command = {
            type: "RECORD_VERIFICATION",
            actor: "system",
            expectedStateVersion: state.stateVersion,
            idempotencyKey,
            candidateSha256: state.activeCandidate.sha256,
            ruleSetId: verification.ruleSetId,
            ruleSetVersion: verification.ruleSetVersion,
            verdict: verification.verdict,
            findingCodes: verification.findingCodes,
          };
          verificationCommands.set(idempotencyKey, structuredClone(command));
        }
        return dispatchOnce(command);
      });
      dispatchTail = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
    getState(): GoalRoomState {
      return structuredClone(state);
    },
    getReceipts(): Receipt[] {
      return structuredClone(receipts);
    },
  };
}

export async function replayGoalRoom(
  input: GoalRoomInput,
  receipts: Receipt[],
): Promise<GoalRoomState> {
  let state = initialState(input);
  let previousHash = "GENESIS";
  const idempotency = new Map<string, string>();

  for (const [index, receipt] of receipts.entries()) {
    const { hash, ...body } = receipt;
    if (
      receipt.sequence !== index + 1 ||
      !Number.isSafeInteger(receipt.sequence)
    ) {
      throw new Error("RECEIPT_SEQUENCE_MISMATCH");
    }
    if (
      receipt.previousHash !== previousHash ||
      (await sha256(body)) !== hash
    ) {
      throw new Error("RECEIPT_HASH_MISMATCH");
    }

    validateCommand(receipt.command);
    const commandValue = canonical(receipt.command);
    const priorCommand = idempotency.get(receipt.command.idempotencyKey);
    if (priorCommand !== undefined) {
      if (priorCommand !== commandValue) {
        throw new Error("IDEMPOTENCY_KEY_REUSE");
      }
      throw new Error("REPLAY_DUPLICATE_IDEMPOTENCY");
    }

    const observedCandidateDigest =
      receipt.command.type === "SUBMIT_CANDIDATE"
        ? await sha256Text(receipt.command.content)
        : undefined;
    const expected = evaluate(state, receipt.command, observedCandidateDigest);
    if (
      receipt.accepted !== expected.accepted ||
      receipt.reasonCode !== expected.reasonCode ||
      canonical(receipt.missingConditions) !== canonical(expected.missingConditions) ||
      receipt.stateVersion !== expected.stateVersion
    ) {
      throw new Error("REPLAY_OUTCOME_MISMATCH");
    }

    if (expected.accepted) {
      state = applyAcceptedCommand(state, receipt.command);
    }
    idempotency.set(receipt.command.idempotencyKey, commandValue);
    previousHash = hash;
  }

  return structuredClone(state);
}
