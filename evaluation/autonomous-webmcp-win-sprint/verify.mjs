#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const normalize = (path) => path.split(sep).join("/");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function git(repoRoot, ...args) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: null });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr?.toString()}`);
  return result.stdout;
}

async function inventory(directory) {
  const found = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name);
      assert.equal(entry.isSymbolicLink(), false, `symlink not allowed: ${normalize(relative(directory, absolute))}`);
      if (entry.isDirectory()) await visit(absolute);
      else {
        assert.equal(entry.isFile(), true, `non-file entry not allowed: ${normalize(relative(directory, absolute))}`);
        found.push(normalize(relative(directory, absolute)));
      }
    }
  }
  await visit(directory);
  return found.sort();
}

function assertSafePath(path) {
  assert.equal(typeof path, "string");
  assert.equal(path.startsWith("/"), false, `absolute inventory path: ${path}`);
  assert.equal(path.includes("\\"), false, `non-normalized inventory path: ${path}`);
  assert.equal(path.split("/").includes(".."), false, `parent traversal in inventory path: ${path}`);
}

function scanText(path, bytes) {
  if (/\.(png|jpe?g|gif|webp|mp4|mov|pdf)$/i.test(path)) return;
  const text = bytes.toString("utf8");
  const userPathPattern = new RegExp(["/", "Users", "/"].join(""));
  const bearerPattern = /Bearer\s+([A-Za-z0-9._-]{12,})/gi;
  for (const match of text.matchAll(bearerPattern)) {
    assert.equal(match[1], "evaluation-client", `${path}: bearer secret leaked`);
  }
  const jsonSecretPattern = /["'](?:access_token|refresh_token|api_key|client_secret)["']\s*:\s*["']([^"']+)["']/gi;
  const allowedJsonPlaceholders = new Set(["[REDACTED]", "REDACTED", "placeholder", "example"]);
  for (const match of text.matchAll(jsonSecretPattern)) {
    assert.equal(allowedJsonPlaceholders.has(match[1]), true, `${path}: JSON secret leaked`);
  }
  const secretPatterns = [
    userPathPattern,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(?:ghp|github_pat|xox[baprs]|sk-proj)-[A-Za-z0-9_-]{16,}\b/,
  ];
  for (const pattern of secretPatterns) assert.equal(pattern.test(text), false, `${path}: secret or private-path pattern leaked: ${pattern}`);
}

const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.kind, "workhub-autonomous-webmcp-win-sprint-evidence");

const listedPaths = manifest.files.map((row) => row.path);
for (const path of listedPaths) assertSafePath(path);
assert.equal(new Set(listedPaths).size, listedPaths.length, "duplicate manifest path");
const actualPaths = (await inventory(root)).filter((path) => path !== "manifest.json");
assert.deepEqual([...listedPaths].sort(), actualPaths, "package inventory differs from manifest");

for (const row of manifest.files) {
  const bytes = await readFile(join(root, row.path));
  assert.equal(bytes.length, row.bytes, `${row.path}: byte mismatch`);
  assert.equal(sha256(bytes), row.sha256, `${row.path}: SHA-256 mismatch`);
  scanText(row.path, bytes);
}

const repoRoot = resolve(argument("--repo-root") ?? join(root, "../.."));
assert.match(manifest.testedProduct.baseCommit, /^[0-9a-f]{40}$/);
git(repoRoot, "cat-file", "-e", `${manifest.testedProduct.baseCommit}^{commit}`);
assert.ok(Array.isArray(manifest.testedProduct.trackedDiffPaths));
assert.ok(manifest.testedProduct.trackedDiffPaths.length > 0);
for (const path of manifest.testedProduct.trackedDiffPaths) assertSafePath(path);
const trackedDiff = git(repoRoot, "diff", "--binary", manifest.testedProduct.baseCommit, "--", ...manifest.testedProduct.trackedDiffPaths);
assert.equal(sha256(trackedDiff), manifest.testedProduct.trackedDiffSha256, "tracked product diff binding mismatch");
for (const row of manifest.testedProduct.candidateSourceHashes) {
  assertSafePath(row.path);
  const bytes = await readFile(join(repoRoot, row.path));
  assert.equal(bytes.length, row.bytes, `${row.path}: candidate source byte mismatch`);
  assert.equal(sha256(bytes), row.sha256, `${row.path}: candidate source SHA-256 mismatch`);
}

const ownerGate = JSON.parse(await readFile(join(root, "receipts/owner-gate-01.json"), "utf8"));
const positive = JSON.parse(await readFile(join(root, "receipts/positive-01.json"), "utf8"));
const ownerSetup = JSON.parse(await readFile(join(root, "receipts/positive-owner-setup.json"), "utf8"));
assert.deepEqual(ownerGate.modelSelectedCalls.map((row) => row.name), ["get_goal_room_state", "get_goal_room_state"]);
assert.equal(ownerGate.score.classification, "behavioral_failure");
assert.equal(ownerGate.initialEvaluatorState.currentStateVersion, 0);
assert.equal(ownerGate.finalEvaluatorState.currentStateVersion, 0);
assert.equal(ownerGate.finalDom.receiptCount, 0);
assert.equal(ownerSetup.before.stateVersion, 0);
assert.equal(ownerSetup.after.stateVersion, 1);
assert.deepEqual(positive.modelSelectedCalls.map((row) => row.name), ["get_goal_room_state", "propose_goal_contract", "get_goal_room_state"]);
assert.equal(positive.score.classification, "behavioral_failure");
assert.equal(positive.modelSelectedCalls[1].arguments.expectedStateVersion, 1);
assert.equal(positive.modelSelectedCalls[1].result.accepted, true);
assert.equal(positive.finalEvaluatorState.currentStateVersion, 2);
assert.equal(positive.finalEvaluatorState.currentActor, "owner");
assert.equal(positive.finalEvaluatorState.nextLegalAction, "OWNER_CONFIRM_OR_REVISE_GOAL");
for (const receipt of [ownerGate, positive]) {
  for (const row of receipt.sourceBinding) {
    const bytes = await readFile(join(root, "harness", row.name));
    assert.equal(bytes.length, row.bytes, `${row.name}: source bytes mismatch`);
    assert.equal(sha256(bytes), row.sha256, `${row.name}: source hash mismatch`);
  }
}
console.log(JSON.stringify({ passed: true, files: manifest.files.length, ownerGate: ownerGate.score, positive: positive.score, acceptedGoalProposal: true, finalFrontier: positive.finalEvaluatorState.nextLegalAction }));
