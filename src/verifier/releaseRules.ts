export const RELEASE_RULE_SET_ID = "workhub_goal_room_release" as const;
export const RELEASE_RULE_SET_VERSION = 2 as const;

export const RELEASE_GUARDIAN_PROFILE = "release_guardian/v2" as const;
export const RELEASE_GUARDIAN_SOURCE_BASE_COMMIT =
  "089745dd595934147dcad71ece28097346b709c5" as const;
export const RELEASE_GUARDIAN_CANDIDATE_MANIFEST_SHA256 =
  "96d1dc3f7678fcb3159c7d8eb963f199633145579e14adfa51fee64e9b0989c2" as const;
export const RELEASE_GUARDIAN_PROOF_MANIFEST_SHA256 =
  "a9a9aac7896a3583a0db78ec5e801e906f0872659e1bf6d36922d091b4294c66" as const;
export const RELEASE_GUARDIAN_ROLLBACK_PATCH_SHA256 =
  "c78bacab6f06855426deea32ce900323aaba25761ae8133cb99d1e3b738770d4" as const;
export const RELEASE_GUARDIAN_CANONICAL_ENVELOPE_SHA256 =
  "850d1b62cb4243650372ded9c3ba50926c9b304467d13e9705c03f3d2684fb15" as const;
export const RELEASE_MATCHED_TUPLE_STATEMENT =
  "The submitted package matched the prequalified identity tuple." as const;
export const RELEASE_VERIFICATION_CLAIM_BOUNDARY =
  "WorkHub did not run tests, inspect deployment bytes, measure duration, validate rollback applicability, or independently prove the manifests belong together." as const;

export type ReleaseGuardianEnvelope = {
  profile: typeof RELEASE_GUARDIAN_PROFILE;
  publicUrl: string;
  demoDurationSeconds: number;
  verificationCommand: string;
  sourceBaseCommit: string;
  candidateManifestSha256: string;
  proofManifestSha256: string;
  rollbackPatchSha256: string;
};

export const RELEASE_GUARDIAN_EXACT_ENVELOPE: Readonly<ReleaseGuardianEnvelope> = Object.freeze({
  profile: RELEASE_GUARDIAN_PROFILE,
  publicUrl: "https://chukwuemeka001.github.io/workhub-goal-room/",
  demoDurationSeconds: 154,
  verificationCommand: "npm test",
  sourceBaseCommit: RELEASE_GUARDIAN_SOURCE_BASE_COMMIT,
  candidateManifestSha256: RELEASE_GUARDIAN_CANDIDATE_MANIFEST_SHA256,
  proofManifestSha256: RELEASE_GUARDIAN_PROOF_MANIFEST_SHA256,
  rollbackPatchSha256: RELEASE_GUARDIAN_ROLLBACK_PATCH_SHA256,
});

/**
 * The sole trusted v2 byte layout. Property order and whitespace are part of
 * the qualified identity, so callers must not serialize the object themselves.
 */
export function serializeReleaseGuardianEnvelope(
  envelope: ReleaseGuardianEnvelope,
): string {
  return JSON.stringify({
    profile: envelope.profile,
    publicUrl: envelope.publicUrl,
    demoDurationSeconds: envelope.demoDurationSeconds,
    verificationCommand: envelope.verificationCommand,
    sourceBaseCommit: envelope.sourceBaseCommit,
    candidateManifestSha256: envelope.candidateManifestSha256,
    proofManifestSha256: envelope.proofManifestSha256,
    rollbackPatchSha256: envelope.rollbackPatchSha256,
  });
}

export function createReleaseGuardianEnvelope(
  overrides: Partial<ReleaseGuardianEnvelope> = {},
): string {
  return serializeReleaseGuardianEnvelope({
    ...RELEASE_GUARDIAN_EXACT_ENVELOPE,
    ...overrides,
  });
}

export const RELEASE_ENVELOPE_KEYS = [
  "candidateManifestSha256",
  "demoDurationSeconds",
  "profile",
  "proofManifestSha256",
  "publicUrl",
  "rollbackPatchSha256",
  "sourceBaseCommit",
  "verificationCommand",
] as const;

export const RELEASE_V2_PASSED_CHECKS = [
  "Candidate bytes use the trusted canonical v2 serialization",
  "Closed envelope shape: exactly the eight release_guardian/v2 keys",
  "Verifier profile is exactly release_guardian/v2",
  "Source base commit declaration matched the prequalified identity tuple",
  "Candidate manifest SHA-256 declaration matched the prequalified identity tuple",
  "Proof manifest SHA-256 declaration matched the prequalified identity tuple",
  "Rollback patch SHA-256 declaration matched the prequalified identity tuple",
  "Public URL declaration matches the frozen GitHub Pages URL",
  "Demo duration declaration is exactly 154 seconds",
  "Verification command declaration is exactly npm test",
] as const;

/**
 * Read-only projection of an already-submitted candidate. Returns null for
 * anything that is not an exactly shaped v2 envelope so display layers can omit
 * release bindings instead of inventing values. Shape only: this never asserts
 * that the identities are the qualified ones.
 */
export function parseReleaseGuardianEnvelope(
  content: string,
): ReleaseGuardianEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(parsed).sort().join("\n") !== [...RELEASE_ENVELOPE_KEYS].join("\n")
  ) {
    return null;
  }
  const artifact = parsed as Record<string, unknown>;
  if (
    typeof artifact.profile !== "string" ||
    typeof artifact.publicUrl !== "string" ||
    typeof artifact.verificationCommand !== "string" ||
    typeof artifact.sourceBaseCommit !== "string" ||
    typeof artifact.candidateManifestSha256 !== "string" ||
    typeof artifact.proofManifestSha256 !== "string" ||
    typeof artifact.rollbackPatchSha256 !== "string" ||
    typeof artifact.demoDurationSeconds !== "number" ||
    !Number.isSafeInteger(artifact.demoDurationSeconds)
  ) {
    return null;
  }
  const envelope: ReleaseGuardianEnvelope = {
    profile: artifact.profile as ReleaseGuardianEnvelope["profile"],
    publicUrl: artifact.publicUrl,
    demoDurationSeconds: artifact.demoDurationSeconds,
    verificationCommand: artifact.verificationCommand,
    sourceBaseCommit: artifact.sourceBaseCommit,
    candidateManifestSha256: artifact.candidateManifestSha256,
    proofManifestSha256: artifact.proofManifestSha256,
    rollbackPatchSha256: artifact.rollbackPatchSha256,
  };
  return content === serializeReleaseGuardianEnvelope(envelope) ? envelope : null;
}

export type ReleaseFindingCode =
  | "INVALID_ARTIFACT_JSON"
  | "INVALID_ARTIFACT_SHAPE"
  | "NON_CANONICAL_ARTIFACT_SERIALIZATION"
  | "PUBLIC_URL_MUST_BE_HTTPS"
  | "PUBLIC_URL_MISMATCH"
  | "DEMO_DURATION_OUT_OF_RANGE"
  | "DEMO_DURATION_MISMATCH"
  | "VERIFICATION_COMMAND_MISMATCH"
  | "VERIFIER_PROFILE_MISMATCH"
  | "SOURCE_BASE_COMMIT_MISMATCH"
  | "CANDIDATE_MANIFEST_MISMATCH"
  | "PROOF_MANIFEST_MISMATCH"
  | "ROLLBACK_PATCH_MISMATCH";

export type ReleaseVerificationResult = {
  ruleSetId: typeof RELEASE_RULE_SET_ID;
  ruleSetVersion: typeof RELEASE_RULE_SET_VERSION;
  verdict: "PASS" | "FAIL";
  findingCodes: ReleaseFindingCode[];
};

function isValidHttpsUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

export function verifyReleaseCandidate(content: string): ReleaseVerificationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      ruleSetId: RELEASE_RULE_SET_ID,
      ruleSetVersion: RELEASE_RULE_SET_VERSION,
      verdict: "FAIL",
      findingCodes: ["INVALID_ARTIFACT_JSON"],
    };
  }
  const expectedKeys = [...RELEASE_ENVELOPE_KEYS];
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(parsed).sort().join("\n") !== expectedKeys.join("\n")
  ) {
    return {
      ruleSetId: RELEASE_RULE_SET_ID,
      ruleSetVersion: RELEASE_RULE_SET_VERSION,
      verdict: "FAIL",
      findingCodes: ["INVALID_ARTIFACT_SHAPE"],
    };
  }
  const artifact = parsed as Record<string, unknown>;
  const findingCodes: ReleaseFindingCode[] = [];
  const canonicalArtifact = JSON.stringify({
    profile: artifact.profile,
    publicUrl: artifact.publicUrl,
    demoDurationSeconds: artifact.demoDurationSeconds,
    verificationCommand: artifact.verificationCommand,
    sourceBaseCommit: artifact.sourceBaseCommit,
    candidateManifestSha256: artifact.candidateManifestSha256,
    proofManifestSha256: artifact.proofManifestSha256,
    rollbackPatchSha256: artifact.rollbackPatchSha256,
  });
  if (content !== canonicalArtifact) {
    findingCodes.push("NON_CANONICAL_ARTIFACT_SERIALIZATION");
  }
  if (
    typeof artifact.demoDurationSeconds !== "number" ||
    !Number.isSafeInteger(artifact.demoDurationSeconds) ||
    artifact.demoDurationSeconds < 1 ||
    artifact.demoDurationSeconds > 180
  ) {
    findingCodes.push("DEMO_DURATION_OUT_OF_RANGE");
  } else if (artifact.demoDurationSeconds !== RELEASE_GUARDIAN_EXACT_ENVELOPE.demoDurationSeconds) {
    findingCodes.push("DEMO_DURATION_MISMATCH");
  }
  if (!isValidHttpsUrl(artifact.publicUrl)) {
    findingCodes.push("PUBLIC_URL_MUST_BE_HTTPS");
  } else if (artifact.publicUrl !== RELEASE_GUARDIAN_EXACT_ENVELOPE.publicUrl) {
    findingCodes.push("PUBLIC_URL_MISMATCH");
  }
  if (artifact.verificationCommand !== "npm test") {
    findingCodes.push("VERIFICATION_COMMAND_MISMATCH");
  }
  if (artifact.profile !== RELEASE_GUARDIAN_PROFILE) {
    findingCodes.push("VERIFIER_PROFILE_MISMATCH");
  }
  if (artifact.sourceBaseCommit !== RELEASE_GUARDIAN_SOURCE_BASE_COMMIT) {
    findingCodes.push("SOURCE_BASE_COMMIT_MISMATCH");
  }
  if (artifact.candidateManifestSha256 !== RELEASE_GUARDIAN_CANDIDATE_MANIFEST_SHA256) {
    findingCodes.push("CANDIDATE_MANIFEST_MISMATCH");
  }
  if (artifact.proofManifestSha256 !== RELEASE_GUARDIAN_PROOF_MANIFEST_SHA256) {
    findingCodes.push("PROOF_MANIFEST_MISMATCH");
  }
  if (artifact.rollbackPatchSha256 !== RELEASE_GUARDIAN_ROLLBACK_PATCH_SHA256) {
    findingCodes.push("ROLLBACK_PATCH_MISMATCH");
  }
  findingCodes.sort();
  return {
    ruleSetId: RELEASE_RULE_SET_ID,
    ruleSetVersion: RELEASE_RULE_SET_VERSION,
    verdict: findingCodes.length === 0 ? "PASS" : "FAIL",
    findingCodes,
  };
}

export function verifyHistoricalReleaseCandidateV1ForReplay(content: string): {
  ruleSetId: typeof RELEASE_RULE_SET_ID;
  ruleSetVersion: 1;
  verdict: "PASS" | "FAIL";
  findingCodes: ReleaseFindingCode[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      ruleSetId: RELEASE_RULE_SET_ID,
      ruleSetVersion: 1,
      verdict: "FAIL",
      findingCodes: ["INVALID_ARTIFACT_JSON"],
    };
  }
  const expectedKeys = ["demoDurationSeconds", "publicUrl", "verificationCommand"];
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(parsed).sort().join("\n") !== expectedKeys.join("\n")
  ) {
    return {
      ruleSetId: RELEASE_RULE_SET_ID,
      ruleSetVersion: 1,
      verdict: "FAIL",
      findingCodes: ["INVALID_ARTIFACT_SHAPE"],
    };
  }
  const artifact = parsed as Record<string, unknown>;
  const findingCodes: ReleaseFindingCode[] = [];
  if (
    typeof artifact.demoDurationSeconds !== "number" ||
    !Number.isSafeInteger(artifact.demoDurationSeconds) ||
    artifact.demoDurationSeconds < 1 ||
    artifact.demoDurationSeconds > 180
  ) findingCodes.push("DEMO_DURATION_OUT_OF_RANGE");
  if (!isValidHttpsUrl(artifact.publicUrl)) findingCodes.push("PUBLIC_URL_MUST_BE_HTTPS");
  if (artifact.verificationCommand !== "npm test") findingCodes.push("VERIFICATION_COMMAND_MISMATCH");
  findingCodes.sort();
  return {
    ruleSetId: RELEASE_RULE_SET_ID,
    ruleSetVersion: 1,
    verdict: findingCodes.length === 0 ? "PASS" : "FAIL",
    findingCodes,
  };
}
