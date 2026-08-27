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
  };
  nextLegalAction: {
    label: string;
    actor: "agent" | "owner";
  };
  plan: {
    version: number;
    status: string;
    steps: PlanStep[];
    revisionNote?: string;
  } | null;
  receiptCount: number;
};

export function createOwnerViewModel(
  state: GoalRoomState,
  receipts: Receipt[],
): OwnerViewModel {
  const plan = state.activePlan;
  if (state.phase === "PLAN_CONFIRMED" && plan) {
    return {
      goal: state.goal,
      doneLooksLike: [...state.doneLooksLike],
      statusLabel: "Plan confirmed — work may begin",
      ownerAttention: {
        required: false,
        title: `Plan v${plan.version} confirmed`,
        body: "The agent may claim an admitted step. The Goal is not yet accepted.",
      },
      actions: {
        confirm: { visible: false, label: `Confirm Plan v${plan.version}` },
        revise: { visible: false, label: "Request revision" },
      },
      nextLegalAction: {
        label: "Agent may claim the next admitted step",
        actor: "agent",
      },
      plan: {
        version: plan.version,
        status: plan.status,
        steps: plan.steps.map((step) => ({ ...step })),
      },
      receiptCount: receipts.length,
    };
  }
  if (state.phase === "PLAN_REVISION_REQUESTED" && plan) {
    return {
      goal: state.goal,
      doneLooksLike: [...state.doneLooksLike],
      statusLabel: "Waiting for revised Plan",
      ownerAttention: {
        required: false,
        title: "Revision requested",
        body: `The agent must respond with Plan v${plan.version + 1} before you need to decide again.`,
      },
      actions: {
        confirm: { visible: false, label: `Confirm Plan v${plan.version}` },
        revise: { visible: false, label: "Request revision" },
      },
      nextLegalAction: {
        label: `Agent must propose revised Plan v${plan.version + 1}`,
        actor: "agent",
      },
      plan: {
        version: plan.version,
        status: plan.status,
        steps: plan.steps.map((step) => ({ ...step })),
        revisionNote: plan.revisionRequest?.note,
      },
      receiptCount: receipts.length,
    };
  }
  if (state.phase !== "PLAN_PROPOSED" || !plan) {
    throw new Error("Owner view state is not implemented");
  }

  return {
    goal: state.goal,
    doneLooksLike: [...state.doneLooksLike],
    statusLabel: "Waiting for your Plan decision",
    ownerAttention: {
      required: true,
      title: `Review Plan v${plan.version}`,
      body: "Work cannot begin until you confirm this Plan or request a revision.",
    },
    actions: {
      confirm: { visible: true, label: `Confirm Plan v${plan.version}` },
      revise: { visible: true, label: "Request revision" },
    },
    nextLegalAction: {
      label: "Owner must confirm or request revision",
      actor: "owner",
    },
    plan: {
      version: plan.version,
      status: plan.status,
      steps: plan.steps.map((step) => ({ ...step })),
    },
    receiptCount: receipts.length,
  };
}
