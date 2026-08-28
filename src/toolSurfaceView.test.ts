import { describe, expect, it } from "vitest";
import { createGoalRoom } from "./core/goalRoom";
import { createToolSurfaceView } from "./toolSurfaceView";
import { installGoalRoomTools } from "./webmcp";

describe("static-six informational Agent tool projection", () => {
  it("matches actual registration names and order exactly", () => {
    const room = createGoalRoom({ ownerIntent: null });
    const registered: string[] = [];
    installGoalRoomTools({
      documentLike: { modelContext: { registerTool: (tool) => registered.push(tool.name) } },
      navigatorLike: {},
      room,
      onInvocation: () => undefined,
    });
    const projected = createToolSurfaceView(room.getState());
    expect(projected.registration).toBe("static-six");
    expect(projected.tools.map((tool) => tool.name)).toEqual(registered);
    expect(projected.tools).toHaveLength(6);
  });

  it("is read-only guidance and excludes every privileged or internal command", () => {
    const projected = createToolSurfaceView(createGoalRoom({ ownerIntent: null }).getState());
    expect(projected.interactive).toBe(false);
    expect(projected.expandedByDefault).toBe(false);
    expect(projected.tools.map((tool) => tool.name)).toEqual([
      "get_goal_room_state",
      "propose_goal_contract",
      "propose_plan",
      "claim_step",
      "submit_artifact",
      "request_completion",
    ]);
    expect(JSON.stringify(projected)).not.toMatch(/accept|confirm|revise|verify|deploy|payment|message/i);
  });

  it("derives phase guidance without claiming dynamic registration", () => {
    const room = createGoalRoom({ ownerIntent: null });
    expect(createToolSurfaceView(room.getState()).tools.map((tool) => tool.available)).toEqual([true, false, false, false, false, false]);
  });
});
