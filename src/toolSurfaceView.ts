import type { GoalRoomState } from "./core/goalRoom";

export const STATIC_AGENT_TOOL_NAMES = [
  "get_goal_room_state",
  "propose_goal_contract",
  "propose_plan",
  "claim_step",
  "submit_artifact",
  "request_completion",
] as const;

export type AgentToolName = typeof STATIC_AGENT_TOOL_NAMES[number];

export type ToolSurfaceView = {
  registration: "static-six";
  interactive: false;
  expandedByDefault: false;
  tools: Array<{ name: AgentToolName; available: boolean; guidance: string }>;
};

function legalAgentTools(state: GoalRoomState): ReadonlySet<AgentToolName> {
  const available = new Set<AgentToolName>(["get_goal_room_state"]);
  if ((state.phase === "INTENT_DRAFT" && state.ownerIntent !== null) || state.phase === "GOAL_CONTRACT_REVISION_REQUESTED") available.add("propose_goal_contract");
  if (["GOAL_CONTRACT_CONFIRMED", "DRAFT", "PLAN_REVISION_REQUESTED"].includes(state.phase)) available.add("propose_plan");
  if (state.phase === "PLAN_CONFIRMED") available.add("claim_step");
  if (["STEP_CLAIMED", "VERIFICATION_FAILED"].includes(state.phase)) available.add("submit_artifact");
  if (state.phase === "VERIFICATION_PASSED") available.add("request_completion");
  return available;
}

export function createToolSurfaceView(state: GoalRoomState): ToolSurfaceView {
  const available = legalAgentTools(state);
  return {
    registration: "static-six",
    interactive: false,
    expandedByDefault: false,
    tools: STATIC_AGENT_TOOL_NAMES.map((name) => ({
      name,
      available: available.has(name),
      guidance: available.has(name) ? "Available at this frontier" : "Unavailable in this canonical phase",
    })),
  };
}
