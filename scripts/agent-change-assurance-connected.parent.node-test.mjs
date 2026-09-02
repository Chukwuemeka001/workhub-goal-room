import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { observeRepository, parseTreeEntries } from "./agent-change-assurance-connected.mjs";

const git = (cwd, ...args) => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const commitAll = (root, message) => {
  git(root, "add", "-A");
  git(root, "commit", "-qm", message);
  return git(root, "rev-parse", "HEAD");
};
const makeRepo = async () => {
  const root = await mkdtemp(join(tmpdir(), "aca-connected-parent-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "user.name", "ACA Parent");
  await writeFile(join(root, "base.txt"), "base\n");
  const base = commitAll(root, "base");
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "change.txt"), "change\n");
  const candidate = commitAll(root, "candidate");
  return { root, base, candidate };
};

test("configured root must equal the canonical Git top-level", async (t) => {
  const repo = await makeRepo();
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  const nested = join(repo.root, "nested");
  await mkdir(nested);
  await assert.rejects(() => observeRepository(nested, repo.base, {}), /REPOSITORY_ROOT_MISMATCH/);
});

test("default Git executable is pinned and ignores hostile PATH", async (t) => {
  const repo = await makeRepo();
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  const fake = await mkdtemp(join(tmpdir(), "aca-hostile-path-"));
  t.after(() => rm(fake, { recursive: true, force: true }));
  const marker = join(fake, "executed");
  const wrapper = join(fake, "git");
  await writeFile(wrapper, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\nexec /usr/bin/git "$@"\n`);
  await chmod(wrapper, 0o755);
  const moduleUrl = new URL("./agent-change-assurance-connected.mjs", import.meta.url).href;
  const source = `import {observeRepository} from ${JSON.stringify(moduleUrl)}; await observeRepository(${JSON.stringify(repo.root)}, ${JSON.stringify(repo.base)}, {});`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    encoding: "utf8", env: { ...process.env, PATH: `${fake}:${process.env.PATH}` }, timeout: 20_000,
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(spawnSync("test", ["-e", marker]).status, 1, "hostile PATH git executed");
});

test("replacement refs cannot substitute candidate tree or diff", async (t) => {
  const repo = await makeRepo();
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  await writeFile(join(repo.root, "evil.txt"), "replacement only\n");
  const evilCommit = commitAll(repo.root, "replacement tree source");
  const evilTree = git(repo.root, "rev-parse", `${evilCommit}^{tree}`);
  const replacement = git(repo.root, "commit-tree", evilTree, "-p", repo.base, "-m", "replacement");
  git(repo.root, "reset", "--hard", "-q", repo.candidate);
  git(repo.root, "replace", repo.candidate, replacement);
  const expectedTree = git(repo.root, "--no-replace-objects", "rev-parse", `${repo.candidate}^{tree}`);
  const observed = await observeRepository(repo.root, repo.base, {});
  assert.equal(observed.candidate.commit, repo.candidate);
  assert.equal(observed.candidate.tree, expectedTree);
  assert.equal(observed.changedPaths.some((row) => row.path === "evil.txt"), false);
});

test("rejects control, DEL, and encoded-separator tree paths", () => {
  const oid = "a".repeat(40);
  const row = (path) => Buffer.from(`100644 blob ${oid}\t${path}\0`);
  for (const path of ["line\nbreak", "tab\tpath", `del${String.fromCharCode(127)}`, "encoded%2fslash", "encoded%5Cslash"]) {
    assert.throws(() => parseTreeEntries(row(path)), /TREE_PATH_NONCANONICAL/, path);
  }
});

test("aggregate limit counts every materialized manifest entry, not unique blobs", async (t) => {
  const repo = await makeRepo();
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  await writeFile(join(repo.root, "same-a.txt"), "xx");
  await writeFile(join(repo.root, "same-b.txt"), "xx");
  commitAll(repo.root, "duplicate blob references");
  // Unique blob bytes fit (5 + 7 + 2 = 14); materialized entries total 16.
  await assert.rejects(
    () => observeRepository(repo.root, repo.base, {}, { limits: { maxAggregateBytes: 15 } }),
    /TREE_AGGREGATE_SIZE_LIMIT/,
  );
});

test("tracked worktree drift during observation is SOURCE_MOVED", async (t) => {
  const repo = await makeRepo();
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  await assert.rejects(
    () => observeRepository(repo.root, repo.base, {}, {
      afterObservation: () => writeFile(join(repo.root, "base.txt"), "drifted\n"),
    }),
    /SOURCE_MOVED/,
  );
});

test("observer honors endpoint cancellation without returning partial truth", async (t) => {
  const repo = await makeRepo();
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  const controller = new AbortController();
  await assert.rejects(
    () => observeRepository(repo.root, repo.base, {}, {
      signal: controller.signal,
      afterObservation: () => controller.abort(),
    }),
    /OBSERVATION_CANCELLED/,
  );
});

test("Git observation disables textconv and fsmonitor command execution", async (t) => {
  const repo = await makeRepo();
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  const textconvMarker = join(repo.root, "textconv-ran");
  const fsmonitorMarker = join(repo.root, "fsmonitor-ran");
  const textconv = join(repo.root, "textconv.sh");
  const fsmonitor = join(repo.root, "fsmonitor.sh");
  await writeFile(join(repo.root, ".gitattributes"), "*.txt diff=evil\n");
  await writeFile(textconv, `#!/bin/sh\ntouch ${JSON.stringify(textconvMarker)}\ncat "$1"\n`);
  await writeFile(fsmonitor, `#!/bin/sh\ntouch ${JSON.stringify(fsmonitorMarker)}\nprintf "\\n"\n`);
  await chmod(textconv, 0o755);
  await chmod(fsmonitor, 0o755);
  commitAll(repo.root, "hostile git attributes");
  git(repo.root, "config", "diff.evil.textconv", textconv);
  git(repo.root, "config", "core.fsmonitor", fsmonitor);

  await observeRepository(repo.root, repo.base, {});
  assert.equal(spawnSync("test", ["-e", textconvMarker]).status, 1, "textconv executed");
  assert.equal(spawnSync("test", ["-e", fsmonitorMarker]).status, 1, "fsmonitor executed");
});
