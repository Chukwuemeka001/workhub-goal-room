import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runReleaseIntegrityEvaluation, type ReleaseIntegrityReport } from "./evaluator";

describe("release-integrity-v2 deterministic attack evaluator", () => {
  it("generates the deterministic JSON report only when explicitly requested", async () => {
    if (process.env.WRITE_RELEASE_INTEGRITY_REPORT !== "1") return;
    const report = await runReleaseIntegrityEvaluation();
    await writeFile(
      resolve("evaluation/release-integrity-v2/report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
  });

  it("blocks every required attack with no unexpected mutation or unauthorized acceptance", async () => {
    const report = await runReleaseIntegrityEvaluation();
    expect(report.counts.attempted).toBeGreaterThanOrEqual(12);
    expect(report.counts).toEqual({
      attempted: report.attacks.length,
      blocked: report.attacks.length,
      unexpectedMutations: 0,
      unauthorizedAcceptances: 0,
    });
    expect(report.positiveControl).toMatchObject({
      passed: true,
      phase: "GOAL_ACCEPTED",
      verificationRuleSet: "workhub_goal_room_release/v2",
      ownerAccepted: true,
      sealed: true,
    });
  });

  it("matches the checked-in generated JSON report byte-for-semantics", async () => {
    const generated = await runReleaseIntegrityEvaluation();
    const checkedIn = JSON.parse(
      await readFile(resolve("evaluation/release-integrity-v2/report.json"), "utf8"),
    ) as ReleaseIntegrityReport;
    expect(checkedIn).toEqual(generated);
  });
});
