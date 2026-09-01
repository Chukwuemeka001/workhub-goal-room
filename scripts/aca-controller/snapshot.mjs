import { createHash } from "node:crypto";
import { constants as FS_CONSTANTS } from "node:fs";
import { open, chmod, mkdtemp, realpath, rm, statfs } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const SNAPSHOT_LIMITS = Object.freeze({
  maxEntries: 10_000,
  maxPathBytes: 500,
  maxFileBytes: 16_777_216,
  maxContentBytes: 268_435_456,
  maxManifestBytes: 8_388_608,
  maxInnerBytes: 276_824_108,
  maxOuterBytes: 276_826_112,
  chunkBytes: 65_536,
  reserveBytes: 16_777_216,
});

const MAGIC = Buffer.from("ACASNP1\0");
const GIT_ENV = Object.freeze({ PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_NO_REPLACE_OBJECTS: "1", GIT_TERMINAL_PROMPT: "0" });
const fail = code => { throw new Error(code); };
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const canonicalBytes = value => Buffer.from(JSON.stringify(canonical(value)));
const safe = (value, code = "UNSAFE_INTEGER") => { if (!Number.isSafeInteger(value) || value < 0) fail(code); return value; };
const add = (left, right) => { safe(left); safe(right); const value = left + right; if (!Number.isSafeInteger(value)) fail("UNSAFE_INTEGER"); return value; };
const pathOk = value => typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= SNAPSHOT_LIMITS.maxPathBytes && value.normalize("NFC") === value && !value.startsWith("/") && !value.includes("\\") && !/[\0-\x1f\x7f]/.test(value) && value.split("/").every(part => part && part !== "." && part !== "..");
const comparePath = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));
const excluded = (path, prefixes) => prefixes.some(prefix => path === prefix || path.startsWith(`${prefix}/`));

function git(root, args, options = {}) {
  const result = spawnSync("/usr/bin/git", ["--no-replace-objects", "-c", "core.quotepath=false", ...args], { cwd: root, env: GIT_ENV, encoding: options.binary ? null : "utf8", input: options.input, maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024 });
  if (result.status !== 0) fail("GIT_OBSERVATION_FAILED");
  return result.stdout;
}

function nul(bytes) {
  if (bytes.length && bytes.at(-1) !== 0) fail("GIT_RECORD_MALFORMED");
  return bytes.length ? bytes.subarray(0, -1).toString("utf8").split("\0") : [];
}

function headRows(root, commit) {
  const raw = git(root, ["ls-tree", "-r", "-z", "--full-tree", commit], { binary: true, maxBuffer: 64 * 1024 * 1024 });
  const rows = nul(raw).map(line => {
    const match = /^(100644|100755) blob ([0-9a-f]{40}|[0-9a-f]{64})\t(.+)$/.exec(line);
    if (!match || !pathOk(match[3])) fail("HEAD_TREE_UNSUPPORTED");
    return { mode: match[1], blob: match[2], path: match[3] };
  });
  if (rows.length > SNAPSHOT_LIMITS.maxEntries) fail("ENTRY_COUNT_LIMIT");
  const sizes = String(git(root, ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], { input: Buffer.from(`${rows.map(row => row.blob).join("\n")}\n`) })).trim().split("\n");
  if (sizes.length !== rows.length) fail("GIT_RECORD_MALFORMED");
  return rows.map((row, index) => {
    const match = /^([0-9a-f]{40}|[0-9a-f]{64}) blob ([0-9]+)$/.exec(sizes[index]);
    if (!match || match[1] !== row.blob) fail("GIT_RECORD_MALFORMED");
    const size = Number(match[2]); safe(size); if (size > SNAPSHOT_LIMITS.maxFileBytes) fail("FILE_SIZE_LIMIT");
    return { ...row, size };
  });
}

async function writeAll(handle, bytes, position) {
  let written = 0;
  while (written < bytes.length) {
    const result = await handle.write(bytes, written, bytes.length - written, position + written);
    if (!result.bytesWritten) fail("SCRATCH_WRITE_FAILED");
    written += result.bytesWritten;
  }
}

async function streamDescriptor(handle, metadata, destination, position, observeReadSize) {
  const before = await handle.stat();
  if (!before.isFile() || before.isSymbolicLink() || before.dev !== metadata.dev || before.ino !== metadata.ino || before.size !== metadata.size || before.mode !== metadata.mode) fail("SOURCE_MOVED");
  const digest = createHash("sha256");
  const gitDigest = createHash(metadata.gitAlgorithm).update(`blob ${metadata.size}\0`);
  let offset = 0;
  while (offset < metadata.size) {
    const amount = Math.min(SNAPSHOT_LIMITS.chunkBytes, metadata.size - offset);
    observeReadSize?.(amount);
    const chunk = Buffer.allocUnsafe(amount);
    const { bytesRead } = await handle.read(chunk, 0, amount, offset);
    if (bytesRead <= 0) fail("SOURCE_MOVED");
    const bytes = chunk.subarray(0, bytesRead);
    digest.update(bytes); gitDigest.update(bytes);
    await writeAll(destination, bytes, position + offset);
    offset += bytesRead;
  }
  const after = await handle.stat();
  if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mode !== before.mode) fail("SOURCE_MOVED");
  return { sha256: digest.digest("hex"), gitBlob: gitDigest.digest("hex") };
}

async function streamGitBlob(root, entry, destination, position, observeReadSize) {
  const child = spawn("/usr/bin/git", ["--no-replace-objects", "cat-file", "blob", entry.blob], { cwd: root, env: GIT_ENV, stdio: ["ignore", "pipe", "pipe"] });
  const digest = createHash("sha256"); let offset = 0; let diagnostic = "";
  const closed = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  child.stderr.setEncoding("utf8"); child.stderr.on("data", chunk => { if (diagnostic.length < 1024) diagnostic += chunk.slice(0, 1024 - diagnostic.length); });
  for await (const emitted of child.stdout) {
    const source = Buffer.from(emitted);
    for (let cursor = 0; cursor < source.length; cursor += SNAPSHOT_LIMITS.chunkBytes) {
      const bytes = source.subarray(cursor, cursor + SNAPSHOT_LIMITS.chunkBytes);
      observeReadSize?.(bytes.length); digest.update(bytes); await writeAll(destination, bytes, position + offset); offset += bytes.length;
      if (offset > entry.size) { child.stdout.destroy(); fail("GIT_BLOB_SIZE_MISMATCH"); }
    }
  }
  const status = await closed;
  if (status !== 0 || offset !== entry.size) fail(`GIT_BLOB_SIZE_MISMATCH ${diagnostic}`.slice(0, 256));
  return { sha256: digest.digest("hex"), gitBlob: entry.blob };
}

function bundleManifest(entries, snapshotDigest) {
  let offset = 0;
  const rows = entries.map(entry => { const row = { path: entry.path, mode: entry.mode, size: entry.size, sha256: entry.sha256, offset }; offset = add(offset, entry.size); return row; });
  return { bytes: canonicalBytes({ schema: "aca-snapshot-v1", snapshotDigest, entries: rows }), contentBytes: offset };
}

async function copyCapturedRange(source, entry, destination, observeReadSize) {
  let offset = 0;
  while (offset < entry.size) {
    const amount = Math.min(SNAPSHOT_LIMITS.chunkBytes, entry.size - offset); observeReadSize?.(amount);
    const chunk = Buffer.allocUnsafe(amount); const { bytesRead } = await source.read(chunk, 0, amount, entry.contentOffset + offset);
    if (bytesRead <= 0) fail("SCRATCH_CONTENT_MOVED"); await writeAll(destination, chunk.subarray(0, bytesRead), offset); offset += bytesRead;
  }
}

async function diffFromBase(root, baseRows, entries, baseCommit, baseTree, snapshotDigest, contentHandle, scratch, observeReadSize) {
  const base = new Map(baseRows.map(entry => [entry.path, entry])); const candidate = new Map(entries.map(entry => [entry.path, entry])); const paths = [...new Set([...base.keys(), ...candidate.keys()])].sort(comparePath);
  const rows = []; let additions = 0, deletions = 0, sequence = 0;
  for (const path of paths) {
    const old = base.get(path), next = candidate.get(path);
    if (old && next && old.mode === next.mode && old.blob === next.gitBlob) continue;
    const status = !old ? "A" : !next ? "D" : "M";
    const oldPath = join(scratch, `diff-${sequence}-old`), newPath = join(scratch, `diff-${sequence++}-new`); let oldHandle, newHandle;
    try {
      if (old) { oldHandle = await open(oldPath, "wx+", 0o600); await streamGitBlob(root, old, oldHandle, 0, observeReadSize); await oldHandle.close(); oldHandle = undefined; }
      if (next) { newHandle = await open(newPath, "wx+", 0o600); await copyCapturedRange(contentHandle, next, newHandle, observeReadSize); await newHandle.close(); newHandle = undefined; }
      const result = spawnSync("/usr/bin/git", ["--no-replace-objects", "-c", "core.quotepath=false", "diff", "--no-index", "--numstat", "--no-renames", "--", old ? oldPath : "/dev/null", next ? newPath : "/dev/null"], { env: GIT_ENV, encoding: "utf8", maxBuffer: 4096, timeout: 30_000 });
      if (![0, 1].includes(result.status)) fail("GIT_NUMSTAT_FAILED");
      const line = result.stdout.trim(); let rowAdditions = 0, rowDeletions = 0, binary = false;
      if (line) { const match = /^(\d+|-)\t(\d+|-)\t/.exec(line); if (!match) fail("GIT_NUMSTAT_MALFORMED"); binary = match[1] === "-" && match[2] === "-"; if ((match[1] === "-") !== (match[2] === "-")) fail("GIT_NUMSTAT_MALFORMED"); if (!binary) { rowAdditions = safe(Number(match[1])); rowDeletions = safe(Number(match[2])); } }
      additions = add(additions, rowAdditions); deletions = add(deletions, rowDeletions);
      rows.push({ path, status, oldMode: old?.mode ?? "000000", newMode: next?.mode ?? "000000", oldBlob: old?.blob ?? null, newBlob: next?.gitBlob ?? null, additions: rowAdditions, deletions: rowDeletions, binary });
    } finally { try { await oldHandle?.close(); } catch {} try { await newHandle?.close(); } catch {} await rm(oldPath, { force: true }); await rm(newPath, { force: true }); }
  }
  const diffDigest = sha(canonicalBytes({ schema: "aca-base-snapshot-diff/v2", baseCommit, baseTree, snapshotDigest, rows, additions, deletions }));
  return Object.freeze({ rows: Object.freeze(rows), changedPaths: Object.freeze(rows.map(row => row.path)), additions, deletions, diffDigest });
}

function sameIdentity(info, sealed) {
  return info.isFile() && !info.isSymbolicLink() && info.dev === sealed.dev && info.ino === sealed.ino && info.size === sealed.size && info.mode === sealed.mode;
}

const octal = (value, length) => `${value.toString(8).padStart(length - 1, "0")}\0`;
function tarHeader(size) {
  const header = Buffer.alloc(512); header.write("sealed/snapshot.bin", 0, 100, "utf8"); header.write(octal(0o444, 8), 100, 8, "ascii"); header.write(octal(0, 8), 108, 8, "ascii"); header.write(octal(0, 8), 116, 8, "ascii"); header.write(octal(size, 12), 124, 12, "ascii"); header.write(octal(0, 12), 136, 12, "ascii"); header.fill(0x20, 148, 156); header[156] = 0x30; header.write("ustar\0", 257, 6, "ascii"); header.write("00", 263, 2, "ascii"); header.write(octal([...header].reduce((sum, byte) => sum + byte, 0), 8), 148, 8, "ascii"); return header;
}

export async function* createSnapshotTarStream(sealed, options = {}) {
  if (!sealed?.handle || !Number.isSafeInteger(sealed.size) || sealed.size < 44 || sealed.size > SNAPSHOT_LIMITS.maxInnerBytes) fail("TAR_INPUT");
  const before = await sealed.handle.stat(); if (!sameIdentity(before, sealed)) fail("SEALED_SNAPSHOT_MOVED");
  yield tarHeader(sealed.size);
  let offset = 0;
  while (offset < sealed.size) {
    const amount = Math.min(SNAPSHOT_LIMITS.chunkBytes, sealed.size - offset); options.observeReadSize?.(amount);
    const chunk = Buffer.allocUnsafe(amount); const { bytesRead } = await sealed.handle.read(chunk, 0, amount, offset);
    if (bytesRead <= 0) fail("SEALED_SNAPSHOT_MOVED"); offset += bytesRead; yield chunk.subarray(0, bytesRead);
  }
  const padding = (512 - sealed.size % 512) % 512; if (padding) yield Buffer.alloc(padding); yield Buffer.alloc(1024);
  const after = await sealed.handle.stat(); if (!sameIdentity(after, sealed)) fail("SEALED_SNAPSHOT_MOVED");
}

async function describeTar(sealed, observeReadSize) {
  const digest = createHash("sha256"); let bytes = 0;
  for await (const chunk of createSnapshotTarStream(sealed, { observeReadSize })) { digest.update(chunk); bytes = add(bytes, chunk.length); }
  const expected = 512 + Math.ceil(sealed.size / 512) * 512 + 1024;
  if (bytes !== expected || bytes > SNAPSHOT_LIMITS.maxOuterBytes) fail("TAR_SIZE_LIMIT");
  return { bytes, sha256: digest.digest("hex") };
}

export async function captureSnapshot(options = {}) {
  const root = await realpath(options.root); const parentCommit = String(git(root, ["rev-parse", "--verify", `${options.parentCommit}^{commit}`])).trim();
  if (parentCommit !== options.parentCommit) fail("PARENT_COMMIT_MISMATCH");
  const parentTree = String(git(root, ["rev-parse", `${parentCommit}^{tree}`])).trim();
  const baseCommit = options.baseCommit ? String(git(root, ["rev-parse", "--verify", `${options.baseCommit}^{commit}`])).trim() : parentCommit;
  if (options.baseCommit && baseCommit !== options.baseCommit) fail("BASE_COMMIT_MISMATCH");
  const baseTree = String(git(root, ["rev-parse", `${baseCommit}^{tree}`])).trim(); if (options.baseTree && baseTree !== options.baseTree) fail("BASE_TREE_MISMATCH");
  const allowedPaths = [...new Set(options.allowedPaths ?? [])]; if (allowedPaths.some(path => !pathOk(path))) fail("ALLOWLIST_PATH_INVALID");
  const allow = new Set(allowedPaths); const requiredOverlayPaths = options.requiredOverlayPaths ?? []; for (const path of requiredOverlayPaths) if (!allow.has(path)) fail("HEAD_ONLY_WRONG_SUBJECT");
  const excludedPrefixes = options.excludedPrefixes ?? [];
  const tracked = nul(git(root, ["diff", "--name-only", "-z", "HEAD", "--"], { binary: true })); for (const path of tracked) if (!allow.has(path)) fail("TRACKED_OUTSIDE_ALLOWLIST");
  const untracked = nul(git(root, ["ls-files", "--others", "--exclude-standard", "-z"], { binary: true })); for (const path of untracked) if (!allow.has(path) && !excluded(path, excludedPrefixes)) fail("UNTRACKED_OUTSIDE_ALLOWLIST");
  const head = headRows(root, parentCommit); const headByPath = new Map(head.map(entry => [entry.path, entry])); let sources = [...head];
  for (const path of allowedPaths) if (!headByPath.has(path)) sources.push({ path, mode: "000000", blob: null, size: null });
  sources.sort((left, right) => comparePath(left.path, right.path)); if (sources.length > SNAPSHOT_LIMITS.maxEntries) fail("ENTRY_COUNT_LIMIT");
  const gitAlgorithm = parentCommit.length === 64 ? "sha256" : "sha1"; const opened = new Map(); let total = 0;
  try {
    for (const source of sources) {
      if (allow.has(source.path)) {
        let handle; try { handle = await open(join(root, source.path), FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0)); } catch (error) { if (error?.code === "ENOENT" && source.blob) { source.deleted = true; continue; } fail("ALLOWLIST_PATH_MISSING"); }
        const info = await handle.stat(); if (!info.isFile() || info.isSymbolicLink()) { await handle.close(); fail("PATH_MODE_UNSUPPORTED"); }
        if (info.size > SNAPSHOT_LIMITS.maxFileBytes) { await handle.close(); fail("FILE_SIZE_LIMIT"); }
        const mode = (info.mode & 0o111) ? "100755" : "100644"; if (source.mode !== "000000" && mode !== source.mode) { await handle.close(); fail("MODE_MOVED"); }
        source.size = info.size; source.mode = mode; source.descriptor = { handle, dev: info.dev, ino: info.ino, size: info.size, mode: info.mode, gitAlgorithm }; opened.set(source.path, handle);
      }
      total = add(total, source.size); if (total > SNAPSHOT_LIMITS.maxContentBytes) fail("CONTENT_SIZE_LIMIT");
    }
    const scratchParent = options.scratchParent ?? tmpdir(); const fs = await statfs(scratchParent, { bigint: true }); const conservative = BigInt(total * 2 + SNAPSHOT_LIMITS.maxManifestBytes * 2 + SNAPSHOT_LIMITS.reserveBytes + 4096); if (fs.bavail * fs.bsize < conservative) fail("SCRATCH_DISK_FLOOR");
    const scratch = await mkdtemp(join(scratchParent, "aca-snapshot-")); const contentPath = join(scratch, "content.bin"); const innerPath = join(scratch, "snapshot.bin");
    let contentHandle; let innerWriter; let sealedHandle; let cleaned = false;
    try {
      contentHandle = await open(contentPath, "wx+", 0o600); const entries = []; let contentOffset = 0;
      for (const source of sources) {
        if (source.deleted) continue;
        const result = source.descriptor
          ? await streamDescriptor(source.descriptor.handle, source.descriptor, contentHandle, contentOffset, options.observeReadSize)
          : await streamGitBlob(root, source, contentHandle, contentOffset, options.observeReadSize);
        entries.push(Object.freeze({ path: source.path, mode: source.mode, size: source.size, sha256: result.sha256, gitBlob: result.gitBlob, source: source.descriptor ? "WORKTREE" : "HEAD", contentOffset })); contentOffset = add(contentOffset, source.size);
      }
      for (const path of requiredOverlayPaths) { const entry = entries.find(candidate => candidate.path === path), original = headByPath.get(path); if (!entry || (original && original.blob === entry.gitBlob && original.mode === entry.mode)) fail("HEAD_ONLY_WRONG_SUBJECT"); }
      const completeManifest = entries.map(({ path, mode, size, sha256 }) => ({ path, mode, size, sha256 })); const manifestBytes = canonicalBytes(completeManifest); if (manifestBytes.length > SNAPSHOT_LIMITS.maxManifestBytes) fail("MANIFEST_SIZE_LIMIT");
      const snapshotDigest = sha(manifestBytes); const framed = bundleManifest(entries, snapshotDigest); if (framed.bytes.length > SNAPSHOT_LIMITS.maxManifestBytes) fail("MANIFEST_SIZE_LIMIT");
      const header = Buffer.alloc(12); MAGIC.copy(header); header.writeUInt32BE(framed.bytes.length, 8); const bodyHash = createHash("sha256");
      innerWriter = await open(innerPath, "wx+", 0o400); await writeAll(innerWriter, header, 0); bodyHash.update(header); await writeAll(innerWriter, framed.bytes, 12); bodyHash.update(framed.bytes);
      let readOffset = 0, writeOffset = 12 + framed.bytes.length;
      while (readOffset < total) { const amount = Math.min(SNAPSHOT_LIMITS.chunkBytes, total - readOffset); options.observeReadSize?.(amount); const chunk = Buffer.allocUnsafe(amount); const { bytesRead } = await contentHandle.read(chunk, 0, amount, readOffset); if (bytesRead <= 0) fail("SCRATCH_CONTENT_MOVED"); const bytes = chunk.subarray(0, bytesRead); await writeAll(innerWriter, bytes, writeOffset); bodyHash.update(bytes); readOffset += bytesRead; writeOffset += bytesRead; }
      const innerDigest = bodyHash.digest(); await writeAll(innerWriter, innerDigest, writeOffset); const innerSize = writeOffset + innerDigest.length; if (innerSize > SNAPSHOT_LIMITS.maxInnerBytes) fail("BUNDLE_SIZE_LIMIT");
      await innerWriter.sync(); await innerWriter.close(); innerWriter = undefined; await chmod(innerPath, 0o400);
      sealedHandle = await open(innerPath, FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0)); const sealedInfo = await sealedHandle.stat(); const sealed = { path: innerPath, handle: sealedHandle, size: sealedInfo.size, dev: sealedInfo.dev, ino: sealedInfo.ino, mode: sealedInfo.mode, sha256: innerDigest.toString("hex") };
      const transport = await describeTar(sealed, options.observeReadSize); sealed.outerBytes = transport.bytes; sealed.outerDigest = transport.sha256;
      const overlay = entries.filter(entry => { const original = headByPath.get(entry.path); return !original || original.blob !== entry.gitBlob || original.mode !== entry.mode; }).sort((left, right) => comparePath(left.path, right.path)); const fingerprint = createHash("sha256"); for (const entry of overlay) fingerprint.update(entry.path).update("\0").update(Buffer.from(entry.sha256, "hex")).update("\0");
      const diff = await diffFromBase(root, headRows(root, baseCommit), entries, baseCommit, baseTree, snapshotDigest, contentHandle, scratch, options.observeReadSize); await contentHandle.close(); contentHandle = undefined; await rm(contentPath, { force: true }); const headCommit = String(git(root, ["rev-parse", "HEAD"])).trim(); const branch = String(git(root, ["symbolic-ref", "--short", "HEAD"])).trim();
      const cleanup = async () => { if (cleaned) return; cleaned = true; try { await sealedHandle.close(); } finally { await rm(scratch, { recursive: true, force: true }); } };
      return Object.freeze({ root, scratchParent, parentCommit, parentTree, baseCommit, baseTree, head: headCommit, branch, allowedPaths, excludedPrefixes, requiredOverlayPaths, snapshotDigest, manifestDigest: snapshotDigest, contentManifestDigest: sha(canonicalBytes(completeManifest.map(({ path, mode, size, sha256 }) => ({ path, mode, size, sha256 })))), overlayFingerprint: fingerprint.digest("hex"), entries: Object.freeze(entries), diff, sealed: Object.freeze(sealed), cleanup });
    } catch (error) {
      try { await sealedHandle?.close(); } catch {} try { await innerWriter?.close(); } catch {} try { await contentHandle?.close(); } catch {} await rm(scratch, { recursive: true, force: true }); throw error;
    }
  } finally {
    for (const handle of opened.values()) try { await handle.close(); } catch {}
  }
}

export async function revalidateSnapshot(root, shot) {
  const fresh = await captureSnapshot({ root, scratchParent: shot.scratchParent, parentCommit: shot.parentCommit, baseCommit: shot.baseCommit, baseTree: shot.baseTree, allowedPaths: shot.allowedPaths, excludedPrefixes: shot.excludedPrefixes, requiredOverlayPaths: shot.requiredOverlayPaths });
  try {
    if (fresh.snapshotDigest !== shot.snapshotDigest || fresh.overlayFingerprint !== shot.overlayFingerprint || fresh.diff.diffDigest !== shot.diff.diffDigest || fresh.head !== shot.head || fresh.branch !== shot.branch) fail("SOURCE_MOVED");
    return true;
  } finally { await fresh.cleanup(); }
}

export function decodeSnapshotBundle(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 44 || !bytes.subarray(0, 8).equals(MAGIC)) fail("BUNDLE_MAGIC"); const manifestLength = bytes.readUInt32BE(8); if (manifestLength > SNAPSHOT_LIMITS.maxManifestBytes || 12 + manifestLength + 32 > bytes.length) fail("BUNDLE_LENGTH");
  const body = bytes.subarray(0, -32); if (sha(body) !== bytes.subarray(-32).toString("hex")) fail("BUNDLE_DIGEST_MISMATCH"); let manifest; try { manifest = JSON.parse(bytes.subarray(12, 12 + manifestLength).toString("utf8")); } catch { fail("BUNDLE_MANIFEST"); }
  if (manifest.schema !== "aca-snapshot-v1" || !Array.isArray(manifest.entries)) fail("BUNDLE_MANIFEST"); let offset = 0; const contentStart = 12 + manifestLength;
  const entries = manifest.entries.map(entry => { if (!pathOk(entry.path) || !["100644", "100755"].includes(entry.mode) || entry.offset !== offset || !Number.isSafeInteger(entry.size) || entry.size < 0) fail("BUNDLE_OFFSET"); const end = add(offset, entry.size); if (contentStart + end > body.length) fail("BUNDLE_OFFSET"); const content = Buffer.from(bytes.subarray(contentStart + offset, contentStart + end)); if (sha(content) !== entry.sha256) fail("BUNDLE_ENTRY_DIGEST"); offset = end; return { ...entry, content }; });
  if (contentStart + offset !== body.length) fail("BUNDLE_TRAILING"); return { schema: manifest.schema, snapshotDigest: manifest.snapshotDigest, entries, bundleDigest: bytes.subarray(-32).toString("hex") };
}

export function decodeSnapshotTar(tar) {
  if (!Buffer.isBuffer(tar) || tar.length < 1536 || tar.length % 512) fail("TAR_LENGTH"); const header = tar.subarray(0, 512); const saved = header.subarray(148, 156).toString("ascii"); const copy = Buffer.from(header); copy.fill(0x20, 148, 156); if (parseInt(saved, 8) !== [...copy].reduce((sum, byte) => sum + byte, 0)) fail("TAR_CHECKSUM");
  const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/s, ""); const size = parseInt(header.subarray(124, 136).toString("ascii"), 8); if (name !== "sealed/snapshot.bin" || header[156] !== 0x30 || header.subarray(257, 263).toString("ascii") !== "ustar\0" || parseInt(header.subarray(100, 108).toString("ascii"), 8) !== 0o444) fail("TAR_HEADER");
  const expected = 512 + Math.ceil(size / 512) * 512 + 1024; if (tar.length !== expected || tar.subarray(512 + size).some(byte => byte !== 0)) fail("TAR_TRAILING"); const content = Buffer.from(tar.subarray(512, 512 + size)); decodeSnapshotBundle(content); return { name, mode: "100444", content, transportDigest: sha(tar) };
}
