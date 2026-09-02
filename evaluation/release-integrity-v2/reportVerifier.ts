import type { ReleaseIntegrityReport } from "./evaluator";

export const REQUIRED_ATTACK_IDS = [
  "obsolete-three-field-candidate",
  "candidate-manifest-substitution",
  "proof-manifest-substitution",
  "rollback-patch-substitution",
  "source-base-substitution",
  "alternate-valid-https-url",
  "alternate-valid-duration",
  "duplicate-json-key",
  "reordered-json-keys",
  "alternate-json-whitespace",
  "stale-state-version",
  "evidence-mismatch-then-completion",
  "wrong-completion-candidate-digest",
  "externally-authored-system-v1",
  "externally-authored-system-v2",
  "agent-authored-system-verdict",
  "agent-authored-owner-acceptance",
  "cross-candidate-verifier-key-reuse",
  "mutation-after-pass",
  "mutation-after-seal",
  "fabricated-resealed-v1-ledger",
  "spliced-resealed-v1-ledger",
] as const;

const EXPECTED_ATTACKS: Record<
  (typeof REQUIRED_ATTACK_IDS)[number],
  { boundary: string; observation: string }
> = {
  "obsolete-three-field-candidate": { boundary: "closed-v2-envelope", observation: "FAIL:INVALID_ARTIFACT_SHAPE" },
  "candidate-manifest-substitution": { boundary: "closed-v2-envelope", observation: "FAIL:CANDIDATE_MANIFEST_MISMATCH" },
  "proof-manifest-substitution": { boundary: "closed-v2-envelope", observation: "FAIL:PROOF_MANIFEST_MISMATCH" },
  "rollback-patch-substitution": { boundary: "closed-v2-envelope", observation: "FAIL:ROLLBACK_PATCH_MISMATCH" },
  "source-base-substitution": { boundary: "closed-v2-envelope", observation: "FAIL:SOURCE_BASE_COMMIT_MISMATCH" },
  "alternate-valid-https-url": { boundary: "closed-v2-envelope", observation: "FAIL:PUBLIC_URL_MISMATCH" },
  "alternate-valid-duration": { boundary: "closed-v2-envelope", observation: "FAIL:DEMO_DURATION_MISMATCH" },
  "duplicate-json-key": { boundary: "closed-v2-envelope", observation: "FAIL:NON_CANONICAL_ARTIFACT_SERIALIZATION" },
  "reordered-json-keys": { boundary: "closed-v2-envelope", observation: "FAIL:NON_CANONICAL_ARTIFACT_SERIALIZATION" },
  "alternate-json-whitespace": { boundary: "closed-v2-envelope", observation: "FAIL:NON_CANONICAL_ARTIFACT_SERIALIZATION" },
  "stale-state-version": { boundary: "optimistic-concurrency", observation: "false:STALE_STATE" },
  "evidence-mismatch-then-completion": { boundary: "pass-before-completion", observation: "false:VERIFICATION_REQUIRED" },
  "wrong-completion-candidate-digest": { boundary: "candidate-completion-binding", observation: "false:VERIFICATION_REQUIRED" },
  "externally-authored-system-v1": { boundary: "system-verdict-authority", observation: "INVALID_COMMAND" },
  "externally-authored-system-v2": { boundary: "system-verdict-authority", observation: "INVALID_COMMAND" },
  "agent-authored-system-verdict": { boundary: "system-verdict-authority", observation: "INVALID_COMMAND" },
  "agent-authored-owner-acceptance": { boundary: "owner-only-acceptance", observation: "false:OWNER_ONLY" },
  "cross-candidate-verifier-key-reuse": { boundary: "idempotency-candidate-binding", observation: "IDEMPOTENCY_KEY_REUSE" },
  "mutation-after-pass": { boundary: "pass-candidate-immutability", observation: "false:STEP_CLAIM_REQUIRED" },
  "mutation-after-seal": { boundary: "terminal-sealing", observation: "false:STEP_CLAIM_REQUIRED" },
  "fabricated-resealed-v1-ledger": { boundary: "allowlisted-v1-provenance", observation: "HISTORICAL_V1_PROVENANCE_REQUIRED" },
  "spliced-resealed-v1-ledger": { boundary: "allowlisted-v1-provenance", observation: "HISTORICAL_V1_PROVENANCE_REQUIRED" },
};

export function verifyReleaseIntegrityReport(report: ReleaseIntegrityReport): void {
  if (
    report.schemaVersion !== 1 ||
    report.kind !== "workhub-release-integrity-v2" ||
    report.deterministic !== true
  ) {
    throw new Error("INVALID_REPORT_IDENTITY");
  }
  const ids = report.attacks.map((attack) => attack.id);
  if (new Set(ids).size !== ids.length) throw new Error("DUPLICATE_ATTACK_ID");
  for (const required of REQUIRED_ATTACK_IDS) {
    if (!ids.includes(required)) throw new Error(`MISSING_REQUIRED_ATTACK:${required}`);
  }
  if (report.attacks.length !== REQUIRED_ATTACK_IDS.length) {
    throw new Error("ATTACK_ROSTER_MISMATCH");
  }
  for (const attack of report.attacks) {
    const expected = EXPECTED_ATTACKS[attack.id as keyof typeof EXPECTED_ATTACKS];
    if (expected === undefined) throw new Error(`UNEXPECTED_ATTACK_ID:${attack.id}`);
    if (attack.boundary !== expected.boundary || attack.observation !== expected.observation) {
      throw new Error(`ATTACK_OBSERVATION_MISMATCH:${attack.id}`);
    }
    if (!attack.blocked) throw new Error(`UNBLOCKED_ATTACK:${attack.id}`);
    if (attack.unexpectedMutations !== 0) {
      throw new Error(`UNEXPECTED_MUTATION_RECORDED:${attack.id}`);
    }
    if (attack.unauthorizedAcceptances !== 0) {
      throw new Error(`UNAUTHORIZED_ACCEPTANCE_RECORDED:${attack.id}`);
    }
  }
  const expectedCounts = {
    attempted: report.attacks.length,
    blocked: report.attacks.filter((attack) => attack.blocked).length,
    unexpectedMutations: report.attacks.reduce(
      (total, attack) => total + attack.unexpectedMutations,
      0,
    ),
    unauthorizedAcceptances: report.attacks.reduce(
      (total, attack) => total + attack.unauthorizedAcceptances,
      0,
    ),
  };
  if (JSON.stringify(report.counts) !== JSON.stringify(expectedCounts)) {
    throw new Error("ATTACK_COUNT_MISMATCH");
  }
  if (report.counts.blocked !== report.counts.attempted) {
    throw new Error("UNBLOCKED_ATTACK");
  }
  if (report.counts.unexpectedMutations !== 0) {
    throw new Error("UNEXPECTED_MUTATION_RECORDED");
  }
  if (report.counts.unauthorizedAcceptances !== 0) {
    throw new Error("UNAUTHORIZED_ACCEPTANCE_RECORDED");
  }
  if (
    !report.positiveControl.passed ||
    report.positiveControl.phase !== "GOAL_ACCEPTED" ||
    report.positiveControl.verificationRuleSet !== "workhub_goal_room_release/v2" ||
    !report.positiveControl.ownerAccepted ||
    !report.positiveControl.sealed ||
    report.positiveControl.claim !== "The submitted package matched the prequalified identity tuple."
  ) {
    throw new Error("POSITIVE_CONTROL_FAILED");
  }
}
