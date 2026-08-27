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
      if (!(options instanceof AbortSignal)) throw new Error("direct signal required");
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
