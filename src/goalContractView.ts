import type { GoalRoomState, Receipt } from "./core/goalRoom";

export type GoalOriginEvent = {
  kind:
    | "OWNER_INTENT"
    | "GOAL_PROPOSAL"
    | "GOAL_REVISION_REQUEST"
    | "GOAL_CONFIRMATION";
  actor: "owner" | "agent";
  authority: "CONTEXT_ONLY" | "PROPOSAL" | "DECISION";
  label: string;
  text?: string;
  goalContractVersion?: number;
};

export type GoalContractView = {
  pendingOwnerIntent: string | null;
  activeGoal: {
    version: number;
    status: "PROPOSED" | "REVISION_REQUESTED" | "CONFIRMED";
    goal: string;
  } | null;
  confirmedGoalVersion: number | null;
  history: GoalOriginEvent[];
};

export function createGoalContractView(
  state: GoalRoomState,
  receipts: Receipt[],
): GoalContractView {
  const history: GoalOriginEvent[] = [];
  const hasAcceptedIntentReceipt = receipts.some(
    (receipt) => receipt.accepted && receipt.command.type === "SET_OWNER_INTENT",
  );
  if (!hasAcceptedIntentReceipt && state.ownerIntent !== null) {
    history.push({
      kind: "OWNER_INTENT",
      actor: "owner",
      authority: "CONTEXT_ONLY",
      label: "Owner intent",
      text: state.ownerIntent,
    });
  }

  let goalVersion = 0;
  let intentRevision = 0;
  for (const receipt of receipts) {
    if (!receipt.accepted) continue;
    const command = receipt.command;
    if (command.type === "SET_OWNER_INTENT") {
      intentRevision += 1;
      history.push({
        kind: "OWNER_INTENT",
        actor: "owner",
        authority: "CONTEXT_ONLY",
        label: intentRevision === 1 ? "Owner captured intent" : "Owner revised intent",
        text: command.intent.trim(),
      });
    } else if (command.type === "PROPOSE_GOAL_CONTRACT") {
      goalVersion += 1;
      history.push({
        kind: "GOAL_PROPOSAL",
        actor: "agent",
        authority: "PROPOSAL",
        label: `Agent proposed Goal Contract v${goalVersion}`,
        goalContractVersion: goalVersion,
      });
    } else if (command.type === "REQUEST_GOAL_REVISION") {
      history.push({
        kind: "GOAL_REVISION_REQUEST",
        actor: "owner",
        authority: "DECISION",
        label: `Owner requested revision to Goal Contract v${command.goalContractVersion}`,
        goalContractVersion: command.goalContractVersion,
        text: command.note.trim(),
      });
    } else if (command.type === "CONFIRM_GOAL_CONTRACT") {
      history.push({
        kind: "GOAL_CONFIRMATION",
        actor: "owner",
        authority: "DECISION",
        label: `Owner confirmed Goal Contract v${command.goalContractVersion}`,
        goalContractVersion: command.goalContractVersion,
      });
    }
  }

  const activeGoal = state.activeGoalContract;
  return {
    pendingOwnerIntent: activeGoal === null ? state.ownerIntent : null,
    activeGoal: activeGoal
      ? {
          version: activeGoal.version,
          status: activeGoal.status,
          goal: activeGoal.goal,
        }
      : null,
    confirmedGoalVersion:
      activeGoal?.status === "CONFIRMED" ? activeGoal.version : null,
    history,
  };
}
