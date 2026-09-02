import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ReleaseIntegrityReport } from "./evaluator";
import { verifyReleaseIntegrityReport } from "./reportVerifier";

async function report(): Promise<ReleaseIntegrityReport> {
  return JSON.parse(
    await readFile(resolve("evaluation/release-integrity-v2/report.json"), "utf8"),
  ) as ReleaseIntegrityReport;
}

describe("release-integrity-v2 report verifier", () => {
  it("accepts the exact deterministic evaluator report", async () => {
    const exact = await report();
    expect(() => verifyReleaseIntegrityReport(exact)).not.toThrow();
  });

  it("rejects count laundering", async () => {
    const forged = await report();
    forged.counts.blocked -= 1;
    expect(() => verifyReleaseIntegrityReport(forged)).toThrow("ATTACK_COUNT_MISMATCH");
  });

  it("rejects a missing required attack even if the mutable counts are recomputed", async () => {
    const forged = await report();
    forged.attacks = forged.attacks.filter((attack) => attack.id !== "duplicate-json-key");
    forged.counts.attempted = forged.attacks.length;
    forged.counts.blocked = forged.attacks.length;
    expect(() => verifyReleaseIntegrityReport(forged)).toThrow(
      "MISSING_REQUIRED_ATTACK:duplicate-json-key",
    );
  });

  it("rejects any unauthorized acceptance or unexpected mutation", async () => {
    const unauthorized = await report();
    unauthorized.attacks[0].unauthorizedAcceptances = 1;
    unauthorized.counts.unauthorizedAcceptances = 1;
    expect(() => verifyReleaseIntegrityReport(unauthorized)).toThrow(
      "UNAUTHORIZED_ACCEPTANCE_RECORDED",
    );

    const mutated = await report();
    mutated.attacks[0].unexpectedMutations = 1;
    mutated.counts.unexpectedMutations = 1;
    expect(() => verifyReleaseIntegrityReport(mutated)).toThrow(
      "UNEXPECTED_MUTATION_RECORDED:obsolete-three-field-candidate",
    );
  });

  it("rejects a laundered blocked flag with the wrong observed outcome", async () => {
    const forged = await report();
    forged.attacks[0].observation = "NO_REJECTION";
    forged.attacks[0].blocked = true;
    expect(() => verifyReleaseIntegrityReport(forged)).toThrow(
      "ATTACK_OBSERVATION_MISMATCH:obsolete-three-field-candidate",
    );
  });
});
