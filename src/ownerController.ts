import type { createGoalRoom } from "./core/goalRoom";
import { createOwnerViewModel, type OwnerViewModel } from "./ownerView";

type GoalRoom = ReturnType<typeof createGoalRoom>;

type ControllerOptions = {
  room: GoalRoom;
  render: (view: OwnerViewModel) => void;
};

export function createOwnerDecisionController({
  room,
  render: renderView,
}: ControllerOptions) {
  function render() {
    renderView(createOwnerViewModel(room.getState(), room.getReceipts()));
  }

  return {
    render,
    async requestRevision(note: string) {
      const state = room.getState();
      if (state.phase !== "PLAN_PROPOSED" || !state.activePlan) {
        throw new Error("OWNER_DECISION_NOT_AVAILABLE");
      }
      await room.dispatch({
        type: "REQUEST_PLAN_REVISION",
        actor: "owner",
        expectedStateVersion: state.stateVersion,
        idempotencyKey: `owner-revise-v${state.activePlan.version}-s${state.stateVersion}`,
        planVersion: state.activePlan.version,
        note,
      });
      render();
    },
    async confirmPlan() {
      const state = room.getState();
      if (state.phase !== "PLAN_PROPOSED" || !state.activePlan) {
        throw new Error("OWNER_DECISION_NOT_AVAILABLE");
      }
      await room.dispatch({
        type: "CONFIRM_PLAN",
        actor: "owner",
        expectedStateVersion: state.stateVersion,
        idempotencyKey: `owner-confirm-v${state.activePlan.version}-s${state.stateVersion}`,
        planVersion: state.activePlan.version,
      });
      render();
    },
  };
}
