#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

export const SOURCE_BASE_COMMIT = "089745dd595934147dcad71ece28097346b709c5";
export const UNCHANGED_AUTHORITY_FILES = Object.freeze([
  "src/ownerController.ts",
  "src/webmcp.ts",
  "src/webmcp-globals.d.ts",
  "src/toolSurfaceView.ts",
]);
export const AUTHORIZED_V2_MIGRATIONS = Object.freeze([
  "src/core/goalRoom.ts",
  "src/verifier/releaseRules.ts",
]);

const execFileAsync = promisify(execFile);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function compareToBase(repoRoot, path) {
  const [{ stdout: baseBytes }, currentBytes] = await Promise.all([
    execFileAsync("git", ["show", `${SOURCE_BASE_COMMIT}:${path}`], {
      cwd: repoRoot,
      encoding: "buffer",
      maxBuffer: 4 * 1024 * 1024,
    }),
    readFile(join(repoRoot, path)),
  ]);
  const baseSha256 = sha256(baseBytes);
  const currentSha256 = sha256(currentBytes);
  return { path, baseSha256, currentSha256, unchanged: baseSha256 === currentSha256 };
}

export async function verifyProtectedParity(repoRoot) {
  const [protectedFiles, authorizedMigrations] = await Promise.all([
    Promise.all(UNCHANGED_AUTHORITY_FILES.map((path) => compareToBase(repoRoot, path))),
    Promise.all(AUTHORIZED_V2_MIGRATIONS.map((path) => compareToBase(repoRoot, path))),
  ]);
  return {
    schemaVersion: 1,
    kind: "workhub-release-integrity-v2-protected-parity",
    sourceBaseCommit: SOURCE_BASE_COMMIT,
    protectedFiles,
    authorizedMigrations,
    matched:
      protectedFiles.every((entry) => entry.unchanged) &&
      authorizedMigrations.every((entry) => !entry.unchanged),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const result = await verifyProtectedParity(repoRoot);
  console.log(JSON.stringify(result, null, 2));
  if (!result.matched) process.exitCode = 1;
}
