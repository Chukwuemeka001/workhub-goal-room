import type { GoalRoomState, PlanStep, Receipt } from "./core/goalRoom";
import { createGoalContractView, type GoalContractView } from "./goalContractView";

export type LifecycleStage = {
  id: "plan" | "claim" | "evidence" | "verify" | "completion" | "acceptance";
  label: string;
  status: "complete" | "active" | "pending" | "failed";
};

export type OwnerViewModel = {
  ownerIntent: string | null;
  goal: string;
  doneLooksLike: string[];
  statusLabel: string;
  ownerAttention: {
    required: boolean;
    title: string;
    body: string;
  };
  actions: {
    setIntent: { visible: boolean; label: string };
    confirm: { visible: boolean; label: string };
    revise: { visible: boolean; label: string };
    acceptGoal: { visible: boolean; label: string };
  };
  goalContract: GoalContractView;
  nextLegalAction: {
    label: string;
    actor: "agent" | "owner" | "system" | "none";
  };
  plan: {
    version: number;
    status: string;
    steps: PlanStep[];
    revisionNote?: string;
  } | null;
  evidence: {
    visible: boolean;
    candidateVersion?: number;
    stepId?: string;
    digest?: string;
    verdict?: "PASS" | "FAIL";
    ruleSet?: string;
    findingCodes: string[];
  };
  receiptCount: number;
  lifecycle: LifecycleStage[];
};

const lifecycleStages = [
  ["plan", "Plan"],
  ["claim", "Claim"],
  ["evidence", "Evidence"],
  ["verify", "Verify"],
  ["completion", "Complete"],
  ["acceptance", "Accept"],
] as const;

const lifecycleStatuses: Record<
  GoalRoomState["phase"],
  readonly LifecycleStage["status"][]
> = {
  INTENT_DRAFT: ["pending", "pending", "pending", "pending", "pending", "pending"],
  GOAL_CONTRACT_PROPOSED: ["pending", "pending", "pending", "pending", "pending", "pending"],
  GOAL_CONTRACT_REVISION_REQUESTED: ["pending", "pending", "pending", "pending", "pending", "pending"],
  GOAL_CONTRACT_CONFIRMED: ["pending", "pending", "pending", "pending", "pending", "pending"],
  DRAFT: ["active", "pending", "pending", "pending", "pending", "pending"],
  PLAN_PROPOSED: ["active", "pending", "pending", "pending", "pending", "pending"],
  PLAN_REVISION_REQUESTED: ["active", "pending", "pending", "pending", "pending", "pending"],
  PLAN_CONFIRMED: ["complete", "active", "pending", "pending", "pending", "pending"],
  STEP_CLAIMED: ["complete", "complete", "active", "pending", "pending", "pending"],
  CANDIDATE_SUBMITTED: ["complete", "complete", "complete", "active", "pending", "pending"],
  VERIFICATION_FAILED: ["complete", "complete", "active", "failed", "pending", "pending"],
  VERIFICATION_PASSED: ["complete", "complete", "complete", "complete", "active", "pending"],
  COMPLETION_REQUESTED: ["complete", "complete", "complete", "complete", "complete", "active"],
  GOAL_ACCEPTED: ["complete", "complete", "complete", "complete", "complete", "complete"],
};

function createLifecycle(state: GoalRoomState): LifecycleStage[] {
  const statuses = lifecycleStatuses[state.phase];
  return lifecycleStages.map(([id, label], index) => ({
    id,
    label,
    status: statuses[index],
  }));
}

function baseView(state: GoalRoomState, receipts: Receipt[]) {
  const plan = state.activePlan;
  return {
    ownerIntent: state.ownerIntent,
    goalContract: createGoalContractView(state, receipts),
    goal: state.goal,
    doneLooksLike: [...state.doneLooksLike],
    plan: plan
      ? {
          version: plan.version,
          status: plan.status,
          steps: plan.steps.map((step) => ({ ...step })),
          ...(plan.revisionRequest
            ? { revisionNote: plan.revisionRequest.note }
            : {}),
        }
      : null,
    evidence: {
      visible: state.activeCandidate !== null,
      ...(state.activeCandidate
        ? {
            candidateVersion: state.activeCandidate.version,
            stepId: state.activeCandidate.stepId,
            digest: state.activeCandidate.sha256,
          }
        : {}),
      ...(state.activeVerification
        ? {
            verdict: state.activeVerification.verdict,
            ruleSet: `${state.activeVerification.ruleSetId}/v${state.activeVerification.ruleSetVersion}`,
            findingCodes: [...state.activeVerification.findingCodes],
          }
        : { findingCodes: [] }),
    },
    receiptCount: receipts.length,
    lifecycle: createLifecycle(state),
  };
}

function hiddenActions(planVersion: number) {
  return {
    setIntent: { visible: false, label: "Set owner intent" },
    confirm: { visible: false, label: `Confirm Plan v${planVersion}` },
    revise: { visible: false, label: "Request revision" },
    acceptGoal: { visible: false, label: "Accept Goal" },
  };
}

export function createOwnerViewModel(
  state: GoalRoomState,
  receipts: Receipt[],
): OwnerViewModel {
  const common = baseView(state, receipts);
  const plan = state.activePlan;
  if (state.phase === "INTENT_DRAFT") {
    if (state.ownerIntent === null) {
      return {
        ...common,
        statusLabel: "Owner intent required. Goal not admitted",
        ownerAttention: {
          required: true,
          title: "Describe the outcome you want",
          body: "Intent is context only. It cannot admit a Goal, Plan, or work.",
        },
        actions: {
          ...hiddenActions(0),
          setIntent: { visible: true, label: "Set owner intent" },
        },
        nextLegalAction: {
          label: "Owner must set initial intent",
          actor: "owner",
        },
      };
    }
    return {
      ...common,
      statusLabel: "Owner intent captured. Goal not admitted",
      ownerAttention: {
        required: false,
        title: "Agent must propose a Goal Contract",
        body: "Intent is context only. Planning remains blocked until you confirm an exact Goal Contract.",
      },
      actions: {
        ...hiddenActions(0),
        setIntent: { visible: true, label: "Revise owner intent" },
      },
      nextLegalAction: {
        label: "Agent must propose Goal Contract v1",
        actor: "agent",
      },
    };
  }
  if (state.phase === "GOAL_CONTRACT_PROPOSED") {
    const goalVersion = state.activeGoalContract?.version ?? 0;
    return {
      ...common,
      statusLabel: "Waiting for your Goal decision",
      ownerAttention: {
        required: true,
        title: `Review Goal Contract v${goalVersion}`,
        body: "Planning remains blocked until you confirm this exact Goal or request a revision.",
      },
      actions: {
        ...hiddenActions(0),
        confirm: { visible: true, label: `Confirm Goal v${goalVersion}` },
        revise: { visible: true, label: "Request Goal revision" },
      },
      nextLegalAction: {
        label: "Owner must confirm or request Goal revision",
        actor: "owner",
      },
    };
  }
  if (state.phase === "GOAL_CONTRACT_REVISION_REQUESTED") {
    const nextVersion = (state.activeGoalContract?.version ?? 0) + 1;
    return {
      ...common,
      statusLabel: "Waiting for revised Goal Contract",
      ownerAttention: {
        required: false,
        title: "Goal revision requested",
        body: `The agent must respond with Goal Contract v${nextVersion} before you decide again.`,
      },
      actions: hiddenActions(0),
      nextLegalAction: {
        label: `Agent must propose Goal Contract v${nextVersion}`,
        actor: "agent",
      },
    };
  }
  if (state.phase === "GOAL_CONTRACT_CONFIRMED") {
    const goalVersion = state.activeGoalContract?.version ?? 0;
    return {
      ...common,
      statusLabel: "Goal confirmed. Plan required",
      ownerAttention: {
        required: false,
        title: `Goal Contract v${goalVersion} confirmed`,
        body: "No work is admitted until the agent proposes a Plan bound to this exact Goal version.",
      },
      actions: hiddenActions(0),
      nextLegalAction: {
        label: "Agent must propose Plan v1",
        actor: "agent",
      },
    };
  }
  if (!plan) throw new Error("Owner view state is not implemented");

  if (state.phase === "PLAN_PROPOSED") {
    return {
      ...common,
      statusLabel: "Waiting for your Plan decision",
      ownerAttention: {
        required: true,
        title: `Review Plan v${plan.version}`,
        body: "Work cannot begin until you confirm this Plan or request a revision.",
      },
      actions: {
        ...hiddenActions(plan.version),
        confirm: { visible: true, label: `Confirm Plan v${plan.version}` },
        revise: { visible: true, label: "Request revision" },
      },
      nextLegalAction: {
        label: "Owner must confirm or request revision",
        actor: "owner",
      },
    };
  }

  if (state.phase === "PLAN_REVISION_REQUESTED") {
    return {
      ...common,
      statusLabel: "Waiting for revised Plan",
      ownerAttention: {
        required: false,
        title: "Revision requested",
        body: `The agent must respond with Plan v${plan.version + 1} before you need to decide again.`,
      },
      actions: hiddenActions(plan.version),
      nextLegalAction: {
        label: `Agent must propose revised Plan v${plan.version + 1}`,
        actor: "agent",
      },
    };
  }

  if (state.phase === "PLAN_CONFIRMED") {
    return {
      ...common,
      statusLabel: "Plan confirmed. Work may begin",
      ownerAttention: {
        required: false,
        title: `Plan v${plan.version} confirmed`,
        body: "The agent may claim an admitted step. The Goal is not yet accepted.",
      },
      actions: hiddenActions(plan.version),
      nextLegalAction: {
        label: "Agent may claim the next admitted step",
        actor: "agent",
      },
    };
  }

  if (state.phase === "STEP_CLAIMED") {
    return {
      ...common,
      statusLabel: "Step claimed. Evidence required",
      ownerAttention: {
        required: false,
        title: `Agent holds step ${state.activeClaim?.stepId ?? "not recorded"}`,
        body: "The claim grants custody of this admitted step, not authority to verify or accept it.",
      },
      actions: hiddenActions(plan.version),
      nextLegalAction: {
        label: "Agent must submit exact candidate evidence",
        actor: "agent",
      },
    };
  }

  if (state.phase === "CANDIDATE_SUBMITTED") {
    return {
      ...common,
      statusLabel: "Evidence submitted. Verification required",
      ownerAttention: {
        required: false,
        title: `Candidate v${state.activeCandidate?.version ?? "not recorded"} is awaiting verification`,
        body: "WorkHub recorded the exact bytes and SHA-256 digest. The agent cannot grade this candidate.",
      },
      actions: hiddenActions(plan.version),
      nextLegalAction: {
        label: "System must verify this exact candidate",
        actor: "system",
      },
    };
  }

  if (state.phase === "VERIFICATION_FAILED") {
    return {
      ...common,
      statusLabel: "Verification failed. Correction required",
      ownerAttention: {
        required: false,
        title: `Candidate v${state.activeCandidate?.version ?? "not recorded"} did not pass`,
        body: "The failed candidate and verdict remain immutable. The agent may submit a corrected version.",
      },
      actions: hiddenActions(plan.version),
      nextLegalAction: {
        label: "Agent must submit a corrected candidate",
        actor: "agent",
      },
    };
  }

  if (state.phase === "VERIFICATION_PASSED") {
    return {
      ...common,
      statusLabel: "Verification passed. Owner has not accepted the Goal",
      ownerAttention: {
        required: false,
        title: `Candidate v${state.activeCandidate?.version ?? "not recorded"} passed deterministic verification`,
        body: "PASS proves the explicit checks succeeded. It does not grant final acceptance authority.",
      },
      actions: hiddenActions(plan.version),
      nextLegalAction: {
        label: "Agent may request completion for this exact candidate",
        actor: "agent",
      },
    };
  }

  if (state.phase === "COMPLETION_REQUESTED") {
    return {
      ...common,
      statusLabel: "Verified result. Awaiting owner acceptance",
      ownerAttention: {
        required: true,
        title: `Accept Candidate v${state.activeCandidate?.version ?? "not recorded"}?`,
        body: "The candidate passed deterministic checks. Only you can accept the Goal.",
      },
      actions: {
        ...hiddenActions(plan.version),
        acceptGoal: { visible: true, label: "Accept Goal" },
      },
      nextLegalAction: {
        label: "Owner may accept this exact verified candidate",
        actor: "owner",
      },
    };
  }

  if (state.phase === "GOAL_ACCEPTED") {
    return {
      ...common,
      statusLabel: "Goal accepted by owner",
      ownerAttention: {
        required: false,
        title: "Goal complete",
        body: "The owner accepted the exact candidate that passed deterministic verification.",
      },
      actions: hiddenActions(plan.version),
      nextLegalAction: {
        label: "No further governed action",
        actor: "none",
      },
    };
  }

  throw new Error("Owner view state is not implemented");
}
