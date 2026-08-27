import type { GoalRoomState, PlanStep, Receipt } from "./core/goalRoom";

export type OwnerViewModel = {
  goal: string;
  doneLooksLike: string[];
  statusLabel: string;
  ownerAttention: {
    required: boolean;
    title: string;
    body: string;
  };
  actions: {
    confirm: { visible: boolean; label: string };
    revise: { visible: boolean; label: string };
    demo: { visible: boolean; label: string };
    acceptGoal: { visible: boolean; label: string };
  };
  nextLegalAction: {
    label: string;
    actor: "agent" | "owner" | "system";
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
};

function baseView(state: GoalRoomState, receipts: Receipt[]) {
  const plan = state.activePlan;
  return {
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
  };
}

function hiddenActions(planVersion: number) {
  return {
    confirm: { visible: false, label: `Confirm Plan v${planVersion}` },
    revise: { visible: false, label: "Request revision" },
    demo: { visible: false, label: "Run next governed action" },
    acceptGoal: { visible: false, label: "Accept Goal" },
  };
}

export function createOwnerViewModel(
  state: GoalRoomState,
  receipts: Receipt[],
): OwnerViewModel {
  const common = baseView(state, receipts);
  const plan = state.activePlan;
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
      statusLabel: "Plan confirmed — work may begin",
      ownerAttention: {
        required: false,
        title: `Plan v${plan.version} confirmed`,
        body: "The agent may claim an admitted step. The Goal is not yet accepted.",
      },
      actions: {
        ...hiddenActions(plan.version),
        demo: { visible: true, label: "Agent claims the artifact step" },
      },
      nextLegalAction: {
        label: "Agent may claim the next admitted step",
        actor: "agent",
      },
    };
  }

  if (state.phase === "STEP_CLAIMED") {
    return {
      ...common,
      statusLabel: "Step claimed — evidence required",
      ownerAttention: {
        required: false,
        title: `Agent holds step ${state.activeClaim?.stepId ?? "—"}`,
        body: "The claim grants custody of this admitted step, not authority to verify or accept it.",
      },
      actions: {
        ...hiddenActions(plan.version),
        demo: { visible: true, label: "Submit failing Candidate v1" },
      },
      nextLegalAction: {
        label: "Agent must submit exact candidate evidence",
        actor: "agent",
      },
    };
  }

  if (state.phase === "CANDIDATE_SUBMITTED") {
    return {
      ...common,
      statusLabel: "Evidence submitted — verification required",
      ownerAttention: {
        required: false,
        title: `Candidate v${state.activeCandidate?.version ?? "—"} is awaiting verification`,
        body: "WorkHub recorded the exact bytes and SHA-256 digest. The agent cannot grade this candidate.",
      },
      actions: {
        ...hiddenActions(plan.version),
        demo: { visible: true, label: "Run deterministic verification" },
      },
      nextLegalAction: {
        label: "System must verify this exact candidate",
        actor: "system",
      },
    };
  }

  if (state.phase === "VERIFICATION_FAILED") {
    return {
      ...common,
      statusLabel: "Verification failed — correction required",
      ownerAttention: {
        required: false,
        title: `Candidate v${state.activeCandidate?.version ?? "—"} did not pass`,
        body: "The failed candidate and verdict remain immutable. The agent may submit a corrected version.",
      },
      actions: {
        ...hiddenActions(plan.version),
        demo: {
          visible: true,
          label: `Submit corrected Candidate v${(state.activeCandidate?.version ?? 0) + 1}`,
        },
      },
      nextLegalAction: {
        label: "Agent must submit a corrected candidate",
        actor: "agent",
      },
    };
  }

  if (state.phase === "VERIFICATION_PASSED") {
    return {
      ...common,
      statusLabel: "Verification passed — owner has not accepted the Goal",
      ownerAttention: {
        required: false,
        title: `Candidate v${state.activeCandidate?.version ?? "—"} passed deterministic verification`,
        body: "PASS proves the explicit checks succeeded. It does not grant final acceptance authority.",
      },
      actions: {
        ...hiddenActions(plan.version),
        demo: { visible: true, label: "Agent requests completion" },
      },
      nextLegalAction: {
        label: "Agent may request completion for this exact candidate",
        actor: "agent",
      },
    };
  }

  if (state.phase === "COMPLETION_REQUESTED") {
    return {
      ...common,
      statusLabel: "Verified result — awaiting owner acceptance",
      ownerAttention: {
        required: true,
        title: `Accept Candidate v${state.activeCandidate?.version ?? "—"}?`,
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
        actor: "owner",
      },
    };
  }

  throw new Error("Owner view state is not implemented");
}
