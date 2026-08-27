import { describe, expect, it } from "vitest";
import {
  RELEASE_RULE_SET_ID,
  RELEASE_RULE_SET_VERSION,
  verifyReleaseCandidate,
} from "./releaseRules";

describe("deterministic release verifier", () => {
  it("passes an exact valid release artifact", () => {
    const content = JSON.stringify({
      publicUrl: "https://example.test/goal-room",
      demoDurationSeconds: 180,
      verificationCommand: "npm test",
    });

    expect(verifyReleaseCandidate(content)).toEqual({
      ruleSetId: RELEASE_RULE_SET_ID,
      ruleSetVersion: RELEASE_RULE_SET_VERSION,
      verdict: "PASS",
      findingCodes: [],
    });
  });

  it("fails a URL-shaped HTTPS prefix without a hostname", () => {
    const content = JSON.stringify({
      publicUrl: "https://",
      demoDurationSeconds: 1,
      verificationCommand: "npm test",
    });

    expect(verifyReleaseCandidate(content)).toEqual({
      ruleSetId: RELEASE_RULE_SET_ID,
      ruleSetVersion: RELEASE_RULE_SET_VERSION,
      verdict: "FAIL",
      findingCodes: ["PUBLIC_URL_MUST_BE_HTTPS"],
    });
  });

  it("fails closed on malformed artifact JSON", () => {
    expect(verifyReleaseCandidate("{not-json")).toEqual({
      ruleSetId: RELEASE_RULE_SET_ID,
      ruleSetVersion: RELEASE_RULE_SET_VERSION,
      verdict: "FAIL",
      findingCodes: ["INVALID_ARTIFACT_JSON"],
    });
  });

  it.each([
    ["null root", "null"],
    ["extra key", JSON.stringify({
      publicUrl: "https://example.test/goal-room",
      demoDurationSeconds: 180,
      verificationCommand: "npm test",
      approved: true,
    })],
  ])("fails closed on %s artifact shape", (_label, content) => {
    expect(verifyReleaseCandidate(content)).toEqual({
      ruleSetId: RELEASE_RULE_SET_ID,
      ruleSetVersion: RELEASE_RULE_SET_VERSION,
      verdict: "FAIL",
      findingCodes: ["INVALID_ARTIFACT_SHAPE"],
    });
  });

  it("returns closed sorted finding codes for a failing release artifact", () => {
    const content = JSON.stringify({
      publicUrl: "http://example.test/goal-room",
      demoDurationSeconds: 181,
      verificationCommand: "npm run build",
    });

    expect(verifyReleaseCandidate(content)).toEqual({
      ruleSetId: RELEASE_RULE_SET_ID,
      ruleSetVersion: RELEASE_RULE_SET_VERSION,
      verdict: "FAIL",
      findingCodes: [
        "DEMO_DURATION_OUT_OF_RANGE",
        "PUBLIC_URL_MUST_BE_HTTPS",
        "VERIFICATION_COMMAND_MISMATCH",
      ],
    });
  });
});
