/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
const desktop = readFileSync(new URL("../src/desktop.css", import.meta.url), "utf8");
const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

describe("Goal Room V3 responsive and editorial contract", () => {
  it("switches to the distinct mobile composition below 1200px", () => {
    expect(style).toContain("@media (max-width: 1199px)");
    expect(style).toContain("@media (min-width: 1200px)");
    expect(style).toMatch(/@media \(max-width: 1199px\)[\s\S]*\.desktop-surface \{ display: none;/);
    expect(desktop).toContain("@media (max-width: 1199px)");
  });

  it("styles the desktop custody lane, editorial workspace, and collapsed static-six disclosure", () => {
    for (const selector of [
      ".desktop-state-bar",
      ".desktop-custody",
      ".desktop-custody-lane",
      ".desktop-workspace",
      ".desktop-tools",
      ".desktop-tool-list",
      ".desktop-candidate-history",
    ]) expect(desktop).toContain(selector);
    expect(desktop).toMatch(/\.desktop-detail summary[^}]*min-height:\s*44px/);
  });

  it("keeps targets, focus, safe-area docking, hostile wrapping, and reduced motion explicit", () => {
    expect(style).toMatch(/\.mobile-button,\s*\.mobile-tab[\s\S]*min-height:\s*44px/);
    expect(style).toContain("env(safe-area-inset-bottom)");
    expect(style).toContain(":focus-visible");
    expect(style).toContain("overflow-wrap: anywhere");
    expect(style).toContain("@media (prefers-reduced-motion: reduce)");
    expect(desktop).toContain(":focus-visible");
    expect(desktop).toMatch(/overflow-wrap:\s*anywhere/);
    expect(desktop).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)/);
  });

  it("keeps qualification code outside production entry points", () => {
    expect(index).not.toMatch(/qualification\//);
    expect(main).not.toMatch(/qualification\//);
  });
});
