import { describe, expect, it } from "vitest";
import html from "../index.html?raw";
import main from "./main.ts?raw";
import desktopUi from "./desktopUi.ts?raw";
import mobileUi from "./mobileUi.ts?raw";
import acceptance from "./acceptanceDialog.ts?raw";

describe("production Goal inception UI", () => {
  it("boots explicit empty V2 intent capture with semantic owner controls", () => {
    expect(main).toContain("createGoalRoom({ ownerIntent: null })");
    expect(main).not.toContain("Legacy pre-admitted Goal");
    expect(html).toContain('id="desktop-room"');
    expect(html).toContain('id="mobile-room"');
    expect(desktopUi).toContain('label.htmlFor = input.id');
    expect(desktopUi).toContain("input.maxLength = 1000");
    expect(desktopUi).toContain("createDesktopSurface");
    expect(mobileUi).toContain("createMobileSurface");
  });

  it("routes Goal and Plan owner decisions through the owner controller", () => {
    expect(main).toContain("controller.setOwnerIntent");
    expect(main).toContain("controller.confirmGoalContract");
    expect(main).toContain("controller.requestGoalRevision");
    expect(main).toContain("controller.confirmPlan");
    expect(main).toContain("controller.requestRevision");
  });

  it("requires exact-candidate modal confirmation before the controller acceptance path", () => {
    expect(html).toContain('id="acceptance-dialog"');
    expect(html).toContain('aria-labelledby="acceptance-dialog-title"');
    expect(html).toContain('id="acceptance-candidate-digest"');
    expect(main).toContain("acceptanceDialog.open");
    expect(main).toContain("controller.acceptGoal()");
    expect(acceptance).toContain('addEventListener("cancel"');
    expect(acceptance).toContain('addEventListener("submit"');
    expect(acceptance).not.toContain("room.dispatch");
  });

  it("does not expose an owner path that performs agent or system actions", () => {
    expect(html).not.toContain('id="advance-demo"');
    expect(main).not.toContain('requiredElement<HTMLButtonElement>("advance-demo")');
    expect(main).not.toContain("runDemoAction");
    expect(main).not.toContain('actor: "agent"');
    expect(main).not.toContain("verifyActiveCandidate");
  });

  it("renders authority-adjacent prose as literal text without innerHTML", () => {
    expect(main).not.toMatch(/\.innerHTML\s*=/);
    expect(desktopUi).not.toMatch(/\.innerHTML\s*=/);
    expect(mobileUi).not.toMatch(/\.innerHTML\s*=/);
    expect(desktopUi).toContain("node.textContent = value");
    expect(desktopUi).toContain("event.text");
  });
});
