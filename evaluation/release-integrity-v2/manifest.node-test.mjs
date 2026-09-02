import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { verifyArtifactProvenance } from "./provenance.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(root, "../..");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const PACKET_INVENTORY = [
  "README.md",
  "evaluator.test.ts",
  "evaluator.ts",
  "manifest.node-test.mjs",
  "protectedParity.mjs",
  "protectedParity.node-test.mjs",
  "provenance.mjs",
  "provenance.node-test.mjs",
  "report.json",
  "reportVerifier.test.ts",
  "reportVerifier.ts",
];

test("packet manifest binds the exact local evaluation inventory and bytes", async () => {
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  const actualPaths = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name !== "manifest.json")
    .map((entry) => entry.name)
    .sort();
  const listedPaths = manifest.files.map((entry) => entry.path).sort();
  assert.deepEqual(actualPaths, PACKET_INVENTORY);
  assert.deepEqual(actualPaths, listedPaths);
  for (const entry of manifest.files) {
    const bytes = await readFile(join(root, entry.path));
    assert.equal(bytes.length, entry.bytes, `${entry.path}: byte length`);
    assert.equal(sha256(bytes), entry.sha256, `${entry.path}: SHA-256`);
  }
});

test("packet records the qualified frozen gate without publishing local-only inputs", async () => {
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  const provenance = await verifyArtifactProvenance({
    repoRoot,
    candidateManifestPath: "evaluation/release-integrity-v2/artifacts/candidate-manifest.json",
    proofManifestPath: "evaluation/autonomous-webmcp-win-sprint/manifest.json",
    rollbackPatchPath: "evaluation/release-integrity-v2/artifacts/rollback.patch",
  });
  const recorded = {
    candidateManifestSha256: manifest.frozenArtifactGate.candidateManifestSha256,
    proofManifestSha256: manifest.frozenArtifactGate.proofManifestSha256,
    rollbackPatchSha256: manifest.frozenArtifactGate.rollbackPatchSha256,
  };
  assert.deepEqual(manifest.frozenArtifactGate.actualSha256, recorded);
  assert.equal(manifest.frozenArtifactGate.exactInputHashesMatch, true);
  assert.equal(manifest.frozenArtifactGate.structuralReferencesMatch, true);
  assert.equal(manifest.frozenArtifactGate.matched, true);
  assert.deepEqual(manifest.frozenArtifactGate.missing, []);
  assert.deepEqual(manifest.localOnlyProvenanceInputs, [
    {
      role: "candidate-manifest",
      path: "artifacts/candidate-manifest.json",
      sha256: recorded.candidateManifestSha256,
      publicationReady: false,
    },
    {
      role: "rollback-patch",
      path: "artifacts/rollback.patch",
      sha256: recorded.rollbackPatchSha256,
      publicationReady: false,
    },
  ]);
  if (provenance.error === "ARTIFACT_BYTES_MISSING") {
    assert.deepEqual(provenance.expected, recorded);
    assert.deepEqual(provenance.missing.sort(), [
      "evaluation/release-integrity-v2/artifacts/candidate-manifest.json",
      "evaluation/release-integrity-v2/artifacts/rollback.patch",
    ]);
    assert.equal(provenance.actual.proofManifestSha256, recorded.proofManifestSha256);
    return;
  }
  assert.equal(provenance.matched, true);
  assert.deepEqual(provenance.expected, recorded);
  assert.deepEqual(provenance.actual, recorded);
});
