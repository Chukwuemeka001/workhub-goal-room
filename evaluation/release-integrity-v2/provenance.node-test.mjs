import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { verifyProvenanceBytes } from "./provenance.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixture() {
  const proofManifestBytes = Buffer.from("proof-manifest\n");
  const rollbackPatchBytes = Buffer.from("rollback-patch\n");
  const proofManifestSha256 = sha256(proofManifestBytes);
  const rollbackPatchSha256 = sha256(rollbackPatchBytes);
  const candidateManifestBytes = Buffer.from(JSON.stringify({
    schemaVersion: 4,
    kind: "workhub-release-guardian-precommit-candidate",
    evidencePackageManifestSha256: proofManifestSha256,
    rollbackPatch: { path: "ignored-local-only-source-location", sha256: rollbackPatchSha256 },
  }));
  const expected = {
    candidateManifestSha256: sha256(candidateManifestBytes),
    proofManifestSha256,
    rollbackPatchSha256,
  };
  return {
    candidateManifestBytes,
    proofManifestBytes,
    rollbackPatchBytes,
    expected,
  };
}

test("hashes all three real byte inputs and verifies both structural references", () => {
  assert.deepEqual(verifyProvenanceBytes(fixture()), {
    matched: true,
    hashesMatch: true,
    referencesValid: true,
    expected: fixture().expected,
    actual: fixture().expected,
  });
});

test("rejects proof substitution even when the candidate reference is unchanged", () => {
  const input = fixture();
  input.proofManifestBytes = Buffer.from("substituted-proof\n");
  const result = verifyProvenanceBytes(input);
  assert.equal(result.matched, false);
  assert.equal(result.hashesMatch, false);
  assert.equal(result.referencesValid, true);
});

test("rejects rollback substitution even when the candidate reference is unchanged", () => {
  const input = fixture();
  input.rollbackPatchBytes = Buffer.from("substituted-rollback\n");
  const result = verifyProvenanceBytes(input);
  assert.equal(result.matched, false);
  assert.equal(result.hashesMatch, false);
  assert.equal(result.referencesValid, true);
});

test("rejects any candidate-manifest byte substitution", () => {
  const input = fixture();
  input.candidateManifestBytes = Buffer.concat([input.candidateManifestBytes, Buffer.from("\n")]);
  const result = verifyProvenanceBytes(input);
  assert.equal(result.matched, false);
  assert.equal(result.hashesMatch, false);
  assert.equal(result.referencesValid, true);
});

test("validates the authoritative digest fields without exposing or matching the embedded path", () => {
  const input = fixture();
  const candidate = JSON.parse(input.candidateManifestBytes.toString("utf8"));
  candidate.evidencePackageManifestSha256 = "f".repeat(64);
  input.candidateManifestBytes = Buffer.from(JSON.stringify(candidate));
  input.expected = { ...input.expected, candidateManifestSha256: sha256(input.candidateManifestBytes) };
  const result = verifyProvenanceBytes(input);
  assert.equal(result.matched, false);
  assert.equal(result.hashesMatch, true);
  assert.equal(result.referencesValid, false);
  assert.equal(JSON.stringify(result).includes("ignored-local-only-source-location"), false);
});
