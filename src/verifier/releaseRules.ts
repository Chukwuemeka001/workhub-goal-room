export const RELEASE_RULE_SET_ID = "workhub_goal_room_release" as const;
export const RELEASE_RULE_SET_VERSION = 1 as const;

export type ReleaseFindingCode =
  | "INVALID_ARTIFACT_JSON"
  | "INVALID_ARTIFACT_SHAPE"
  | "PUBLIC_URL_MUST_BE_HTTPS"
  | "DEMO_DURATION_OUT_OF_RANGE"
  | "VERIFICATION_COMMAND_MISMATCH";

export type ReleaseVerificationResult = {
  ruleSetId: typeof RELEASE_RULE_SET_ID;
  ruleSetVersion: typeof RELEASE_RULE_SET_VERSION;
  verdict: "PASS" | "FAIL";
  findingCodes: ReleaseFindingCode[];
};

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
  const expectedKeys = [
    "demoDurationSeconds",
    "publicUrl",
    "verificationCommand",
  ];
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
  if (
    typeof artifact.demoDurationSeconds !== "number" ||
    !Number.isSafeInteger(artifact.demoDurationSeconds) ||
    artifact.demoDurationSeconds < 1 ||
    artifact.demoDurationSeconds > 180
  ) {
    findingCodes.push("DEMO_DURATION_OUT_OF_RANGE");
  }
  if (
    typeof artifact.publicUrl !== "string" ||
    !artifact.publicUrl.startsWith("https://")
  ) {
    findingCodes.push("PUBLIC_URL_MUST_BE_HTTPS");
  }
  if (artifact.verificationCommand !== "npm test") {
    findingCodes.push("VERIFICATION_COMMAND_MISMATCH");
  }
  findingCodes.sort();
  return {
    ruleSetId: RELEASE_RULE_SET_ID,
    ruleSetVersion: RELEASE_RULE_SET_VERSION,
    verdict: findingCodes.length === 0 ? "PASS" : "FAIL",
    findingCodes,
  };
}
