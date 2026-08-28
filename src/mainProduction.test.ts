import { describe, expect, it } from "vitest";
import html from "../index.html?raw";
import main from "./main.ts?raw";

describe("production Goal inception UI", () => {
  it("boots explicit empty V2 intent capture with semantic owner controls", () => {
    expect(main).toContain("createGoalRoom({ ownerIntent: null })");
    expect(main).not.toContain("Legacy pre-admitted Goal");
    expect(html).toContain('id="owner-intent-form"');
    expect(html).toContain('for="owner-intent-input"');
    expect(html).toContain('maxlength="1000"');
    expect(html).toContain('id="goal-history"');
    expect(html).toContain('id="goal-contract-status"');
  });

  it("routes Goal and Plan owner decisions through the owner controller", () => {
    expect(main).toContain("controller.setOwnerIntent");
    expect(main).toContain("controller.confirmGoalContract");
    expect(main).toContain("controller.requestGoalRevision");
    expect(main).toContain("controller.confirmPlan");
    expect(main).toContain("controller.requestRevision");
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
    expect(main).toContain("goalHistory.replaceChildren");
    expect(main).toContain("textContent = event.text");
  });
});
