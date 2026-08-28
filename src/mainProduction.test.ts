import { describe, expect, it } from "vitest";
import html from "../index.html?raw";
import main from "./main.ts?raw";
import desktopUi from "./desktopUi.ts?raw";
import mobileUi from "./mobileUi.ts?raw";
import acceptance from "./acceptanceDialog.ts?raw";
import systemVerifierAdapter from "./systemVerifierAdapter.ts?raw";

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

  it("clears revision draft, validation, and binding on every dialog close path", () => {
    expect(main).toContain('dialog.addEventListener("close", resetRevisionDialog)');
    expect(main).toContain('revisionInput.value = ""');
    expect(main).toContain('revisionInput.setCustomValidity("")');
    expect(main).toContain("revisionBinding = null");
  });

  it("requires exact-candidate modal confirmation before the controller acceptance path", () => {
    expect(html).toContain('id="acceptance-dialog"');
    expect(html).toContain('aria-labelledby="acceptance-dialog-title"');
    expect(html).toContain('id="acceptance-candidate-digest"');
    expect(main).toContain("acceptanceDialog.open");
    expect(main).toContain("controller.acceptGoal()");
    expect(main.match(/controller\.acceptGoal\(\)/g) ?? []).toHaveLength(1);
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

  it("keeps System verification behind the dedicated production adapter", () => {
    expect(main).toContain('import { createSystemVerifierAdapter } from "./systemVerifierAdapter"');
    expect(main).toContain("systemVerifier.observe(record)");
    expect(main).not.toContain("verifyActiveCandidate");
    expect(systemVerifierAdapter).toContain("room.verifyActiveCandidate(key)");
    expect(systemVerifierAdapter.match(/verifyActiveCandidate\(/g) ?? []).toHaveLength(2);
    expect(systemVerifierAdapter).not.toContain("room.dispatch");
    expect(main).not.toContain("RECORD_VERIFICATION");
    expect(desktopUi).not.toContain("RECORD_VERIFICATION");
    expect(mobileUi).not.toContain("RECORD_VERIFICATION");
    expect(html).not.toMatch(/verify[-_ ]candidate/i);
  });

  it("renders the admitted Agent result before handing observation to System", () => {
    const invocation = main.slice(main.indexOf("onInvocation: (record)"));
    expect(invocation.indexOf("formatWebMcpInvocation(record)")).toBeLessThan(
      invocation.indexOf("render(createOwnerViewModel"),
    );
    expect(invocation.indexOf("render(createOwnerViewModel")).toBeLessThan(
      invocation.indexOf("systemVerifier.observe(record)"),
    );
  });

  it("renders authority-adjacent prose as literal text without innerHTML", () => {
    expect(main).not.toMatch(/\.innerHTML\s*=/);
    expect(desktopUi).not.toMatch(/\.innerHTML\s*=/);
    expect(mobileUi).not.toMatch(/\.innerHTML\s*=/);
    expect(desktopUi).toContain("node.textContent = value");
    expect(desktopUi).toContain("event.text");
  });

  it("publishes a keyboard-discoverable judge help boundary without a reset mutation", () => {
    expect(html).toContain('<aside class="judge-help" aria-labelledby="judge-help-title">');
    expect(html).toContain('<summary id="judge-help-title">Judge help and room limits</summary>');
    expect(html).toContain("Reload starts a fresh room");
    expect(html).toContain("PASS is not owner acceptance");
    expect(html).not.toMatch(/reset[-_ ]room/i);
  });

  it("sends no referrer while leaving CSP absent until full qualifying-client proof exists", () => {
    expect(html).toContain('<meta name="referrer" content="no-referrer" />');
    expect(html).not.toMatch(/Content-Security-Policy/i);
  });
});
