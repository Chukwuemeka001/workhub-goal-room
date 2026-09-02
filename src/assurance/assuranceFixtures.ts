import type { AgentChangeSnapshot } from "./agentChangeAssurance";

export interface AssuranceFixture {
  readonly id: string;
  readonly label: string;
  readonly snapshot: AgentChangeSnapshot;
}
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
function snapshot(overrides: Partial<AgentChangeSnapshot>): AgentChangeSnapshot {
  return {
    schemaVersion: "agent-change-assurance/v1",
    provenance: { label: "Illustrative submitted declaration" },
    repository: "example/agent-change",
    expectedCandidateSha: SHA_A,
    reviewedCandidateSha: SHA_A,
    baseSha: SHA_B,
    changedPaths: ["src/copy.ts"],
    additions: 8,
    deletions: 3,
    claims: [{ kind: "files_changed_only", paths: ["src/copy.ts"] }],
    evidence: [{ kind: "unit", subjectSha: SHA_A, status: "PASS", producer: "independent_ci", independent: true }],
    requiredEvidenceKinds: ["unit"],
    ...overrides,
  };
}

export const assuranceFixtures: readonly AssuranceFixture[] = deepFreeze([
  {
    id: "codex-wrong-diff",
    label: "Codex wrong-diff illustrative declaration",
    snapshot: snapshot({
      provenance: { label: "Illustrative reconstruction of the documented Codex wrong-diff failure class", url: "https://github.com/openai/codex/issues/8404" },
      pullRequest: 8404,
      reviewedCandidateSha: SHA_C,
    }),
  },
  {
    id: "codex-stale-merge-base",
    label: "Codex stale-merge-base illustrative declaration",
    snapshot: snapshot({
      provenance: { label: "Illustrative reconstruction of the documented Codex stale-merge-base failure class", url: "https://github.com/openai/codex/issues/30751" },
      pullRequest: 30751,
      reviewedCandidateSha: SHA_C,
      evidence: [{ kind: "unit", subjectSha: SHA_C, status: "PASS", producer: "independent_ci", independent: true }],
    }),
  },
  {
    id: "agent-message-code-inconsistency",
    label: "Agent message/code inconsistency illustrative declaration",
    snapshot: snapshot({
      provenance: { label: "Illustrative claim/path reconstruction informed by the agent PR message/code inconsistency paper", url: "https://arxiv.org/abs/2601.04886v2" },
      changedPaths: ["src/feature.ts"],
      claims: [{ kind: "tests_added" }, { kind: "prose", text: "Tests were added and pass." }],
    }),
  },
  {
    id: "illustrative-workhub-declaration",
    label: "Illustrative WorkHub declaration",
    snapshot: snapshot({
      provenance: { label: "Illustrative WorkHub submitted declaration; no GitHub run or repository bytes were fetched" },
      repository: "workhub-goal-room",
      evidence: [{ kind: "unit", subjectSha: SHA_A, status: "PASS", producer: "local_tool", independent: true }],
      requiredEvidenceKinds: ["unit", "github_ci"],
    }),
  },
  {
    id: "clean-mechanical-change",
    label: "Bounded clean mechanical declaration",
    snapshot: snapshot({ provenance: { label: "Illustrative bounded mechanical submitted declaration" } }),
  },
]);
