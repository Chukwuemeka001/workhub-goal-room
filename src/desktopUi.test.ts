/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import html from "../index.html?raw";
import main from "./main.ts?raw";
import desktopUi from "./desktopUi.ts?raw";
import packageJson from "../package.json?raw";
import vite from "../vite.config.ts?raw";
import desktopFixture from "../qa/desktop-fixture.ts?raw";
import desktopQa from "../scripts/desktop-qa.mjs?raw";

const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
const desktopCss = readFileSync(new URL("./desktop.css", import.meta.url), "utf8");

function relativeLuminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground: string, background: string) {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("production desktop Mission Room", () => {
  it("keeps quiet normal-sized text at WCAG AA contrast on every desktop surface", () => {
    const quiet = desktopCss.match(/--d-quiet:\s*(#[0-9a-f]{6})/i)?.[1];
    expect(quiet).toBeDefined();
    for (const background of ["#090a0b", "#101214", "#0d0f10", "#101315"]) {
      expect(contrast(quiet!, background), `${quiet} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("qualifies the V3 chapter rail above fold without promoting collapsed lifecycle detail", () => {
    expect(desktopFixture).toContain("chapterRailAboveFold");
    expect(desktopQa).toContain("!entry.chapterRailAboveFold");
    expect(desktopQa).not.toContain("!entry.lifecycleAboveFold");
  });

  it("uses a separate desktop composition in required Goal-to-progressive-detail order", () => {
    expect(html).toContain('id="desktop-room"');
    expect(desktopUi).toContain("root.replaceChildren(goalHeader, stateBar, custody, workspace, progressive)");
    expect(desktopUi).toContain('setAttribute("role", "tablist")');
    expect(desktopUi).toContain('setAttribute("role", "tab")');
    expect(desktopUi).toContain('setAttribute("role", "tabpanel")');
    expect(desktopCss).toContain(".desktop-now");
    expect(desktopCss).not.toContain("desktop-equal-card-grid");
  });

  it("renders canonical custody and a collapsed non-interactive static-six tool disclosure", () => {
    expect(desktopUi).toContain('"desktop-custody"');
    expect(desktopUi).toContain("view.custody.lanes");
    expect(desktopUi).toContain('setAttribute("aria-current", "true")');
    expect(desktopUi).toContain("view.toolSurface.tools");
    expect(desktopUi).toContain('text("summary", "Agent tools · static six")');
    expect(desktopUi).not.toMatch(/view\.toolSurface\.tools[\s\S]{0,500}text\("button"/);
  });

  it("exposes only shared controller-backed owner controls and literal rendering", () => {
    for (const method of ["setOwnerIntent", "confirmGoalContract", "requestGoalRevision", "confirmPlan", "requestRevision", "acceptGoal"]) expect(main).toContain(`controller.${method}`);
    expect(desktopUi).not.toContain("room.dispatch");
    expect(main).not.toContain('actor: "agent"');
    expect(main).not.toContain("verifyActiveCandidate");
    expect(desktopUi).not.toMatch(/\.innerHTML\s*=/);
    expect(desktopUi).toContain("node.textContent = value");
    expect(desktopUi).toContain('"TERMINAL · OWNER ACCEPTED"');
  });

  it("implements automatic tab focus selection with Arrow/Home/End and no authority callback", () => {
    for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) expect(desktopUi).toContain(`"${key}"`);
    expect(desktopUi).toContain("onSelectTab");
    expect(desktopUi).toContain("selectedTab: () => activeTab");
    expect(desktopUi).toContain("?.focus()");
  });

  it("keeps desktop and mobile mutually absent from the other breakpoint AX tree with safe controls", () => {
    expect(css).toContain(".desktop-surface { display: none;");
    expect(css).toContain(".mobile-room { display: none;");
    expect(desktopCss).toMatch(/desktop-action[\s\S]*min-height:\s*44px/);
    expect(css).toContain("overflow-wrap: anywhere");
    expect(desktopCss).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  it("keeps the deterministic desktop fixture outside production inputs", () => {
    expect(html).not.toContain("desktop-fixture");
    expect(main).not.toContain("desktop-fixture");
    expect(vite).not.toContain("qa/desktop-fixture");
    expect(packageJson).toContain('"qa:desktop": "node scripts/desktop-qa.mjs"');
  });
});
