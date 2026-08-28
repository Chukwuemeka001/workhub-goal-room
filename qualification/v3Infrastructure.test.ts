/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("Goal Room V3 qualification infrastructure", () => {
  it("binds the visual contract and translation ledger to S09 and PASS boundaries", () => {
    const visualContract = read("design/GOAL_ROOM_V3_VISUAL_CONTRACT.md");
    const ledger = read("design/TRANSLATION_LEDGER.md");
    expect(visualContract).toContain("`0-1199px`");
    expect(visualContract).toContain("`1200px+`");
    expect(visualContract).toContain("S09 is the only synthetic presentation state");
    expect(visualContract).toContain("`PASS` means");
    expect(ledger).toContain("Fourteen-story replay");
    expect(ledger).toContain("Synthetic/test-only transient label over canonical bytes");
    expect(ledger).toContain("Only S14 is accepted");
  });

  it("provides production-excluded visual, responsive, accessibility, hostile, fixture, byte, and receipt checks", () => {
    const packageJson = JSON.parse(read("package.json"));
    expect(packageJson.scripts).toMatchObject({
      "qa:v3:visual": "node scripts/v3-browser-qa.mjs visual",
      "qa:v3:responsive": "node scripts/v3-browser-qa.mjs responsive",
      "qa:v3:a11y": "node scripts/v3-browser-qa.mjs a11y",
      "qa:v3:hostile": "node scripts/v3-browser-qa.mjs hostile",
      "qa:v3:fixtures": "node scripts/v3-fixture-exclusion.mjs",
      "qa:v3:protected": "node scripts/v3-protected-bytes.mjs",
      "qa:v3:receipt": "node scripts/v3-receipt.mjs",
    });
    for (const path of [
      "qualification/v3-fixture.html",
      "qualification/v3-fixture.ts",
      "scripts/v3-browser-qa.mjs",
      "scripts/v3-fixture-exclusion.mjs",
      "scripts/v3-protected-bytes.mjs",
      "scripts/v3-receipt.mjs",
    ]) expect(existsSync(new URL(path, root)), path).toBe(true);
  });

  it("keeps qualification references out of production entries and guards all five protected files", () => {
    expect(read("index.html")).not.toMatch(/qualification\//);
    expect(read("src/main.ts")).not.toMatch(/qualification\//);
    const guard = read("scripts/v3-protected-bytes.mjs");
    for (const path of [
      "src/core/goalRoom.ts",
      "src/ownerController.ts",
      "src/verifier/releaseRules.ts",
      "src/webmcp.ts",
      "src/webmcp-globals.d.ts",
    ]) expect(guard).toContain(path);
  });

  it("ships no visible em dash or en dash in production entry copy", () => {
    for (const path of ["index.html", "src/main.ts", "src/desktopUi.ts", "src/mobileUi.ts", "src/ownerView.ts"]) {
      expect(read(path), path).not.toMatch(/[—–]/);
    }
  });
});
