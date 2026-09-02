import { describe, expect, it } from "vitest";
import {
  RELEASE_GUARDIAN_EXACT_ENVELOPE,
  RELEASE_RULE_SET_ID,
  RELEASE_RULE_SET_VERSION,
  createReleaseGuardianEnvelope,
  parseReleaseGuardianEnvelope,
  verifyHistoricalReleaseCandidateV1ForReplay,
  verifyReleaseCandidate,
} from "./releaseRules";

/**
 * Deliberately duplicated frozen literals. This test must not import the
 * identities it is asserting, or a wrong constant would silently agree with
 * itself. The parity block below is the only place the two are compared.
 */
const exactEnvelope = () => ({
  profile: "release_guardian/v2",
  publicUrl: "https://chukwuemeka001.github.io/workhub-goal-room/",
  demoDurationSeconds: 154,
  verificationCommand: "npm test",
  sourceBaseCommit: "089745dd595934147dcad71ece28097346b709c5",
  candidateManifestSha256: "96d1dc3f7678fcb3159c7d8eb963f199633145579e14adfa51fee64e9b0989c2",
  proofManifestSha256: "a9a9aac7896a3583a0db78ec5e801e906f0872659e1bf6d36922d091b4294c66",
  rollbackPatchSha256: "c78bacab6f06855426deea32ce900323aaba25761ae8133cb99d1e3b738770d4",
});

/** Flip the final hex character so the value stays syntactically valid. */
const mutateLastCharacter = (value: string) =>
  `${value.slice(0, -1)}${value.at(-1) === "0" ? "1" : "0"}`;

const expected = (verdict: "PASS" | "FAIL", findingCodes: string[]) => ({
  ruleSetId: RELEASE_RULE_SET_ID,
  ruleSetVersion: RELEASE_RULE_SET_VERSION,
  verdict,
  findingCodes,
});

describe("frozen v2 package identity parity", () => {
  it("binds the shipped envelope helper to the independently written frozen identities", () => {
    expect({ ...RELEASE_GUARDIAN_EXACT_ENVELOPE }).toEqual(exactEnvelope());
    expect(createReleaseGuardianEnvelope()).toBe(JSON.stringify(exactEnvelope()));
  });

  it("declares the live ruleset as exactly workhub_goal_room_release/v2", () => {
    expect(RELEASE_RULE_SET_ID).toBe("workhub_goal_room_release");
    expect(RELEASE_RULE_SET_VERSION).toBe(2);
  });
});

describe("deterministic release verifier", () => {
  it("rejects the obsolete three-field metadata release object", () => {
    const content = JSON.stringify({
      publicUrl: "https://example.test/goal-room",
      demoDurationSeconds: 180,
      verificationCommand: "npm test",
    });

    expect(verifyReleaseCandidate(content)).toEqual(
      expected("FAIL", ["INVALID_ARTIFACT_SHAPE"]),
    );
  });

  it("passes the exact qualified Release Guardian envelope", () => {
    expect(verifyReleaseCandidate(JSON.stringify(exactEnvelope()))).toEqual(
      expected("PASS", []),
    );
  });

  it("rejects an exact semantic envelope when serialized keys are reordered", () => {
    const reordered = Object.fromEntries(
      Object.entries(exactEnvelope()).reverse(),
    );
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(exactEnvelope()));
    expect(verifyReleaseCandidate(JSON.stringify(reordered))).toEqual(
      expected("FAIL", ["NON_CANONICAL_ARTIFACT_SERIALIZATION"]),
    );
  });

  it.each([
    ["leading whitespace", ` ${JSON.stringify(exactEnvelope())}`],
    ["trailing newline", `${JSON.stringify(exactEnvelope())}\n`],
    ["pretty-printed whitespace", JSON.stringify(exactEnvelope(), null, 2)],
    [
      "duplicate key",
      JSON.stringify(exactEnvelope()).replace(
        '"profile":"release_guardian/v2",',
        '"profile":"release_guardian/v2","profile":"release_guardian/v2",',
      ),
    ],
  ])("rejects %s even when JSON.parse produces the frozen tuple", (_label, content) => {
    expect(JSON.parse(content)).toEqual(exactEnvelope());
    expect(verifyReleaseCandidate(content)).toEqual(
      expected("FAIL", ["NON_CANONICAL_ARTIFACT_SERIALIZATION"]),
    );
  });

  it.each([
    ["candidateManifestSha256", "CANDIDATE_MANIFEST_MISMATCH"],
    ["proofManifestSha256", "PROOF_MANIFEST_MISMATCH"],
    ["rollbackPatchSha256", "ROLLBACK_PATCH_MISMATCH"],
    ["sourceBaseCommit", "SOURCE_BASE_COMMIT_MISMATCH"],
  ] as const)(
    "rejects a one-character mutation of %s with exactly %s",
    (field, findingCode) => {
      const base = exactEnvelope();
      const mutated = mutateLastCharacter(base[field]);
      expect(mutated).not.toBe(base[field]);
      expect(mutated).toHaveLength(base[field].length);

      expect(verifyReleaseCandidate(JSON.stringify({ ...base, [field]: mutated }))).toEqual(
        expected("FAIL", [findingCode]),
      );
    },
  );

  it("rejects a wrong verifier profile with exactly VERIFIER_PROFILE_MISMATCH", () => {
    const content = JSON.stringify({ ...exactEnvelope(), profile: "release_guardian/v1" });
    expect(verifyReleaseCandidate(content)).toEqual(
      expected("FAIL", ["VERIFIER_PROFILE_MISMATCH"]),
    );
  });

  it.each([
    ["a different valid HTTPS public URL", { publicUrl: "https://example.test/workhub-goal-room/" }, "PUBLIC_URL_MISMATCH"],
    ["a non-HTTPS public URL", { publicUrl: "http://chukwuemeka001.github.io/workhub-goal-room/" }, "PUBLIC_URL_MUST_BE_HTTPS"],
    ["an HTTPS prefix with no hostname", { publicUrl: "https://" }, "PUBLIC_URL_MUST_BE_HTTPS"],
    ["a non-string public URL", { publicUrl: 154 }, "PUBLIC_URL_MUST_BE_HTTPS"],
    ["a different in-range demo duration", { demoDurationSeconds: 153 }, "DEMO_DURATION_MISMATCH"],
    ["a demo duration above the bound", { demoDurationSeconds: 181 }, "DEMO_DURATION_OUT_OF_RANGE"],
    ["a zero demo duration", { demoDurationSeconds: 0 }, "DEMO_DURATION_OUT_OF_RANGE"],
    ["a fractional demo duration", { demoDurationSeconds: 154.5 }, "DEMO_DURATION_OUT_OF_RANGE"],
    ["a wrong verification command", { verificationCommand: "npm run build" }, "VERIFICATION_COMMAND_MISMATCH"],
  ])("still deterministically reports %s", (_label, override, findingCode) => {
    const content = JSON.stringify({ ...exactEnvelope(), ...override });
    expect(verifyReleaseCandidate(content)).toEqual(expected("FAIL", [findingCode]));
  });

  it("fails closed on malformed artifact JSON", () => {
    expect(verifyReleaseCandidate("{not-json")).toEqual(
      expected("FAIL", ["INVALID_ARTIFACT_JSON"]),
    );
  });

  it.each([
    ["null root", "null"],
    ["array root", JSON.stringify([exactEnvelope()])],
    ["string root", JSON.stringify("release_guardian/v2")],
    ["extra key", JSON.stringify({ ...exactEnvelope(), approved: true })],
    ["missing identity", JSON.stringify((({ rollbackPatchSha256: _, ...rest }) => rest)(exactEnvelope()))],
    ["renamed identity", JSON.stringify((({ proofManifestSha256, ...rest }) => ({ ...rest, proofManifest: proofManifestSha256 }))(exactEnvelope()))],
  ])("fails closed on %s artifact shape", (_label, content) => {
    expect(verifyReleaseCandidate(content)).toEqual(
      expected("FAIL", ["INVALID_ARTIFACT_SHAPE"]),
    );
  });

  it("returns closed lexically sorted finding codes for a fully wrong envelope", () => {
    const content = JSON.stringify({
      ...exactEnvelope(),
      profile: "release_guardian/v1",
      publicUrl: "http://example.test/goal-room",
      demoDurationSeconds: 181,
      verificationCommand: "npm run build",
      sourceBaseCommit: "f".repeat(40),
      candidateManifestSha256: "f".repeat(64),
      proofManifestSha256: "f".repeat(64),
      rollbackPatchSha256: "f".repeat(64),
    });

    const result = verifyReleaseCandidate(content);
    expect(result).toEqual(
      expected("FAIL", [
        "CANDIDATE_MANIFEST_MISMATCH",
        "DEMO_DURATION_OUT_OF_RANGE",
        "PROOF_MANIFEST_MISMATCH",
        "PUBLIC_URL_MUST_BE_HTTPS",
        "ROLLBACK_PATCH_MISMATCH",
        "SOURCE_BASE_COMMIT_MISMATCH",
        "VERIFICATION_COMMAND_MISMATCH",
        "VERIFIER_PROFILE_MISMATCH",
      ]),
    );
    expect(result.findingCodes).toEqual([...result.findingCodes].sort());
  });

  it("is a pure function of the exact candidate bytes", () => {
    const content = JSON.stringify({
      ...exactEnvelope(),
      proofManifestSha256: mutateLastCharacter(exactEnvelope().proofManifestSha256),
    });
    expect(verifyReleaseCandidate(content)).toEqual(verifyReleaseCandidate(content));
    expect(verifyReleaseCandidate(JSON.stringify(exactEnvelope()))).not.toEqual(
      verifyReleaseCandidate(content),
    );
  });
});

describe("replay-only historical v1 evaluator", () => {
  it("still validates an authentic historical three-field PASS artifact", () => {
    const content = JSON.stringify({
      publicUrl: "https://example.test/production",
      demoDurationSeconds: 180,
      verificationCommand: "npm test",
    });
    expect(verifyHistoricalReleaseCandidateV1ForReplay(content)).toEqual({
      ruleSetId: RELEASE_RULE_SET_ID,
      ruleSetVersion: 1,
      verdict: "PASS",
      findingCodes: [],
    });
  });

  it("still reproduces the exact historical FAIL finding set", () => {
    const content = JSON.stringify({
      publicUrl: "http://example.test/production",
      demoDurationSeconds: 181,
      verificationCommand: "npm run build",
    });
    expect(verifyHistoricalReleaseCandidateV1ForReplay(content)).toEqual({
      ruleSetId: RELEASE_RULE_SET_ID,
      ruleSetVersion: 1,
      verdict: "FAIL",
      findingCodes: [
        "DEMO_DURATION_OUT_OF_RANGE",
        "PUBLIC_URL_MUST_BE_HTTPS",
        "VERIFICATION_COMMAND_MISMATCH",
      ],
    });
  });

  it("cannot be used to bless a v2 envelope: the v1 shape is closed too", () => {
    expect(verifyHistoricalReleaseCandidateV1ForReplay(createReleaseGuardianEnvelope())).toEqual({
      ruleSetId: RELEASE_RULE_SET_ID,
      ruleSetVersion: 1,
      verdict: "FAIL",
      findingCodes: ["INVALID_ARTIFACT_SHAPE"],
    });
  });

  it("never reports the live ruleset version", () => {
    const results = [
      verifyHistoricalReleaseCandidateV1ForReplay("{not-json"),
      verifyHistoricalReleaseCandidateV1ForReplay("null"),
      verifyHistoricalReleaseCandidateV1ForReplay(
        JSON.stringify({ publicUrl: "https://a.test", demoDurationSeconds: 1, verificationCommand: "npm test" }),
      ),
    ];
    for (const result of results) expect(result.ruleSetVersion).toBe(1);
    expect(RELEASE_RULE_SET_VERSION).not.toBe(1);
  });
});

describe("read-only envelope projection", () => {
  it("projects the exact submitted identities without re-deriving them", () => {
    expect(parseReleaseGuardianEnvelope(createReleaseGuardianEnvelope())).toEqual(exactEnvelope());
  });

  it("projects a syntactically valid but unqualified envelope verbatim", () => {
    const stale = { ...exactEnvelope(), proofManifestSha256: "f".repeat(64) };
    expect(parseReleaseGuardianEnvelope(JSON.stringify(stale))).toEqual(stale);
    expect(verifyReleaseCandidate(JSON.stringify(stale)).verdict).toBe("FAIL");
  });

  it.each([
    ["malformed JSON", "{not-json"],
    ["null root", "null"],
    ["array root", "[]"],
    ["empty string", ""],
    ["obsolete three-field object", JSON.stringify({ publicUrl: "https://a.test", demoDurationSeconds: 1, verificationCommand: "npm test" })],
    ["extra key", JSON.stringify({ ...exactEnvelope(), approved: true })],
    ["wrongly typed identity", JSON.stringify({ ...exactEnvelope(), proofManifestSha256: 12 })],
    ["wrongly typed duration", JSON.stringify({ ...exactEnvelope(), demoDurationSeconds: "154" })],
    ["reordered exact envelope", JSON.stringify(Object.fromEntries(Object.entries(exactEnvelope()).reverse()))],
    ["alternate whitespace", JSON.stringify(exactEnvelope(), null, 2)],
  ])("returns null rather than inventing values for %s", (_label, content) => {
    expect(parseReleaseGuardianEnvelope(content)).toBeNull();
  });
});
