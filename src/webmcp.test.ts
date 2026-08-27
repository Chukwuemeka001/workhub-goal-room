import { describe, expect, it, vi } from "vitest";
import { createGoalRoom } from "./core/goalRoom";
import { installGoalRoomTools } from "./webmcp";

function roomFixture() {
  return createGoalRoom({
    goal: "Ship a governed release",
    doneLooksLike: ["Owner accepts exact verified evidence"],
  });
}

describe("installGoalRoomTools compatibility", () => {
  it("does not retry unrelated registration errors as compatibility failures", () => {
    const registerTool = vi.fn(() => {
      throw new Error("REGISTER_FAILED");
    });

    expect(() =>
      installGoalRoomTools({
        documentLike: { modelContext: { registerTool } },
        navigatorLike: {},
        room: roomFixture(),
        onInvocation: vi.fn(),
      }),
    ).toThrow("REGISTER_FAILED");
    expect(registerTool).toHaveBeenCalledTimes(1);
  });

  it("aborts the complete surface on a terminal later registration failure", () => {
    const acceptedSignals: AbortSignal[] = [];
    const registerTool = vi.fn((tool, options) => {
      if (tool.name === "claim_step") {
        throw new TypeError("REGISTER_FAILED");
      }
      const signal = options instanceof AbortSignal ? options : options.signal;
      acceptedSignals.push(signal);
    });

    expect(() =>
      installGoalRoomTools({
        documentLike: { modelContext: { registerTool } },
        navigatorLike: {},
        room: roomFixture(),
        onInvocation: vi.fn(),
      }),
    ).toThrow("REGISTER_FAILED");

    expect(registerTool.mock.calls.map(([tool]) => tool.name)).toEqual([
      "get_goal_room_state",
      "propose_plan",
      "claim_step",
      "claim_step",
    ]);
    expect(acceptedSignals).toHaveLength(2);
    expect(acceptedSignals.every((signal) => signal.aborted)).toBe(true);
  });

  it("prefers document.modelContext and disposes every registration", () => {
    const documentRegister = vi.fn();
    const navigatorRegister = vi.fn();

    const installed = installGoalRoomTools({
      documentLike: { modelContext: { registerTool: documentRegister } },
      navigatorLike: { modelContext: { registerTool: navigatorRegister } },
      room: roomFixture(),
      onInvocation: vi.fn(),
    });

    expect(installed.status).toBe("registered");
    expect(documentRegister).toHaveBeenCalledTimes(5);
    expect(navigatorRegister).not.toHaveBeenCalled();
    const signals = documentRegister.mock.calls.map(([, options]) => options.signal);
    expect(signals.every((signal) => signal.aborted === false)).toBe(true);
    installed.dispose();
    expect(signals.every((signal) => signal.aborted === true)).toBe(true);
  });

  it("falls back to navigator and the direct AbortSignal registration shape", () => {
    const registerTool = vi.fn((_tool, options) => {
      if (!(options instanceof AbortSignal)) {
        throw new TypeError("direct signal required");
      }
    });

    const installed = installGoalRoomTools({
      documentLike: {},
      navigatorLike: { modelContext: { registerTool } },
      room: roomFixture(),
      onInvocation: vi.fn(),
    });

    expect(installed.status).toBe("registered");
    expect(registerTool).toHaveBeenCalledTimes(10);
    expect(
      registerTool.mock.calls.filter(([, options]) => options instanceof AbortSignal),
    ).toHaveLength(5);
  });

  it("reports unsupported clients without mutation", () => {
    const room = roomFixture();
    expect(
      installGoalRoomTools({
        documentLike: {},
        navigatorLike: {},
        room,
        onInvocation: vi.fn(),
      }),
    ).toEqual({ status: "unsupported", dispose: expect.any(Function) });
    expect(room.getState().stateVersion).toBe(0);
    expect(room.getReceipts()).toHaveLength(0);
  });
});
