import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporaryParent = mkdtempSync(join(tmpdir(), "phase5-validator-"));
const sandbox = join(temporaryParent, "candidate");
cpSync(root, sandbox, {
  recursive: true,
  filter: (source) => ![".git", "node_modules"].includes(basename(source)),
});
const journeyPath = join(sandbox, "evaluation/production-journey/journey.json");
const baselineJourney = JSON.parse(readFileSync(journeyPath, "utf8"));

function runValidator(journey) {
  writeFileSync(journeyPath, `${JSON.stringify(journey, null, 2)}\n`);
  return spawnSync(process.execPath, ["scripts/phase5-validate.mjs"], {
    cwd: sandbox,
    encoding: "utf8",
  });
}

function cloneJourney() {
  return structuredClone(baselineJourney);
}

function expectRejected(name, mutate) {
  test(name, () => {
    const journey = cloneJourney();
    mutate(journey.accessibility);
    const result = runValidator(journey);
    assert.notEqual(
      result.status,
      0,
      `validator accepted weakened evidence\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  });
}

test("committed Phase 5 evidence passes validation", () => {
  const result = runValidator(cloneJourney());
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("requires the current Now tab selector and rejects the retired Goal tab selector", () => {
  const current = runValidator(cloneJourney());
  assert.equal(current.status, 0, `validator rejected current Now evidence\n${current.stdout}\n${current.stderr}`);

  const retired = cloneJourney();
  const now = retired.accessibility.zoom200.requiredContent.find((row) => row.selector === "#mobile-tab-now");
  assert.ok(now, "fresh producer evidence must include #mobile-tab-now");
  now.selector = "#mobile-tab-goal";
  const result = runValidator(retired);
  assert.notEqual(result.status, 0, `validator accepted retired Goal evidence\n${result.stdout}\n${result.stderr}`);
});

expectRejected("rejects a zoom receipt reduced from twelve required targets to eight", ({ zoom200 }) => {
  zoom200.requiredContent = zoom200.requiredContent.slice(0, 8);
});

expectRejected("rejects an unnamed sole AX main", ({ zoom200 }) => {
  zoom200.composition.axMainNames = [""];
});

expectRejected("requires every contrast category in the mobile composition", ({ contrast }) => {
  for (const row of contrast.inventory.filter((row) => row.composition === "mobile")) row.category = "normal-text";
});

expectRejected("rejects a lowered normal-text threshold", ({ contrast }) => {
  for (const row of contrast.inventory.filter((row) => row.category === "normal-text")) row.threshold = 3;
});

expectRejected("rejects focus evidence without an actual solid three-pixel focus outline", ({ contrast }) => {
  for (const row of contrast.inventory.filter((row) => row.category === "focus-indicator")) {
    row.focused = false;
    row.outlineStyle = "none";
    row.outlineWidth = "0px";
  }
});

expectRejected("rejects a forged ratio that cannot be recomputed from its colors", ({ contrast }) => {
  contrast.inventory[0].ratio = 99;
});

expectRejected("rejects an empty per-row contrast composition", ({ contrast }) => {
  contrast.inventory[0].composition = "";
});

expectRejected("rejects the independent reviewer's combined weakened receipt", ({ zoom200, contrast }) => {
  zoom200.requiredContent = zoom200.requiredContent.slice(0, 8);
  zoom200.composition.axMainNames = [""];
  for (const row of contrast.inventory) {
    if (row.composition === "mobile") row.category = "normal-text";
    if (row.category === "normal-text") row.threshold = 3;
    if (row.category === "focus-indicator") {
      row.focused = false;
      row.outlineStyle = "none";
      row.outlineWidth = "0px";
    }
  }
});

test.after(() => {
  rmSync(temporaryParent, { recursive: true, force: true });
});
