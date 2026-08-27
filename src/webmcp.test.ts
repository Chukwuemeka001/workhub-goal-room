import { describe, expect, it, vi } from "vitest";
import { installGoalRoomPing } from "./webmcp";

describe("installGoalRoomPing", () => {
  it("registers a strict WebMCP tool that visibly records a ping", async () => {
    const registerTool = vi.fn();
    const onPing = vi.fn();

    const installed = installGoalRoomPing({
      documentLike: { modelContext: { registerTool } },
      navigatorLike: {},
      onPing,
    });

    expect(installed.status).toBe("registered");
    expect(registerTool).toHaveBeenCalledOnce();

    const tool = registerTool.mock.calls[0]?.[0];
    expect(tool).toMatchObject({
      name: "workhub_goal_room_ping",
      title: "Ping WorkHub Goal Room",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["message"],
      },
      annotations: { readOnlyHint: false },
    });

    const result = await tool.execute({ message: "Phase 0 is alive" });

    expect(onPing).toHaveBeenCalledWith("Phase 0 is alive");
    expect(result).toEqual({
      ok: true,
      room: "WorkHub Goal Room",
      phase: "PHASE_0_WEBMCP_PROOF",
      message: "Phase 0 is alive",
      visibleStateChanged: true,
    });
  });

  it("falls back to navigator.modelContext and reports unsupported clients", () => {
    const registerTool = vi.fn();

    expect(
      installGoalRoomPing({
        documentLike: {},
        navigatorLike: { modelContext: { registerTool } },
        onPing: vi.fn(),
      }).status,
    ).toBe("registered");

    expect(
      installGoalRoomPing({
        documentLike: {},
        navigatorLike: {},
        onPing: vi.fn(),
      }),
    ).toEqual({ status: "unsupported", dispose: expect.any(Function) });
  });
});
