/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import desktopUi from "./desktopUi.ts?raw";
import mobileUi from "./mobileUi.ts?raw";
import quickstart from "./releaseQuickstart.ts?raw";

const desktopCss = readFileSync(new URL("./desktop.css", import.meta.url), "utf8");
const mobileCss = readFileSync(new URL("./style.css", import.meta.url), "utf8");

describe("Release Guardian judge-first UI", () => {
  it("leads both fresh-room compositions with a concrete release authorization problem", () => {
    for (const source of [desktopUi, mobileUi]) {
      expect(source).toContain("A passing agent build is not an authorized release.");
      expect(source).toContain("Agent contributes. System verifies. Owner accepts the exact candidate.");
      expect(source).toContain("Use release-review example");
      expect(source).toContain("Copy agent launch prompt");
      expect(source).toContain("prefillReleaseReviewIntent(input)");
      expect(source).toContain("copyAgentLaunchPrompt");
    }
  });

  it("keeps quickstart behavior observational and outside every authority seam", () => {
    expect(quickstart).not.toContain("room.dispatch");
    expect(quickstart).not.toContain("controller.");
    expect(quickstart).not.toContain("verifyActiveCandidate");
    expect(quickstart).not.toContain("registerTool");
    expect(quickstart).toContain("input.value = RELEASE_REVIEW_INTENT");
    expect(quickstart).toContain("clipboard.writeText(AGENT_LAUNCH_PROMPT)");
    for (const source of [desktopUi, mobileUi]) {
      expect(source).not.toContain('actor: "agent"');
      expect(source).not.toContain("room.dispatch");
    }
  });

  it("makes the concrete release risk the dominant fresh-room headline", () => {
    expect(desktopUi).toContain('const nowTitle = view.ownerAction.kind === "set-intent"');
    expect(mobileUi).toContain('const frontierTitle = view.actionDock.kind === "set-intent"');
    for (const source of [desktopUi, mobileUi]) {
      expect(source).toContain('"A passing agent build is not an authorized release."');
      expect(source).toContain('"Agent contributes. System verifies. Owner accepts the exact candidate."');
    }
  });

  it("preserves the canonical live legal action and boundary under the explanatory headline", () => {
    expect(desktopUi).toContain("const nowLegalAction = view.now.legalAction;");
    expect(desktopUi).toContain("const nowBoundary = view.now.boundary;");
    expect(mobileUi).toContain("const frontierLive = view.frontier.liveText;");
    expect(mobileUi).toContain("const frontierBoundary = view.frontier.boundary;");
  });

  it("gives the quickstart a bounded responsive visual hierarchy", () => {
    expect(desktopCss).toContain(".desktop-release-quickstart");
    expect(desktopCss).toContain(".desktop-agent-prompt code");
    expect(desktopCss).toContain(".desktop-owner-action:has(.desktop-release-quickstart)");
    expect(mobileCss).toContain(".mobile-release-quickstart");
    expect(mobileCss).toContain(".mobile-agent-prompt code");
    expect(mobileCss).toMatch(/mobile-release-quickstart[\s\S]{0,1200}overflow-wrap:\s*anywhere/);
  });

  it("states the real scope instead of implying deployment or autonomous execution", () => {
    expect(quickstart).toContain("stop whenever Owner action is required");
    expect(quickstart).not.toMatch(/deploy(?:s|ed|ment) the release/i);
    expect(quickstart).not.toMatch(/autonomous runtime/i);
  });
});
