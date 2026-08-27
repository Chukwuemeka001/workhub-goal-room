import { describe, expect, it } from "vitest";
import { createPhase0View } from "./phase0View";

function element() {
  return { textContent: "", dataset: {} as Record<string, string> };
}

describe("createPhase0View", () => {
  it("projects WebMCP support and a tool ping into visible room state", () => {
    const support = element();
    const message = element();
    const count = element();
    const view = createPhase0View({ support, message, count });

    view.showRegistration("registered");
    expect(support.textContent).toBe("WebMCP tool registered");
    expect(support.dataset.status).toBe("registered");

    view.recordPing("Phase 0 is alive");
    expect(message.textContent).toBe("Phase 0 is alive");
    expect(count.textContent).toBe("1");
    expect(message.dataset.state).toBe("changed");

    view.recordPing("Second invocation");
    expect(message.textContent).toBe("Second invocation");
    expect(count.textContent).toBe("2");
  });

  it("makes unsupported clients explicit", () => {
    const support = element();
    const view = createPhase0View({
      support,
      message: element(),
      count: element(),
    });

    view.showRegistration("unsupported");

    expect(support.textContent).toBe(
      "WebMCP unavailable in this browser — use a qualifying ChatGPT or Chrome client",
    );
    expect(support.dataset.status).toBe("unsupported");
  });
});
