import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  createGoalRoom,
  replayGoalRoom,
  type Command,
  type Receipt,
} from "../../src/core/goalRoom";
import {
  RELEASE_MATCHED_TUPLE_STATEMENT,
  RELEASE_GUARDIAN_SOURCE_BASE_COMMIT,
  createReleaseGuardianEnvelope,
  verifyReleaseCandidate,
} from "../../src/verifier/releaseRules";

const execFileAsync = promisify(execFile);

type AttackResult = {
  id: string;
  boundary: string;
  blocked: boolean;
  unexpectedMutations: number;
  unauthorizedAcceptances: number;
  observation: string;
};

export type ReleaseIntegrityReport = {
  schemaVersion: 1;
  kind: "workhub-release-integrity-v2";
  deterministic: true;
  attacks: AttackResult[];
  counts: {
    attempted: number;
    blocked: number;
    unexpectedMutations: number;
    unauthorizedAcceptances: number;
  };
  positiveControl: {
    passed: boolean;
    phase: string;
    candidateSha256: string;
    verificationRuleSet: string;
    ownerAccepted: boolean;
    sealed: boolean;
    claim: typeof RELEASE_MATCHED_TUPLE_STATEMENT;
  };
};

async function digestText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

async function rehashLedger(receipts: Receipt[]): Promise<Receipt[]> {
  let previousHash = "GENESIS";
  const rebuilt: Receipt[] = [];
  for (const [index, receipt] of receipts.entries()) {
    const body = {
      sequence: index + 1,
      previousHash,
      command: receipt.command,
      accepted: receipt.accepted,
      ...(receipt.reasonCode ? { reasonCode: receipt.reasonCode } : {}),
      ...(receipt.missingConditions
        ? { missingConditions: receipt.missingConditions }
        : {}),
      stateVersion: receipt.stateVersion,
    };
    previousHash = await digestText(canonical(body));
    rebuilt.push({ ...body, hash: previousHash });
  }
  return rebuilt;
}

async function historicalV1Receipts(): Promise<Receipt[]> {
  const { stdout } = await execFileAsync(
    "git",
    [
      "show",
      `${RELEASE_GUARDIAN_SOURCE_BASE_COMMIT}:evaluation/production-journey/journey.json`,
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  const evidence = JSON.parse(stdout) as { receipts?: unknown };
  if (!Array.isArray(evidence.receipts)) {
    throw new Error("HISTORICAL_V1_EVIDENCE_MISSING");
  }
  return structuredClone(evidence.receipts as Receipt[]);
}

async function claimedRoom() {
  const room = createGoalRoom({ goal: "Evaluate release integrity", doneLooksLike: ["Owner accepts exact evidence"] });
  await room.dispatch({
    type: "PROPOSE_PLAN",
    actor: "agent",
    expectedStateVersion: 0,
    idempotencyKey: "plan",
    steps: [{ id: "release", title: "Evaluate the release envelope" }],
  });
  await room.dispatch({
    type: "CONFIRM_PLAN",
    actor: "owner",
    expectedStateVersion: 1,
    idempotencyKey: "confirm-plan",
    planVersion: 1,
  });
  await room.dispatch({
    type: "CLAIM_STEP",
    actor: "agent",
    expectedStateVersion: 2,
    idempotencyKey: "claim",
    planVersion: 1,
    stepId: "release",
  });
  return room;
}

async function submitCandidate(
  room: ReturnType<typeof createGoalRoom>,
  content: string,
  idempotencyKey: string,
) {
  const candidateSha256 = await digestText(content);
  const result = await room.dispatch({
    type: "SUBMIT_CANDIDATE",
    actor: "agent",
    expectedStateVersion: room.getState().stateVersion,
    idempotencyKey,
    planVersion: 1,
    stepId: "release",
    content,
    sha256: candidateSha256,
  });
  if (!result.accepted) throw new Error(`candidate setup failed: ${result.reasonCode}`);
  return candidateSha256;
}

function blockedResult(
  id: string,
  boundary: string,
  blocked: boolean,
  observation: string,
  unexpectedMutations = 0,
  unauthorizedAcceptances = 0,
): AttackResult {
  return { id, boundary, blocked, unexpectedMutations, unauthorizedAcceptances, observation };
}

function verifierAttack(
  id: string,
  content: string,
  expectedFinding: string,
): AttackResult {
  const result = verifyReleaseCandidate(content);
  return blockedResult(
    id,
    "closed-v2-envelope",
    result.verdict === "FAIL" && result.findingCodes.includes(expectedFinding as never),
    `${result.verdict}:${result.findingCodes.join(",")}`,
  );
}

async function exactAcceptedRoom() {
  const room = await claimedRoom();
  const candidateSha256 = await submitCandidate(room, createReleaseGuardianEnvelope(), "candidate-exact");
  await room.verifyActiveCandidate("verify-exact");
  await room.dispatch({
    type: "REQUEST_COMPLETION",
    actor: "agent",
    expectedStateVersion: room.getState().stateVersion,
    idempotencyKey: "completion-exact",
    candidateSha256,
  });
  return { room, candidateSha256 };
}

export async function runReleaseIntegrityEvaluation(): Promise<ReleaseIntegrityReport> {
  const exact = createReleaseGuardianEnvelope();
  const parsed = JSON.parse(exact) as Record<string, unknown>;
  const attacks: AttackResult[] = [
    verifierAttack("obsolete-three-field-candidate", JSON.stringify({
      publicUrl: parsed.publicUrl,
      demoDurationSeconds: parsed.demoDurationSeconds,
      verificationCommand: parsed.verificationCommand,
    }), "INVALID_ARTIFACT_SHAPE"),
    verifierAttack("candidate-manifest-substitution", createReleaseGuardianEnvelope({ candidateManifestSha256: "f".repeat(64) }), "CANDIDATE_MANIFEST_MISMATCH"),
    verifierAttack("proof-manifest-substitution", createReleaseGuardianEnvelope({ proofManifestSha256: "f".repeat(64) }), "PROOF_MANIFEST_MISMATCH"),
    verifierAttack("rollback-patch-substitution", createReleaseGuardianEnvelope({ rollbackPatchSha256: "f".repeat(64) }), "ROLLBACK_PATCH_MISMATCH"),
    verifierAttack("source-base-substitution", createReleaseGuardianEnvelope({ sourceBaseCommit: "f".repeat(40) }), "SOURCE_BASE_COMMIT_MISMATCH"),
    verifierAttack("alternate-valid-https-url", createReleaseGuardianEnvelope({ publicUrl: "https://example.test/workhub-goal-room/" }), "PUBLIC_URL_MISMATCH"),
    verifierAttack("alternate-valid-duration", createReleaseGuardianEnvelope({ demoDurationSeconds: 153 }), "DEMO_DURATION_MISMATCH"),
    verifierAttack("duplicate-json-key", exact.replace(
      '"profile":"release_guardian/v2",',
      '"profile":"release_guardian/v2","profile":"release_guardian/v2",',
    ), "NON_CANONICAL_ARTIFACT_SERIALIZATION"),
    verifierAttack("reordered-json-keys", JSON.stringify(Object.fromEntries(Object.entries(parsed).reverse())), "NON_CANONICAL_ARTIFACT_SERIALIZATION"),
    verifierAttack("alternate-json-whitespace", JSON.stringify(parsed, null, 2), "NON_CANONICAL_ARTIFACT_SERIALIZATION"),
  ];

  {
    const room = await claimedRoom();
    const before = room.getState();
    const result = await room.dispatch({
      type: "SUBMIT_CANDIDATE",
      actor: "agent",
      expectedStateVersion: before.stateVersion - 1,
      idempotencyKey: "stale-candidate",
      planVersion: 1,
      stepId: "release",
      content: exact,
      sha256: await digestText(exact),
    });
    const after = room.getState();
    attacks.push(blockedResult(
      "stale-state-version",
      "optimistic-concurrency",
      !result.accepted && result.reasonCode === "STALE_STATE" && canonical(after) === canonical(before),
      `${result.accepted}:${result.reasonCode}`,
      canonical(after) === canonical(before) ? 0 : 1,
    ));
  }

  {
    const room = await claimedRoom();
    const candidateSha256 = await submitCandidate(
      room,
      createReleaseGuardianEnvelope({ proofManifestSha256: "f".repeat(64) }),
      "failed-candidate",
    );
    await room.verifyActiveCandidate("failed-verification");
    const before = room.getState();
    const result = await room.dispatch({
      type: "REQUEST_COMPLETION",
      actor: "agent",
      expectedStateVersion: before.stateVersion,
      idempotencyKey: "completion-after-fail",
      candidateSha256,
    });
    const after = room.getState();
    attacks.push(blockedResult(
      "evidence-mismatch-then-completion",
      "pass-before-completion",
      !result.accepted && result.reasonCode === "VERIFICATION_REQUIRED" && canonical(after) === canonical(before),
      `${result.accepted}:${result.reasonCode}`,
      canonical(after) === canonical(before) ? 0 : 1,
    ));
  }

  {
    const room = await claimedRoom();
    await submitCandidate(room, exact, "candidate");
    await room.verifyActiveCandidate("verification");
    const before = room.getState();
    const result = await room.dispatch({
      type: "REQUEST_COMPLETION",
      actor: "agent",
      expectedStateVersion: before.stateVersion,
      idempotencyKey: "wrong-completion-digest",
      candidateSha256: "f".repeat(64),
    });
    const after = room.getState();
    attacks.push(blockedResult(
      "wrong-completion-candidate-digest",
      "candidate-completion-binding",
      !result.accepted && result.reasonCode === "VERIFICATION_REQUIRED" && canonical(after) === canonical(before),
      `${result.accepted}:${result.reasonCode}`,
      canonical(after) === canonical(before) ? 0 : 1,
    ));
  }

  for (const ruleSetVersion of [1, 2] as const) {
    const room = await claimedRoom();
    const candidateSha256 = await submitCandidate(room, exact, `candidate-system-${ruleSetVersion}`);
    const before = room.getState();
    let observation = "NO_REJECTION";
    try {
      await room.dispatch({
        type: "RECORD_VERIFICATION",
        actor: "system",
        expectedStateVersion: before.stateVersion,
        idempotencyKey: `external-system-v${ruleSetVersion}`,
        candidateSha256,
        ruleSetId: "workhub_goal_room_release",
        ruleSetVersion,
        verdict: "PASS",
        findingCodes: [],
      } as never);
    } catch (error) {
      observation = error instanceof Error ? error.message : String(error);
    }
    const after = room.getState();
    attacks.push(blockedResult(
      `externally-authored-system-v${ruleSetVersion}`,
      "system-verdict-authority",
      observation === "INVALID_COMMAND" && canonical(after) === canonical(before),
      observation,
      canonical(after) === canonical(before) ? 0 : 1,
    ));
  }

  {
    const room = await claimedRoom();
    const candidateSha256 = await submitCandidate(room, exact, "candidate-agent-system");
    const before = room.getState();
    let observation = "NO_REJECTION";
    try {
      await room.dispatch({
        type: "RECORD_VERIFICATION",
        actor: "agent",
        expectedStateVersion: before.stateVersion,
        idempotencyKey: "agent-system-verdict",
        candidateSha256,
        ruleSetId: "workhub_goal_room_release",
        ruleSetVersion: 2,
        verdict: "PASS",
        findingCodes: [],
      } as never);
    } catch (error) {
      observation = error instanceof Error ? error.message : String(error);
    }
    const after = room.getState();
    attacks.push(blockedResult(
      "agent-authored-system-verdict",
      "system-verdict-authority",
      observation === "INVALID_COMMAND" && canonical(after) === canonical(before),
      observation,
      canonical(after) === canonical(before) ? 0 : 1,
    ));
  }

  {
    const { room, candidateSha256 } = await exactAcceptedRoom();
    const before = room.getState();
    const result = await room.dispatch({
      type: "ACCEPT_GOAL",
      actor: "agent",
      expectedStateVersion: before.stateVersion,
      idempotencyKey: "agent-owner-attempt",
      candidateSha256,
    });
    const after = room.getState();
    const unauthorized = after.goalAcceptance === null ? 0 : 1;
    attacks.push(blockedResult(
      "agent-authored-owner-acceptance",
      "owner-only-acceptance",
      !result.accepted && result.reasonCode === "OWNER_ONLY" && canonical(after) === canonical(before),
      `${result.accepted}:${result.reasonCode}`,
      canonical(after) === canonical(before) ? 0 : 1,
      unauthorized,
    ));
  }

  {
    const room = await claimedRoom();
    await submitCandidate(room, createReleaseGuardianEnvelope({ proofManifestSha256: "f".repeat(64) }), "candidate-a");
    await room.verifyActiveCandidate("shared-verifier-key");
    await submitCandidate(room, exact, "candidate-b");
    const before = room.getState();
    let observation = "NO_REJECTION";
    try {
      await room.verifyActiveCandidate("shared-verifier-key");
    } catch (error) {
      observation = error instanceof Error ? error.message : String(error);
    }
    const after = room.getState();
    attacks.push(blockedResult(
      "cross-candidate-verifier-key-reuse",
      "idempotency-candidate-binding",
      observation === "IDEMPOTENCY_KEY_REUSE" && canonical(after) === canonical(before),
      observation,
      canonical(after) === canonical(before) ? 0 : 1,
    ));
  }

  {
    const room = await claimedRoom();
    const candidateSha256 = await submitCandidate(room, exact, "pass-candidate");
    await room.verifyActiveCandidate("pass-verification");
    const before = room.getState();
    const mutated = createReleaseGuardianEnvelope({ proofManifestSha256: "f".repeat(64) });
    const result = await room.dispatch({
      type: "SUBMIT_CANDIDATE",
      actor: "agent",
      expectedStateVersion: before.stateVersion,
      idempotencyKey: "mutation-after-pass",
      planVersion: 1,
      stepId: "release",
      content: mutated,
      sha256: await digestText(mutated),
    });
    const after = room.getState();
    attacks.push(blockedResult(
      "mutation-after-pass",
      "pass-candidate-immutability",
      !result.accepted && after.activeCandidate?.sha256 === candidateSha256 && canonical(after) === canonical(before),
      `${result.accepted}:${result.reasonCode}`,
      canonical(after) === canonical(before) ? 0 : 1,
    ));
  }

  {
    const { room, candidateSha256 } = await exactAcceptedRoom();
    await room.dispatch({
      type: "ACCEPT_GOAL",
      actor: "owner",
      expectedStateVersion: room.getState().stateVersion,
      idempotencyKey: "owner-accept",
      candidateSha256,
    });
    const before = room.getState();
    const mutated = createReleaseGuardianEnvelope({ proofManifestSha256: "f".repeat(64) });
    const result = await room.dispatch({
      type: "SUBMIT_CANDIDATE",
      actor: "agent",
      expectedStateVersion: before.stateVersion,
      idempotencyKey: "mutation-after-seal",
      planVersion: 1,
      stepId: "release",
      content: mutated,
      sha256: await digestText(mutated),
    });
    const after = room.getState();
    attacks.push(blockedResult(
      "mutation-after-seal",
      "terminal-sealing",
      !result.accepted &&
        after.phase === "GOAL_ACCEPTED" &&
        after.activeCandidate?.sha256 === candidateSha256 &&
        canonical(after) === canonical(before),
      `${result.accepted}:${result.reasonCode}`,
      canonical(after) === canonical(before) ? 0 : 1,
      after.goalAcceptance?.candidateSha256 === candidateSha256 ? 0 : 1,
    ));
  }

  const historicalEvidence = await historicalV1Receipts();
  {
    const fabricated = structuredClone(historicalEvidence);
    const command = fabricated.find((receipt) => receipt.command.type === "RECORD_VERIFICATION")!.command as Command;
    command.idempotencyKey = `${command.idempotencyKey}-fabricated`;
    let observation = "NO_REJECTION";
    try {
      await replayGoalRoom({ ownerIntent: null }, await rehashLedger(fabricated));
    } catch (error) {
      observation = error instanceof Error ? error.message : String(error);
    }
    attacks.push(blockedResult(
      "fabricated-resealed-v1-ledger",
      "allowlisted-v1-provenance",
      observation === "HISTORICAL_V1_PROVENANCE_REQUIRED",
      observation,
    ));
  }
  {
    const spliced = structuredClone(historicalEvidence);
    spliced.splice(5, 1);
    let observation = "NO_REJECTION";
    try {
      await replayGoalRoom({ ownerIntent: null }, await rehashLedger(spliced));
    } catch (error) {
      observation = error instanceof Error ? error.message : String(error);
    }
    attacks.push(blockedResult(
      "spliced-resealed-v1-ledger",
      "allowlisted-v1-provenance",
      observation === "HISTORICAL_V1_PROVENANCE_REQUIRED",
      observation,
    ));
  }

  const { room: positiveRoom, candidateSha256 } = await exactAcceptedRoom();
  await positiveRoom.dispatch({
    type: "ACCEPT_GOAL",
    actor: "owner",
    expectedStateVersion: positiveRoom.getState().stateVersion,
    idempotencyKey: "positive-owner-accept",
    candidateSha256,
  });
  const positive = positiveRoom.getState();
  const blocked = attacks.filter((attack) => attack.blocked).length;
  return {
    schemaVersion: 1,
    kind: "workhub-release-integrity-v2",
    deterministic: true,
    attacks,
    counts: {
      attempted: attacks.length,
      blocked,
      unexpectedMutations: attacks.reduce((total, attack) => total + attack.unexpectedMutations, 0),
      unauthorizedAcceptances: attacks.reduce((total, attack) => total + attack.unauthorizedAcceptances, 0),
    },
    positiveControl: {
      passed:
        positive.phase === "GOAL_ACCEPTED" &&
        positive.activeVerification?.verdict === "PASS" &&
        positive.goalAcceptance?.candidateSha256 === candidateSha256,
      phase: positive.phase,
      candidateSha256,
      verificationRuleSet: `${positive.activeVerification?.ruleSetId}/v${positive.activeVerification?.ruleSetVersion}`,
      ownerAccepted: positive.goalAcceptance?.candidateSha256 === candidateSha256,
      sealed: positive.phase === "GOAL_ACCEPTED",
      claim: RELEASE_MATCHED_TUPLE_STATEMENT,
    },
  };
}
