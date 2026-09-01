import { describe, expect, it } from "vitest";
import { admitConnectedObservation, connectedEnvelopeDigest } from "./connectedAssurance";

const A = "a".repeat(40), B = "b".repeat(40), T = "c".repeat(40), D = "d".repeat(64);
const makeEnvelope = async () => {
  const envelope: Record<string, unknown> = {
    schema: "agent-change-assurance/connected-v2", mode: "CONNECTED_LOCAL", repositoryIdentityBasis: "LOCAL_GIT_OBSERVED",
    claimBasis: "NOT_OBSERVED", evidenceBasis: "NO_EXECUTABLE_EVIDENCE", authority: "NONE",
    repository: {
      displayName: "<img src=x onerror=alert(1)>", observedBranch: "feature/é", observedHead: A,
      configuredBase: B, resolvedBase: B, candidate: { commit: A, tree: T }, base: { commit: B, tree: B },
      trackedState: "CLEAN", trackedDigest: D, untrackedCount: 1, untrackedInventoryDigest: D,
      manifest: [{ mode: "100755", path: "src/é.ts", blob: B, size: 2, contentDigest: D }], manifestDigest: D, contentManifestDigest: D,
      changedPaths: [{ path: "src/é.ts", status: "M", oldMode: "100644", newMode: "100755", additions: 1, deletions: 0, binary: false }],
      additions: 1, deletions: 0, statusDigest: D, numstatDigest: D, patchDigest: D, diffDigest: D,
    },
    checks: [
      { checkId: "unit", state: "INDETERMINATE", reason: "SANDBOX_UNAVAILABLE", execution: "NOT_RUN" },
      { checkId: "build", state: "INDETERMINATE", reason: "SANDBOX_UNAVAILABLE", execution: "NOT_RUN" },
    ],
    sandbox: { status: "UNAVAILABLE", reason: "SANDBOX_UNAVAILABLE" }, githubCi: "NOT_OBSERVED_BY_THIS_LOCAL_VERIFIER",
    evaluatorSnapshot: {
      schemaVersion: "agent-change-assurance/v1", provenance: { label: "Connected local Git observation" }, repository: "<img src=x onerror=alert(1)>",
      expectedCandidateSha: A, reviewedCandidateSha: A, baseSha: B, changedPaths: ["src/é.ts"], additions: 1, deletions: 0,
      claims: [], evidence: [], requiredEvidenceKinds: ["unit", "build"],
    },
  };
  const repository = envelope.repository as any;
  repository.manifestDigest = await connectedEnvelopeDigest(repository.manifest);
  repository.contentManifestDigest = await connectedEnvelopeDigest(repository.manifest.map(({ path, mode, size, contentDigest }: any) => ({ path, mode, size, contentDigest })));
  repository.diffDigest = await connectedEnvelopeDigest({ base: repository.base, candidate: repository.candidate, changedPaths: repository.changedPaths });
  envelope.envelopeDigest = await connectedEnvelopeDigest(envelope);
  return envelope;
};
const reseal = async (envelope: any) => {
  const repository = envelope.repository;
  repository.manifestDigest = await connectedEnvelopeDigest(repository.manifest);
  repository.contentManifestDigest = await connectedEnvelopeDigest(repository.manifest.map(({ path, mode, size, contentDigest }: any) => ({ path, mode, size, contentDigest })));
  repository.diffDigest = await connectedEnvelopeDigest({ base: repository.base, candidate: repository.candidate, changedPaths: repository.changedPaths });
  envelope.envelopeDigest = await connectedEnvelopeDigest(envelope);
  return envelope;
};

describe("connected assurance browser admission", () => {
  it("admits Git's real copy-plus-rename classification for one consumed base source", async () => {
    const value: any = await makeEnvelope();
    value.repository.manifest = [
      { mode: "100644", path: "r1.ts", blob: B, size: 2, contentDigest: D },
      { mode: "100644", path: "r2.ts", blob: T, size: 2, contentDigest: D },
    ];
    value.repository.changedPaths = [
      { path: "r1.ts", oldPath: "old.ts", status: "C", oldMode: "100644", newMode: "100644", additions: 0, deletions: 0, binary: false },
      { path: "r2.ts", oldPath: "old.ts", status: "R", oldMode: "100644", newMode: "100644", additions: 0, deletions: 0, binary: false },
    ];
    value.repository.additions = 0; value.repository.deletions = 0;
    value.evaluatorSnapshot.changedPaths = ["r1.ts", "r2.ts"];
    value.evaluatorSnapshot.additions = 0; value.evaluatorSnapshot.deletions = 0;
    expect((await admitConnectedObservation(await reseal(value))).valid).toBe(true);
  });

  it("rejects impossible base-source consumption and copy chains", async () => {
    const classify = async (manifestPaths: string[], changedPaths: any[]) => {
      const value: any = await makeEnvelope();
      value.repository.manifest = manifestPaths.map((path, index) => ({ mode: "100644", path, blob: index % 2 ? T : B, size: 2, contentDigest: D }));
      value.repository.changedPaths = changedPaths;
      value.repository.additions = 0; value.repository.deletions = 0;
      value.evaluatorSnapshot.changedPaths = changedPaths.map(({ path }) => path);
      value.evaluatorSnapshot.additions = 0; value.evaluatorSnapshot.deletions = 0;
      return admitConnectedObservation(await reseal(value));
    };
    const row = (status: string, path: string, oldPath?: string) => ({ path, ...(oldPath ? { oldPath } : {}), status, oldMode: status === "A" ? "000000" : "100644", newMode: status === "D" ? "000000" : "100644", additions: 0, deletions: 0, binary: false });
    const cases = [
      classify(["r1.ts", "r2.ts"], [row("R", "r1.ts", "old.ts"), row("R", "r2.ts", "old.ts")]),
      classify(["r1.ts"], [row("R", "r1.ts", "old.ts"), row("D", "old.ts")]),
      classify(["new.ts", "copy.ts"], [row("A", "new.ts"), row("C", "copy.ts", "new.ts")]),
      classify(["r1.ts", "r2.ts"], [row("R", "r1.ts", "old.ts"), row("C", "r2.ts", "r1.ts")]),
      classify(["old.ts", "c1.ts", "c2.ts"], [row("C", "c1.ts", "old.ts"), row("C", "c2.ts", "c1.ts")]),
    ];
    for (const result of await Promise.all(cases)) expect(result).toEqual({ valid: false, code: "INVALID_CONNECTED_OBSERVATION", authority: "NONE" });
  });

  it("admits Git-valid at-sign branch while reserving HEAD and DETACHED semantics", async () => {
    const value: any = await makeEnvelope();
    value.repository.observedBranch = "@";
    expect((await admitConnectedObservation(await reseal(value))).valid).toBe(true);
  });

  it("rejects producer-impossible manifest and diff row ordering", async () => {
    const unsortedManifest: any = await makeEnvelope();
    unsortedManifest.repository.manifest = [
      { mode: "100644", path: "z.ts", blob: T, size: 2, contentDigest: D },
      ...unsortedManifest.repository.manifest,
    ];
    expect((await admitConnectedObservation(await reseal(unsortedManifest))).valid).toBe(false);

    const unsortedDiff: any = await makeEnvelope();
    unsortedDiff.repository.manifest = [
      { mode: "100644", path: "r1.ts", blob: B, size: 2, contentDigest: D },
      { mode: "100644", path: "r2.ts", blob: T, size: 2, contentDigest: D },
    ];
    unsortedDiff.repository.changedPaths = [
      { path: "r2.ts", oldPath: "old.ts", status: "R", oldMode: "100644", newMode: "100644", additions: 0, deletions: 0, binary: false },
      { path: "r1.ts", oldPath: "old.ts", status: "C", oldMode: "100644", newMode: "100644", additions: 0, deletions: 0, binary: false },
    ];
    unsortedDiff.repository.additions = 0; unsortedDiff.repository.deletions = 0;
    unsortedDiff.evaluatorSnapshot.changedPaths = ["r2.ts", "r1.ts"];
    unsortedDiff.evaluatorSnapshot.additions = 0; unsortedDiff.evaluatorSnapshot.deletions = 0;
    expect((await admitConnectedObservation(await reseal(unsortedDiff))).valid).toBe(false);
  });

  it("admits exact local Git observation with all executable checks indeterminate", async () => {
    const result = await admitConnectedObservation(await makeEnvelope());
    expect(result).toMatchObject({ valid: true, envelope: { mode: "CONNECTED_LOCAL", authority: "NONE", evidenceBasis: "NO_EXECUTABLE_EVIDENCE" }, evaluation: { valid: true, authority: "NONE", identityBasis: "LOCAL_GIT_OBSERVED", decision: "REQUEST_EVIDENCE" } });
    if (result.valid) {
      expect(result.envelope.checks.every((check) => check.execution === "NOT_RUN")).toBe(true);
      expect(Object.isFrozen(result.envelope.repository)).toBe(true);
    }
  });

  it("fails closed for any fabricated PASS, local_tool evidence, claim, or identity contradiction", async () => {
    for (const mutate of [
      (x: any) => { x.checks[0].state = "PASS"; },
      (x: any) => { x.checks[0].execution = "RUN"; },
      (x: any) => { x.evaluatorSnapshot.evidence = [{ kind: "unit", subjectSha: A, status: "PASS", producer: "local_tool", independent: false }]; },
      (x: any) => { x.evaluatorSnapshot.claims = [{ kind: "tests_added" }]; },
      (x: any) => { x.repository.candidate.commit = B; },
      (x: any) => { x.repository.resolvedBase = A; },
      (x: any) => { x.evaluatorSnapshot.reviewedCandidateSha = B; },
      (x: any) => { x.repository.manifest[0].contentDigest = "e".repeat(64); },
      (x: any) => { x.checks.reverse(); },
      (x: any) => { x.authority = "MERGE"; },
      (x: any) => { x.repository.displayName = "/Users/private/repo"; },
    ]) {
      const value: any = await makeEnvelope(); mutate(value); value.envelopeDigest = await connectedEnvelopeDigest(value);
      expect(await admitConnectedObservation(value)).toEqual({ valid: false, code: "INVALID_CONNECTED_OBSERVATION", authority: "NONE" });
    }
  });

  it("rejects internally re-digested but semantically contradictory observations", async () => {
    const cases: Array<(value: any) => void> = [
      (value) => {
        value.repository.additions = 999;
        value.evaluatorSnapshot.additions = 999;
      },
      (value) => { value.repository.observedBranch = "feature/x\nspoofed"; },
      (value) => { value.repository.manifest[0].size = 16 * 1024 * 1024 + 1; },
      (value) => {
        value.repository.changedPaths[0].status = "D";
        value.repository.changedPaths[0].oldMode = "100644";
        value.repository.changedPaths[0].newMode = "100755";
      },
      (value) => {
        value.repository.base = { ...value.repository.candidate };
        value.repository.configuredBase = A;
        value.repository.resolvedBase = A;
        value.evaluatorSnapshot.baseSha = A;
      },
      (value) => { value.repository.base.tree = "b".repeat(64); },
      (value) => {
        value.repository.changedPaths[0].path = "src/absent.ts";
        value.evaluatorSnapshot.changedPaths = ["src/absent.ts"];
      },
      (value) => {
        value.repository.displayName = "/private/tmp/secret-repo";
        value.evaluatorSnapshot.repository = "/private/tmp/secret-repo";
      },
      (value) => { value.evaluatorSnapshot.provenance.label = "GitHub verified this exact candidate"; },
      (value) => { value.repository.changedPaths[0].status = "T"; },
      (value) => {
        value.repository.changedPaths[0] = { ...value.repository.changedPaths[0], status: "C", oldPath: "src/original.ts" };
      },
      (value) => { value.repository.observedBranch = "/private/tmp/secret"; },
      (value) => { value.repository.observedBranch = "/var/tmp/secret"; },
      (value) => { value.repository.observedBranch = "feature/.hidden"; },
      (value) => { value.repository.observedBranch = "feature/x..y"; },
      (value) => { value.repository.observedBranch = "feature/x@{y"; },
      (value) => { value.repository.observedBranch = "feature/x.lock"; },
      (value) => { value.repository.changedPaths[0].binary = true; },
      (value) => {
        value.repository.changedPaths[0].status = "A";
        value.repository.changedPaths[0].oldMode = "000000";
        value.repository.changedPaths[0].deletions = 1;
        value.repository.deletions = 1;
        value.evaluatorSnapshot.deletions = 1;
      },
      (value) => {
        value.repository.manifest[0].path = "src/other.ts";
        value.repository.changedPaths[0] = { path: "src/removed.ts", status: "D", oldMode: "100644", newMode: "000000", additions: 1, deletions: 0, binary: false };
        value.evaluatorSnapshot.changedPaths = ["src/removed.ts"];
      },
      (value) => { value.repository.observedBranch = "HEAD"; },
    ];
    for (const mutate of cases) {
      const value: any = await makeEnvelope();
      mutate(value);
      value.repository.manifestDigest = await connectedEnvelopeDigest(value.repository.manifest);
      value.repository.contentManifestDigest = await connectedEnvelopeDigest(value.repository.manifest.map(({ path, mode, size, contentDigest }: any) => ({ path, mode, size, contentDigest })));
      value.repository.diffDigest = await connectedEnvelopeDigest({ base: value.repository.base, candidate: value.repository.candidate, changedPaths: value.repository.changedPaths });
      value.envelopeDigest = await connectedEnvelopeDigest(value);
      expect(await admitConnectedObservation(value)).toEqual({ valid: false, code: "INVALID_CONNECTED_OBSERVATION", authority: "NONE" });
    }
  });

  it("rejects digest tamper, unknown keys, and static HTML fallback", async () => {
    const digest: any = await makeEnvelope(); digest.envelopeDigest = "0".repeat(64);
    expect((await admitConnectedObservation(digest)).valid).toBe(false);
    const unknown: any = await makeEnvelope(); unknown.receipts = []; unknown.envelopeDigest = await connectedEnvelopeDigest(unknown);
    expect((await admitConnectedObservation(unknown)).valid).toBe(false);
    expect((await admitConnectedObservation("<!doctype html>")).valid).toBe(false);
  });
});
