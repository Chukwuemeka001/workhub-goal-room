import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { basename } from "node:path";
import { spawnSync } from "node:child_process";

const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const GIT_EXECUTABLE = "/usr/bin/git";
const DEFAULT_LIMITS = Object.freeze({ maxFiles: 10_000, maxPathBytes: 500, maxFileBytes: 16 * 1024 * 1024, maxAggregateBytes: 256 * 1024 * 1024 });
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const fail = (code) => { throw new Error(code); };
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (plain(value)) return Object.fromEntries(Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
};
export const canonicalDigest = (value) => digest(JSON.stringify(canonicalize(value)));

export function admitConnectedRequest(input) {
  return plain(input) && Object.keys(input).length === 0 ? {} : null;
}

const GIT_ENV = Object.freeze({
  PATH: "/usr/bin:/bin",
  LANG: "C", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/usr/bin/false", GIT_NO_REPLACE_OBJECTS: "1",
});
const runGitResult = (root, args, options = {}) => spawnSync(GIT_EXECUTABLE, [
  "--no-replace-objects",
  "-c", "core.quotepath=false",
  "-c", "core.fsmonitor=false",
  "-c", "core.untrackedCache=false",
  "-c", "submodule.recurse=false",
  ...args,
], {
  cwd: root, encoding: options.binary ? null : "utf8", input: options.input,
  maxBuffer: options.maxBuffer ?? 320 * 1024 * 1024, env: GIT_ENV,
  timeout: options.timeout ?? 15_000, killSignal: "SIGKILL",
});
const runGit = (root, args, options = {}) => {
  const result = runGitResult(root, args, options);
  if (result.error?.code === "ETIMEDOUT") fail("GIT_OBSERVATION_TIMEOUT");
  if (result.status !== 0) fail("GIT_OBSERVATION_FAILED");
  return result.stdout;
};
const resolveExactCommit = (root, value, code = "BASE_UNRESOLVED") => {
  if (!SHA.test(value ?? "")) fail(code);
  const result = runGitResult(root, ["rev-parse", "--verify", `${value}^{commit}`]);
  if (result.status !== 0) fail(code);
  const resolved = String(result.stdout).trim();
  if (resolved !== value) fail(code);
  return resolved;
};
const resolveHead = (root) => {
  const result = runGitResult(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
  if (result.status !== 0) fail("HEAD_UNRESOLVED");
  const value = String(result.stdout).trim();
  if (!SHA.test(value)) fail("HEAD_UNRESOLVED");
  return value;
};
const treeOf = (root, commit) => String(runGit(root, ["rev-parse", `${commit}^{tree}`])).trim();
const branchOf = (root) => {
  const result = runGitResult(root, ["symbolic-ref", "--short", "HEAD"]);
  return result.status === 0 ? String(result.stdout).trim() : "DETACHED";
};
const decodeFatal = (bytes, code) => {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail(code); }
};
const canonicalPath = (path, limits) => {
  if (Buffer.byteLength(path) > limits.maxPathBytes) fail("TREE_PATH_LIMIT");
  if (!path || path.startsWith("/") || path.includes("\\") || /%2f|%5c/i.test(path) || /[\u0000-\u001f\u007f]/.test(path) || path.normalize("NFC") !== path || path.split("/").some((part) => !part || part === "." || part === "..")) fail("TREE_PATH_NONCANONICAL");
  return path;
};

export function parseTreeEntries(buffer, suppliedLimits = {}) {
  const limits = { ...DEFAULT_LIMITS, ...suppliedLimits };
  const entries = []; const paths = new Set(); const folded = new Set();
  let start = 0;
  for (let index = 0; index < buffer.length; index++) {
    if (buffer[index] !== 0) continue;
    const record = buffer.subarray(start, index); start = index + 1;
    if (record.length === 0) fail("TREE_RECORD_MALFORMED");
    const tab = record.indexOf(9);
    if (tab < 0) fail("TREE_RECORD_MALFORMED");
    const header = decodeFatal(record.subarray(0, tab), "TREE_RECORD_MALFORMED");
    const match = /^(\d{6}) ([a-z]+) ([0-9a-f]{40}|[0-9a-f]{64})$/.exec(header);
    if (!match) fail("TREE_RECORD_MALFORMED");
    if (!(["100644", "100755"].includes(match[1]) && match[2] === "blob")) fail("TREE_MODE_UNSUPPORTED");
    const decodedPath = decodeFatal(record.subarray(tab + 1), "TREE_PATH_INVALID_UTF8");
    const collisionKey = decodedPath.normalize("NFD").toLowerCase();
    if (folded.has(collisionKey)) fail(paths.has(decodedPath) ? "TREE_PATH_DUPLICATE" : "TREE_PATH_COLLISION");
    const path = canonicalPath(decodedPath, limits);
    paths.add(path); folded.add(collisionKey);
    entries.push({ mode: match[1], path, blob: match[3] });
    if (entries.length > limits.maxFiles) fail("TREE_FILE_COUNT_LIMIT");
  }
  if (start !== buffer.length) fail("TREE_RECORD_MALFORMED");
  return entries;
}

const readBlobs = (root, entries, limits) => {
  const unique = [...new Set(entries.map((entry) => entry.blob))];
  const sizes = new Map();
  const checkedOutput = String(runGit(root, ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], {
    input: `${unique.join("\n")}\n`, maxBuffer: 2 * 1024 * 1024,
  }));
  const checked = checkedOutput.endsWith("\n") ? checkedOutput.slice(0, -1).split("\n") : [];
  if (checked.length !== unique.length) fail("BLOB_BATCH_MALFORMED");
  for (let index = 0; index < unique.length; index++) {
    const match = /^([0-9a-f]{40}|[0-9a-f]{64}) blob (\d+)$/.exec(checked[index]);
    if (!match || match[1] !== unique[index]) fail("BLOB_BATCH_MALFORMED");
    const size = Number(match[2]);
    if (!Number.isSafeInteger(size) || size > limits.maxFileBytes) fail("TREE_FILE_SIZE_LIMIT");
    sizes.set(match[1], size);
  }
  let materializedAggregate = 0;
  for (const entry of entries) {
    materializedAggregate += sizes.get(entry.blob);
    if (materializedAggregate > limits.maxAggregateBytes) fail("TREE_AGGREGATE_SIZE_LIMIT");
  }
  const output = runGit(root, ["cat-file", "--batch"], { binary: true, input: `${unique.join("\n")}\n` });
  const blobs = new Map(); let offset = 0;
  for (const oid of unique) {
    const newline = output.indexOf(10, offset);
    if (newline < 0) fail("BLOB_BATCH_MALFORMED");
    const header = decodeFatal(output.subarray(offset, newline), "BLOB_BATCH_MALFORMED");
    const match = /^([0-9a-f]{40}|[0-9a-f]{64}) blob (\d+)$/.exec(header);
    if (!match || match[1] !== oid) fail("BLOB_BATCH_MALFORMED");
    const size = Number(match[2]);
    if (!Number.isSafeInteger(size) || size !== sizes.get(oid)) fail("BLOB_BATCH_MALFORMED");
    const start = newline + 1; const end = start + size;
    if (end >= output.length || output[end] !== 10) fail("BLOB_BATCH_MALFORMED");
    const content = output.subarray(start, end);
    blobs.set(oid, { size, contentDigest: digest(content) }); offset = end + 1;
  }
  if (offset !== output.length) fail("BLOB_BATCH_MALFORMED");
  return entries.map((entry) => ({ ...entry, ...blobs.get(entry.blob) }));
};
const splitNul = (buffer, code) => {
  if (buffer.length && buffer.at(-1) !== 0) fail(code);
  const values = []; let start = 0;
  for (let index = 0; index < buffer.length; index++) if (buffer[index] === 0) { values.push(decodeFatal(buffer.subarray(start, index), code)); start = index + 1; }
  return values;
};
const parseRawDiff = (buffer, limits) => {
  const parts = splitNul(buffer, "DIFF_INVALID_UTF8"); const rows = [];
  for (let index = 0; index < parts.length;) {
    const match = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z])(\d*)$/.exec(parts[index++]);
    if (!match || index >= parts.length) fail("DIFF_MALFORMED");
    const oldPath = canonicalPath(parts[index++], limits);
    const newPath = match[3] === "R" || match[3] === "C" ? canonicalPath(parts[index++] ?? "", limits) : oldPath;
    if ([match[1], match[2]].some((mode) => mode !== "000000" && !["100644", "100755"].includes(mode))) fail("TREE_MODE_UNSUPPORTED");
    rows.push({ path: newPath, ...(newPath !== oldPath ? { oldPath } : {}), status: match[3], oldMode: match[1], newMode: match[2] });
  }
  return rows;
};
const parseNumstat = (buffer, limits) => {
  const parts = splitNul(buffer, "DIFF_INVALID_UTF8"); const stats = new Map();
  for (let index = 0; index < parts.length;) {
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(parts[index++]);
    if (!match) fail("DIFF_MALFORMED");
    let path = match[3];
    if (path === "") { index += 1; path = parts[index++] ?? ""; }
    path = canonicalPath(path, limits);
    stats.set(path, { additions: match[1] === "-" ? 0 : Number(match[1]), deletions: match[2] === "-" ? 0 : Number(match[2]), binary: match[1] === "-" });
  }
  return stats;
};
const inventory = (root, args, limits, invalidCode) => {
  const bytes = runGit(root, args, { binary: true });
  const paths = splitNul(bytes, invalidCode).map((path) => canonicalPath(path, limits));
  return { bytes, paths };
};
const deepFreeze = (value) => { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; };
const cancellationCheckpoint = async (signal) => {
  await new Promise((resolve) => setImmediate(resolve));
  if (signal?.aborted) fail("OBSERVATION_CANCELLED");
};

export async function observeRepository(configuredRoot, configuredBase, request = {}, hooks = {}) {
  await cancellationCheckpoint(hooks.signal);
  const root = await realpath(configuredRoot);
  if (/[\u0000-\u001f\u007f]/.test(root)) fail("REPOSITORY_ROOT_MISMATCH");
  if (!admitConnectedRequest(request)) fail("INVALID_CONNECTED_REQUEST");
  if (!SHA.test(configuredBase ?? "")) fail("BASE_UNRESOLVED");
  const topLevel = await realpath(String(runGit(root, ["rev-parse", "--path-format=absolute", "--show-toplevel"])).trimEnd());
  if (topLevel !== root) fail("REPOSITORY_ROOT_MISMATCH");
  const limits = { ...DEFAULT_LIMITS, ...(hooks.limits ?? {}) };
  const initialBranch = branchOf(root); const candidateCommit = resolveHead(root);
  const baseCommit = resolveExactCommit(root, configuredBase);
  if (baseCommit === candidateCommit) fail("EMPTY_CHANGE");
  const ancestry = runGitResult(root, ["merge-base", "--is-ancestor", baseCommit, candidateCommit]);
  if (ancestry.status === 1) fail("BASE_NOT_ANCESTOR");
  if (ancestry.status !== 0) fail("BASE_UNRESOLVED");
  await cancellationCheckpoint(hooks.signal);
  const candidate = { commit: candidateCommit, tree: treeOf(root, candidateCommit) };
  const base = { commit: baseCommit, tree: treeOf(root, baseCommit) };
  const treeBytes = runGit(root, ["ls-tree", "-r", "-z", "--full-tree", candidateCommit], { binary: true });
  const manifest = readBlobs(root, parseTreeEntries(treeBytes, limits), limits);
  await cancellationCheckpoint(hooks.signal);
  const raw = runGit(root, ["diff-tree", "-r", "--no-commit-id", "--no-abbrev", "-z", "-M", "-C", "--raw", baseCommit, candidateCommit], { binary: true });
  const numstat = runGit(root, ["diff-tree", "-r", "--no-commit-id", "-z", "-M", "-C", "--numstat", baseCommit, candidateCommit], { binary: true });
  const patch = runGit(root, ["diff", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--no-color", baseCommit, candidateCommit, "--"], { binary: true });
  const rows = parseRawDiff(raw, limits); if (rows.length === 0) fail("EMPTY_CHANGE");
  const stats = parseNumstat(numstat, limits);
  const changedPaths = rows.map((row) => ({ ...row, ...(stats.get(row.path) ?? { additions: 0, deletions: 0, binary: true }) }));
  await cancellationCheckpoint(hooks.signal);
  const tracked = inventory(root, ["status", "--porcelain=v1", "-z", "--untracked-files=no", "--ignore-submodules=all"], limits, "TRACKED_PATH_INVALID_UTF8");
  const untracked = inventory(root, ["ls-files", "--others", "--exclude-standard", "-z"], limits, "UNTRACKED_PATH_INVALID_UTF8");
  await hooks.afterObservation?.();
  await cancellationCheckpoint(hooks.signal);
  const finalBranch = branchOf(root); const finalHead = resolveHead(root); const finalTree = treeOf(root, finalHead);
  const finalTracked = inventory(root, ["status", "--porcelain=v1", "-z", "--untracked-files=no", "--ignore-submodules=all"], limits, "TRACKED_PATH_INVALID_UTF8");
  const finalUntracked = inventory(root, ["ls-files", "--others", "--exclude-standard", "-z"], limits, "UNTRACKED_PATH_INVALID_UTF8");
  if (finalBranch !== initialBranch || finalHead !== candidateCommit || finalTree !== candidate.tree || !tracked.bytes.equals(finalTracked.bytes) || !untracked.bytes.equals(finalUntracked.bytes)) fail("SOURCE_MOVED");
  const diffBinding = { base, candidate, changedPaths };
  return deepFreeze({
    displayName: basename(root), observedBranch: initialBranch, observedHead: candidateCommit,
    configuredBase, resolvedBase: baseCommit, candidate, base,
    trackedState: tracked.paths.length === 0 ? "CLEAN" : "DIRTY", trackedDigest: digest(tracked.bytes),
    untrackedCount: untracked.paths.length, untrackedInventoryDigest: digest(untracked.bytes),
    manifest, manifestDigest: canonicalDigest(manifest), contentManifestDigest: canonicalDigest(manifest.map(({ path, mode, size, contentDigest }) => ({ path, mode, size, contentDigest }))),
    changedPaths, additions: changedPaths.reduce((sum, row) => sum + row.additions, 0), deletions: changedPaths.reduce((sum, row) => sum + row.deletions, 0),
    statusDigest: digest(raw), numstatDigest: digest(numstat), patchDigest: digest(patch), diffDigest: canonicalDigest(diffBinding),
  });
}

const unavailableProvider = Object.freeze({ async qualify() { return { qualified: false, reason: "SANDBOX_UNAVAILABLE" }; } });
export async function collectConnectedAssurance(configuredRoot, configuredBase, request = {}, options = {}) {
  const repository = await observeRepository(configuredRoot, configuredBase, request, options);
  let qualification;
  try { qualification = await (options.sandboxProvider ?? unavailableProvider).qualify(); }
  catch { qualification = { qualified: false, reason: "SANDBOX_POLICY_UNAVAILABLE" }; }
  // v2 has no execution implementation: even a future provider cannot fall through to direct host execution.
  const reason = qualification?.qualified ? "SANDBOX_EXECUTION_NOT_IMPLEMENTED" : (qualification?.reason ?? "SANDBOX_UNAVAILABLE");
  const checks = ["unit", "build"].map((checkId) => ({ checkId, state: "INDETERMINATE", reason, execution: "NOT_RUN" }));
  const evaluatorSnapshot = {
    schemaVersion: "agent-change-assurance/v1", provenance: { label: "Connected local Git observation" }, repository: repository.displayName,
    expectedCandidateSha: repository.candidate.commit, reviewedCandidateSha: repository.candidate.commit, baseSha: repository.base.commit,
    changedPaths: repository.changedPaths.map((row) => row.path), additions: repository.additions, deletions: repository.deletions,
    claims: [], evidence: [], requiredEvidenceKinds: ["unit", "build"],
  };
  const envelope = {
    schema: "agent-change-assurance/connected-v2", mode: "CONNECTED_LOCAL", repositoryIdentityBasis: "LOCAL_GIT_OBSERVED",
    claimBasis: "NOT_OBSERVED", evidenceBasis: "NO_EXECUTABLE_EVIDENCE", authority: "NONE",
    repository, checks, sandbox: { status: "UNAVAILABLE", reason }, evaluatorSnapshot,
    githubCi: "NOT_OBSERVED_BY_THIS_LOCAL_VERIFIER",
  };
  return deepFreeze({ ...envelope, envelopeDigest: canonicalDigest(envelope) });
}
