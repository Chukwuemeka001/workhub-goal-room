/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import html from "../index.html?raw";
import main from "./main.ts?raw";
import mobileUi from "./mobileUi.ts?raw";
import vite from "../vite.config.ts?raw";
import packageJson from "../package.json?raw";

const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");

describe("dedicated production iPhone composition", () => {
  it("has a separate mobile root while retaining the Phase 4 desktop surface", () => {
    expect(html).toContain('id="mobile-room"');
    expect(html).toContain('class="desktop-surface"');
    expect(html.indexOf('</main>\n    </div>')).toBeLessThan(html.indexOf('<dialog id="revision-dialog"'));
    expect(main).toContain("createMobileSurface");
    expect(css).toContain("@media (max-width: 1199px)");
    expect(css).toContain(".desktop-surface { display: none;")
    expect(css).toContain("@media (min-width: 1200px)");
    expect(css).toContain(".mobile-room { display: none;")
  });

  it("builds Goal-to-details DOM order and semantic tabs without authoritative HTML injection", () => {
    expect(mobileUi).toContain('aria-label", "Goal status"');
    expect(mobileUi).toContain("root.replaceChildren(header, chapter, frontier, details)");
    expect(mobileUi).toContain("details.append(actionDock, tablist, panel)");
    expect(mobileUi).toContain('setAttribute("role", "tab")');
    expect(mobileUi).toContain('setAttribute("role", "tabpanel")');
    expect(mobileUi).toContain('setAttribute("aria-live", "polite")');
    expect(mobileUi).not.toMatch(/\.innerHTML\s*=/);
    expect(mobileUi).toContain("node.textContent = value");
    expect(mobileUi).toContain('text("h1", view.goal.title');
  });

  it("uses Goal, Plan, Proof, Activity destinations with Goal selected first", () => {
    expect(mobileUi).toContain('let activeTab: MobileTabId = "goal"');
    for (const id of ["goal", "plan", "proof", "activity"]) expect(mobileUi).toContain(`activeTab === "${id}"`);
    expect(mobileUi).not.toContain('activeTab === "now"');
  });

  it("exposes only controller-backed owner controls and authority-neutral tab switching", () => {
    for (const method of ["setOwnerIntent", "confirmGoalContract", "requestGoalRevision", "confirmPlan", "requestRevision", "acceptGoal"]) {
      expect(main).toContain(`controller.${method}`);
    }
    expect(mobileUi).toContain("onSelectTab");
    expect(mobileUi).not.toContain("room.dispatch");
    expect(main).not.toContain('actor: "agent"');
    expect(main).not.toContain("verifyActiveCandidate");
  });

  it("keeps the QA fixture outside production entry and build inputs", () => {
    expect(main).not.toContain("mobile-fixture");
    expect(html).not.toContain("mobile-fixture");
    expect(vite).not.toContain("qa/mobile-fixture");
    expect(packageJson).toContain('"qa:mobile": "node scripts/mobile-qa.mjs"');
  });

  it("contains mobile text and touch targets across safe areas without clipping authority", () => {
    expect(css).toContain("env(safe-area-inset-bottom)");
    expect(css).toMatch(/min-height:\s*44px/);
    expect(css).toContain("overflow-wrap: anywhere");
    expect(css).toContain("min-width: 0");
    expect(css).toContain("focus-visible");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).not.toContain("mobile-authority-ellipsis");
  });
});
