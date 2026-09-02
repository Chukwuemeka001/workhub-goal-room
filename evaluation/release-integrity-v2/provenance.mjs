#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const FROZEN_PROVENANCE = Object.freeze({
  candidateManifestSha256: "96d1dc3f7678fcb3159c7d8eb963f199633145579e14adfa51fee64e9b0989c2",
  proofManifestSha256: "a9a9aac7896a3583a0db78ec5e801e906f0872659e1bf6d36922d091b4294c66",
  rollbackPatchSha256: "c78bacab6f06855426deea32ce900323aaba25761ae8133cb99d1e3b738770d4",
});

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const normalize = (path) => path.split(sep).join("/");

function assertSafeRepoPath(repoRoot, path) {
  if (typeof path !== "string" || path.length === 0 || isAbsolute(path)) {
    throw new Error(`UNSAFE_ARTIFACT_PATH:${path}`);
  }
  const absolute = resolve(repoRoot, path);
  const local = relative(repoRoot, absolute);
  if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) {
    throw new Error(`UNSAFE_ARTIFACT_PATH:${path}`);
  }
  return { absolute, local: normalize(local) };
}

export function verifyProvenanceBytes({
  candidateManifestBytes,
  proofManifestBytes,
  rollbackPatchBytes,
  expected = FROZEN_PROVENANCE,
}) {
  const actual = {
    candidateManifestSha256: sha256(candidateManifestBytes),
    proofManifestSha256: sha256(proofManifestBytes),
    rollbackPatchSha256: sha256(rollbackPatchBytes),
  };
  const candidate = JSON.parse(candidateManifestBytes.toString("utf8"));
  const referencesValid =
    candidate?.evidencePackageManifestSha256 === expected.proofManifestSha256 &&
    candidate?.rollbackPatch?.sha256 === expected.rollbackPatchSha256;
  const hashesMatch = Object.entries(expected).every(([key, value]) => actual[key] === value);
  return { matched: hashesMatch && referencesValid, hashesMatch, referencesValid, expected, actual };
}

export async function verifyArtifactProvenance({
  repoRoot,
  candidateManifestPath,
  proofManifestPath,
  rollbackPatchPath,
}) {
  const candidate = assertSafeRepoPath(repoRoot, candidateManifestPath);
  const proof = assertSafeRepoPath(repoRoot, proofManifestPath);
  const rollback = assertSafeRepoPath(repoRoot, rollbackPatchPath);
  const reads = await Promise.allSettled([
    readFile(candidate.absolute),
    readFile(proof.absolute),
    readFile(rollback.absolute),
  ]);
  const missing = [candidate.local, proof.local, rollback.local].filter(
    (_path, index) => reads[index].status === "rejected",
  );
  const keys = [
    "candidateManifestSha256",
    "proofManifestSha256",
    "rollbackPatchSha256",
  ];
  const actual = Object.fromEntries(reads.flatMap((entry, index) =>
    entry.status === "fulfilled" ? [[keys[index], sha256(entry.value)]] : []
  ));
  if (missing.length > 0) {
    return {
      matched: false,
      error: "ARTIFACT_BYTES_MISSING",
      missing,
      expected: FROZEN_PROVENANCE,
      actual,
    };
  }
  return verifyProvenanceBytes({
    candidateManifestBytes: reads[0].value,
    proofManifestBytes: reads[1].value,
    rollbackPatchBytes: reads[2].value,
  });
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = resolve(argument("--repo-root", "."));
  const result = await verifyArtifactProvenance({
    repoRoot,
    candidateManifestPath: argument(
      "--candidate-manifest",
      "evaluation/release-integrity-v2/artifacts/candidate-manifest.json",
    ),
    proofManifestPath: argument(
      "--proof-manifest",
      "evaluation/autonomous-webmcp-win-sprint/manifest.json",
    ),
    rollbackPatchPath: argument(
      "--rollback-patch",
      "evaluation/release-integrity-v2/artifacts/rollback.patch",
    ),
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.matched) process.exitCode = 1;
}
