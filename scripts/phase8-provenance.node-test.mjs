import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const repo = resolve(import.meta.dirname, "..");
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();

test("Phase 8 visual evidence identifies the exact latest production-input commit", () => {
  const expectedCommit = git("log", "-1", "--format=%H", "--", "index.html", "package.json", "vite.config.ts", "src");
  const expectedTree = git("rev-parse", `${expectedCommit}^{tree}`);
  const root = mkdtempSync(join(tmpdir(), "phase8-provenance-"));
  const checkout = join(root, "checkout");
  try {
    execFileSync("git", ["-C", repo, "worktree", "add", "--detach", checkout, "HEAD"], { stdio: "ignore" });
    copyFileSync(join(repo, "scripts/phase8-visual-qa.mjs"), join(checkout, "scripts/phase8-visual-qa.mjs"));
    symlinkSync(join(repo, "node_modules"), join(checkout, "node_modules"));
    const run = spawnSync("node", ["scripts/phase8-visual-qa.mjs"], { cwd: checkout, encoding: "utf8", timeout: 120_000 });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const evidence = JSON.parse(readFileSync(join(checkout, "evaluation/phase8/visual-max-hostile.json"), "utf8"));
    assert.equal(evidence.testedProductionCommit, expectedCommit);
    assert.equal(evidence.testedProductionTree, expectedTree);
  } finally {
    try { execFileSync("git", ["-C", repo, "worktree", "remove", "--force", checkout], { stdio: "ignore" }); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});
