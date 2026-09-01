import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  admitConnectedRequest,
  canonicalDigest,
  collectConnectedAssurance,
  observeRepository,
  parseTreeEntries,
} from "./agent-change-assurance-connected.mjs";

const git = (cwd, ...args) => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const commitAll = (root, message) => { git(root, "add", "-A"); git(root, "commit", "-qm", message); return git(root, "rev-parse", "HEAD"); };
const makeRepo = async () => {
  const root = await mkdtemp(join(tmpdir(), "aca-connected-test-"));
  git(root, "init", "-q"); git(root, "config", "user.email", "test@example.invalid"); git(root, "config", "user.name", "ACA Test");
  await writeFile(join(root, "base.txt"), "base\n");
  const base = commitAll(root, "base");
  await mkdir(join(root, "src")); await writeFile(join(root, "src", "change.txt"), "one\ntwo\n");
  const candidate = commitAll(root, "candidate");
  return { root, base, candidate };
};

const empty = {};
test("browser request is an exact empty plain object", () => {
  assert.deepEqual(admitConnectedRequest(empty), {});
  for (const key of ["candidate", "candidateSha", "base", "baseSha", "ref", "claims", "root", "path", "check", "command", "argv", "env", "timeout", "output", "scratch"]) {
    assert.equal(admitConnectedRequest({ [key]: key === "claims" ? [] : "x" }), null, key);
  }
  assert.equal(admitConnectedRequest(Object.create({ base: "x" })), null);
  assert.equal(admitConnectedRequest([]), null);
});

test("explicit full startup base is mandatory and never guessed", async (t) => {
  const repo = await makeRepo(); t.after(() => rm(repo.root, { recursive: true, force: true }));
  await assert.rejects(() => observeRepository(repo.root, undefined, empty), /BASE_UNRESOLVED/);
  await assert.rejects(() => observeRepository(repo.root, "HEAD^", empty), /BASE_UNRESOLVED/);
  await assert.rejects(() => observeRepository(repo.root, "f".repeat(40), empty), /BASE_UNRESOLVED/);
  await assert.rejects(() => observeRepository(repo.root, repo.candidate, empty), /EMPTY_CHANGE/);
});

test("explicit base distinguishes divergence and merge/root semantics", async (t) => {
  const repo = await makeRepo(); t.after(() => rm(repo.root, { recursive: true, force: true }));
  git(repo.root, "checkout", "-qb", "other", repo.base); await writeFile(join(repo.root, "other.txt"), "other\n"); const other = commitAll(repo.root, "other");
  await assert.rejects(() => observeRepository(repo.root, repo.candidate, empty), /BASE_NOT_ANCESTOR/);
  const primary = git(repo.root, "for-each-ref", "--format=%(refname:short)", "--contains", repo.candidate).split("\n").find((name) => name !== "other");
  git(repo.root, "checkout", "-q", primary); git(repo.root, "merge", "-q", "--no-ff", "other", "-m", "merge");
  const merged = await observeRepository(repo.root, repo.base, empty);
  assert.equal(merged.candidate.commit, git(repo.root, "rev-parse", "HEAD"));
  assert.equal(merged.configuredBase, repo.base);
  assert.equal(merged.resolvedBase, repo.base);
  assert.ok(merged.changedPaths.some((row) => row.path === "other.txt"));
  git(repo.root, "checkout", "-q", repo.base);
  await assert.rejects(() => observeRepository(repo.root, repo.base, empty), /EMPTY_CHANGE/);
  assert.notEqual(other, repo.candidate);
});

test("observes exact Git objects, deterministic diff digests, and dirty inventories separately", async (t) => {
  const repo = await makeRepo(); t.after(() => rm(repo.root, { recursive: true, force: true }));
  await writeFile(join(repo.root, "base.txt"), "dirty\n"); await writeFile(join(repo.root, "untracked.txt"), "not candidate\n");
  const observed = await observeRepository(repo.root, repo.base, empty);
  assert.equal(observed.candidate.commit, repo.candidate);
  assert.equal(observed.base.commit, repo.base);
  assert.equal(observed.trackedState, "DIRTY");
  assert.equal(observed.untrackedCount, 1);
  assert.match(observed.trackedDigest, /^[0-9a-f]{64}$/);
  assert.match(observed.untrackedInventoryDigest, /^[0-9a-f]{64}$/);
  assert.match(observed.manifestDigest, /^[0-9a-f]{64}$/);
  assert.match(observed.diffDigest, /^[0-9a-f]{64}$/);
  assert.match(observed.statusDigest, /^[0-9a-f]{64}$/);
  assert.match(observed.numstatDigest, /^[0-9a-f]{64}$/);
  assert.match(observed.patchDigest, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(observed).includes(repo.root), false);
});

test("tree parser is fatal for UTF-8, noncanonical, duplicate, case and Unicode collisions, modes, and limits", () => {
  const oid = "a".repeat(40);
  const row = (mode, path) => Buffer.from(`${mode} blob ${oid}\t${path}\0`);
  assert.throws(() => parseTreeEntries(Buffer.concat([Buffer.from(`100644 blob ${oid}\t`), Buffer.from([0xff, 0])])), /TREE_PATH_INVALID_UTF8/);
  for (const path of ["../x", "/x", "x\\y", "a//b", "a/./b"]) assert.throws(() => parseTreeEntries(row("100644", path)), /TREE_PATH_NONCANONICAL/);
  assert.throws(() => parseTreeEntries(Buffer.concat([row("100644", "x"), row("100644", "x")])), /TREE_PATH_DUPLICATE/);
  assert.throws(() => parseTreeEntries(Buffer.concat([row("100644", "Readme"), row("100644", "README")])), /TREE_PATH_COLLISION/);
  assert.throws(() => parseTreeEntries(Buffer.concat([row("100644", "é"), row("100644", "é")])), /TREE_PATH_COLLISION/);
  assert.throws(() => parseTreeEntries(row("120000", "link")), /TREE_MODE_UNSUPPORTED/);
  assert.throws(() => parseTreeEntries(row("160000", "submodule")), /TREE_MODE_UNSUPPORTED/);
  assert.throws(() => parseTreeEntries(row("100644", "x".repeat(501))), /TREE_PATH_LIMIT/);
  assert.throws(() => parseTreeEntries(Buffer.concat([row("100644", "a"), row("100644", "b")] ), { maxFiles: 1 }), /TREE_FILE_COUNT_LIMIT/);
});

test("manifest binds executable mode and content and enforces file and aggregate size", async (t) => {
  const repo = await makeRepo(); t.after(() => rm(repo.root, { recursive: true, force: true }));
  await writeFile(join(repo.root, "run.sh"), "#!/bin/sh\nexit 0\n"); await chmod(join(repo.root, "run.sh"), 0o755); const candidate = commitAll(repo.root, "executable");
  const observed = await observeRepository(repo.root, repo.candidate, empty);
  assert.equal(observed.candidate.commit, candidate);
  assert.equal(observed.manifest.some((entry) => entry.path === "run.sh" && entry.mode === "100755"), true);
  await assert.rejects(() => observeRepository(repo.root, repo.candidate, empty, { limits: { maxFileBytes: 1 } }), /TREE_FILE_SIZE_LIMIT/);
  await assert.rejects(() => observeRepository(repo.root, repo.candidate, empty, { limits: { maxAggregateBytes: 1 } }), /TREE_AGGREGATE_SIZE_LIMIT/);
});

test("branch or HEAD movement after acquisition is SOURCE_MOVED and withholds a result", async (t) => {
  const repo = await makeRepo(); t.after(() => rm(repo.root, { recursive: true, force: true }));
  await assert.rejects(() => observeRepository(repo.root, repo.base, empty, { afterObservation: async () => {
    await writeFile(join(repo.root, "moved.txt"), "move\n"); commitAll(repo.root, "move");
  } }), /SOURCE_MOVED/);
});

test("production collector never executes candidate scripts and fails executable checks closed without sandbox", async (t) => {
  const repo = await makeRepo(); t.after(() => rm(repo.root, { recursive: true, force: true }));
  const marker = join(repo.root, "candidate-script-ran");
  const outside = join(tmpdir(), `aca-outside-${process.pid}`);
  t.after(() => rm(outside, { force: true }));
  await writeFile(join(repo.root, "attack.mjs"), `import {readFileSync,writeFileSync} from 'node:fs'; import {spawn} from 'node:child_process'; import {connect} from 'node:net'; readFileSync('.git/HEAD'); readFileSync(process.env.HOME+'/.gitconfig'); writeFileSync(${JSON.stringify(outside)},'outside'); connect(9,'127.0.0.1'); spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true}); writeFileSync('disk.bin',Buffer.alloc(1024*1024));`);
  await writeFile(join(repo.root, "package.json"), JSON.stringify({ scripts: { test: "node attack.mjs", build: "node attack.mjs" } }));
  await writeFile(join(repo.root, "vite.config.ts"), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'vite')`);
  await writeFile(join(repo.root, "vitest.config.ts"), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'vitest')`);
  commitAll(repo.root, "hostile scripts");
  const envelope = await collectConnectedAssurance(repo.root, repo.base, empty);
  assert.equal(envelope.schema, "agent-change-assurance/connected-v2");
  assert.deepEqual(envelope.checks.map((check) => [check.checkId, check.state, check.reason, check.execution]), [
    ["unit", "INDETERMINATE", "SANDBOX_UNAVAILABLE", "NOT_RUN"],
    ["build", "INDETERMINATE", "SANDBOX_UNAVAILABLE", "NOT_RUN"],
  ]);
  assert.equal(envelope.sandbox.status, "UNAVAILABLE");
  assert.equal(envelope.evidenceBasis, "NO_EXECUTABLE_EVIDENCE");
  assert.equal(envelope.evaluatorSnapshot.evidence.length, 0);
  assert.equal(spawnSync("test", ["-e", marker]).status, 1);
  assert.equal(spawnSync("test", ["-e", outside]).status, 1);
  assert.equal(JSON.stringify(envelope).includes(repo.root), false);
  assert.equal(envelope.envelopeDigest, canonicalDigest({ ...envelope, envelopeDigest: undefined }));
});

test("sandbox provider default fails closed and policy-load failure has no direct fallback", async (t) => {
  const repo = await makeRepo(); t.after(() => rm(repo.root, { recursive: true, force: true }));
  let attempted = 0;
  const envelope = await collectConnectedAssurance(repo.root, repo.base, empty, { sandboxProvider: { async qualify() { attempted++; throw new Error("policy load"); } } });
  assert.equal(attempted, 1);
  assert.equal(envelope.sandbox.reason, "SANDBOX_POLICY_UNAVAILABLE");
  assert.ok(envelope.checks.every((check) => check.execution === "NOT_RUN"));
});
