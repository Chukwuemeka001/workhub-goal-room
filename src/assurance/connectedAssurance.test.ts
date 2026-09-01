import { describe, expect, it } from "vitest";
import { admitConnectedObservation, admitConnectedV3Observation, connectedEnvelopeDigest } from "./connectedAssurance";

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

  it("refuses ordinary observation accessors without invoking them and bounds Proxy traps", async () => {
    let getters = 0, traps = 0;
    const accessor = Object.defineProperty({}, "schema", { enumerable: true, get: () => { getters++; return "agent-change-assurance/connected-v2"; } });
    await expect(admitConnectedObservation(accessor)).resolves.toEqual({ valid: false, code: "INVALID_CONNECTED_OBSERVATION", authority: "NONE" });
    const proxy = new Proxy({}, { ownKeys: () => { traps++; throw new Error("trap"); } });
    await expect(admitConnectedObservation(proxy)).resolves.toEqual({ valid: false, code: "INVALID_CONNECTED_OBSERVATION", authority: "NONE" });
    expect(getters).toBe(0); expect(traps).toBeGreaterThan(0);
  });

  it("synchronously detaches the complete observation before any digest await", async () => {
    const value: any = await makeEnvelope();
    const expected = structuredClone(value);
    const pending = admitConnectedObservation(value);
    value.repository.changedPaths[0].path = "src/mutated.ts";
    value.repository.changedPaths[0].oldPath = "src/auth/old.ts";
    value.repository.manifest[0].mode = "100755";
    value.repository.manifest[0].contentDigest = "e".repeat(64);
    value.evaluatorSnapshot.repository = "mutated";
    value.repository.base.commit = "9".repeat(40);
    value.repository.candidate.tree = "8".repeat(40);
    value.repository.diffDigest = "7".repeat(64);
    value.envelopeDigest = "6".repeat(64);
    const result = await pending;
    expect(result).toMatchObject({ valid: true, envelope: expected });
  });

  it("escalates sensitive rename sources without claims but ignores copy sources", async () => {
    const classify = async (status: "R" | "C") => {
      const value: any = await makeEnvelope();
      value.repository.changedPaths[0] = { ...value.repository.changedPaths[0], status, oldPath: "src/auth/secret.ts" };
      if (status === "C") value.repository.manifest.unshift({ ...value.repository.manifest[0], path: "src/auth/secret.ts" });
      value.repository.manifestDigest = await connectedEnvelopeDigest(value.repository.manifest);
      value.repository.contentManifestDigest = await connectedEnvelopeDigest(value.repository.manifest.map(({ path, mode, size, contentDigest }: any) => ({ path, mode, size, contentDigest })));
      value.repository.diffDigest = await connectedEnvelopeDigest({ base: value.repository.base, candidate: value.repository.candidate, changedPaths: value.repository.changedPaths });
      value.envelopeDigest = await connectedEnvelopeDigest(value);
      return admitConnectedObservation(value);
    };
    const renamed = await classify("R");
    expect(renamed).toMatchObject({ valid: true, evaluation: { decision: "ESCALATE", riskTier: "HIGH", findings: expect.arrayContaining([{ code: "HIGH_RISK_PATH", subject: "src/auth/secret.ts", detail: expect.any(String) }]) } });
    const copied = await classify("C");
    expect(copied).toMatchObject({ valid: true, evaluation: { decision: "REQUEST_EVIDENCE", riskTier: "LOW" } });
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

const makeV3Envelope = async () => {
  const snapshot = "9".repeat(64), spec = "8".repeat(64), image = `sha256:${"7".repeat(64)}`;
  const diffRows = [{ path: "src/a.ts", status: "M", oldMode: "100644", newMode: "100644", oldBlob: A, newBlob: B, additions: 1, deletions: 0, binary: false }];
  const diffDigest = await connectedEnvelopeDigest({ schema: "aca-base-snapshot-diff/v2", baseCommit: B, baseTree: B, snapshotDigest: snapshot, rows: diffRows, additions: 1, deletions: 0 });
  const output = { sha256: "6".repeat(64), observedBytes: 2, preview: "ok", truncated: false, limitExceeded: false };
  const common: any = {
    schema: "aca-check-receipt/v1", attemptId: "attempt", snapshotDigest: snapshot,
    parentCommit: A, parentTree: T, baseCommit: B, baseTree: B,
    manifestDigest: "5".repeat(64), contentManifestDigest: "4".repeat(64), diffDigest,
    lockfile: { blobId: B, bytes: 10, digest: "2".repeat(64) }, imageId: image,
    imageLabels: { contract: "aca-sandbox/v1", spec }, verifierSpecDigest: spec, policyVersion: "aca-isolation-v1",
    startedAt: "2026-09-01T00:00:00.000Z", finishedAt: "2026-09-01T00:00:01.000Z",
    state: "PASS", reason: "CHECK_PASSED", execution: "RUN", cleanup: "CONFIRMED",
  };
  const command = (commandId: string) => ({ commandId, exitCode: 0, signal: null, timeout: false, outputLimit: false, stdout: output, stderr: output });
  const receipts: any[] = [
    { ...common, checkId: "unit", commands: [command("unit-vitest")] },
    { ...common, checkId: "build", commands: [command("build-typescript"), command("build-vite")] },
  ];
  for (const receipt of receipts) receipt.receiptDigest = await connectedEnvelopeDigest(receipt);
  const repository = { displayName: "repo", snapshotDigest: snapshot, parentCommit: A, parentTree: T, baseCommit: B, baseTree: B, manifestDigest: "5".repeat(64), contentManifestDigest: "4".repeat(64), diffDigest, diffRows, changedPaths: ["src/a.ts"], additions: 1, deletions: 0 };
  const evidence = receipts.map((r) => ({ kind: r.checkId, subjectSha: snapshot, status: r.state, producer: "local_tool", independent: false }));
  const value: any = {
    schema: "agent-change-assurance/connected-v3", mode: "CONNECTED_LOCAL", repositoryIdentityBasis: "CUMULATIVE_DIRTY_SNAPSHOT", claimBasis: "NOT_OBSERVED", evidenceBasis: "QUALIFIED_LOCAL_SANDBOX", authority: "NONE",
    repository, qualification: { status: "QUALIFIED", policyVersion: "aca-isolation-v1", imageId: image, verifierSpecDigest: spec }, receipts,
    checks: receipts.map((r) => ({ checkId: r.checkId, state: r.state, reason: r.reason, execution: r.execution, receiptDigest: r.receiptDigest })),
    aggregate: { passed: 2, failed: 0, indeterminate: 0, complete: true, sentence: "2 of 2 required checks passed; 0 failed; 0 indeterminate; executable evidence is complete; no missing/indeterminate requirements." },
    evaluatorSnapshot: { schemaVersion: "agent-change-assurance/v1", provenance: { label: "Qualified local Docker sandbox" }, repository: "repo", expectedCandidateSha: snapshot, reviewedCandidateSha: snapshot, baseSha: B, changedPaths: ["src/a.ts"], additions: 1, deletions: 0, claims: [], evidence, requiredEvidenceKinds: ["unit", "build"] },
    githubCi: "NOT_OBSERVED_BY_THIS_LOCAL_VERIFIER",
  };
  value.envelopeDigest = await connectedEnvelopeDigest(value); return JSON.parse(JSON.stringify(value));
};
const resealV3 = async (value: any) => { for (const receipt of value.receipts) receipt.receiptDigest = await connectedEnvelopeDigest(receipt); value.checks = value.receipts.map((r: any) => ({ checkId: r.checkId, state: r.state, reason: r.reason, execution: r.execution, receiptDigest: r.receiptDigest })); value.envelopeDigest = await connectedEnvelopeDigest(value); return value; };

describe("connected-v3 executable evidence admission", () => {
  it("admits exact local_tool non-independent receipts and hard-caps routing at REQUEST_EVIDENCE", async () => {
    const result = await admitConnectedV3Observation(await makeV3Envelope());
    expect(result).toMatchObject({ valid: true, evaluation: { valid: true, decision: "REQUEST_EVIDENCE", authority: "NONE" }, envelope: { authority: "NONE", aggregate: { complete: true } } });
  });
  it("admits the full 3x3 unit/build lifecycle matrix and excludes indeterminate rows from evidence", async () => {
    for (const unitState of ["PASS", "FAIL", "INDETERMINATE"] as const) for (const buildState of ["PASS", "FAIL", "INDETERMINATE"] as const) {
      const value: any = await makeV3Envelope();
      for (const [index, state] of [unitState, buildState].entries()) {
        const receipt = value.receipts[index]; receipt.state = state;
        receipt.reason = state === "PASS" ? "CHECK_PASSED" : state === "FAIL" ? "CHECK_FAILED" : "TIMEOUT";
        receipt.commands[0].exitCode = state === "PASS" ? 0 : state === "FAIL" ? 1 : null;
        receipt.commands[0].timeout = state === "INDETERMINATE";
      }
      const states = [unitState, buildState]; const passed = states.filter((state) => state === "PASS").length; const failed = states.filter((state) => state === "FAIL").length;
      const indeterminate=2-passed-failed,completed=passed+failed,completeness=completed===2?"complete":completed===1?"partial":"absent";
      value.aggregate = { passed, failed, indeterminate, complete: completed === 2, sentence: `${passed} of 2 required checks passed; ${failed} failed; ${indeterminate} indeterminate; executable evidence is ${completeness}; ${indeterminate ? "missing/indeterminate requirements remain" : "no missing/indeterminate requirements"}.` };
      value.evaluatorSnapshot.evidence = value.receipts.filter((receipt: any) => receipt.state !== "INDETERMINATE").map((receipt: any) => ({ kind: receipt.checkId, subjectSha: value.repository.snapshotDigest, status: receipt.state, producer: "local_tool", independent: false }));
      await resealV3(value);
      const result = await admitConnectedV3Observation(value);
      expect(result).toMatchObject({ valid: true, envelope: { aggregate: { passed, failed, indeterminate: 2 - passed - failed } } });
    }
  });

  it("admits the producer's complete closed infrastructure taxonomy and rejects fully re-digested cross-products", async () => {
    const cases: Array<[string,"RUN"|"NOT_RUN","CONFIRMED"|"UNRESOLVED",string|null]> = [
      ["TIMEOUT","RUN","CONFIRMED","timeout"],["CANCELLED","RUN","CONFIRMED",null],["CANCELLED","NOT_RUN","CONFIRMED",null],
      ["OUTPUT_LIMIT","RUN","CONFIRMED","outputLimit"],["RUNNER_INFRASTRUCTURE","RUN","CONFIRMED",null],
      ["DOCKER_FAILURE","RUN","CONFIRMED",null],["DOCKER_FAILURE","NOT_RUN","CONFIRMED",null],["SOURCE_MOVED","RUN","CONFIRMED",null],["SOURCE_MOVED","NOT_RUN","CONFIRMED",null],
      ["CLEANUP_UNRESOLVED","RUN","UNRESOLVED",null],["CLEANUP_UNRESOLVED","NOT_RUN","UNRESOLVED",null],["IMAGE_POLICY_MISMATCH","RUN","CONFIRMED",null],["IMAGE_POLICY_MISMATCH","NOT_RUN","CONFIRMED",null],
    ];
    for(const[reason,execution,cleanup,flag]of cases){const value:any=await makeV3Envelope();const receipt=value.receipts[0];receipt.state="INDETERMINATE";receipt.reason=reason;receipt.execution=execution;receipt.cleanup=cleanup;for(const command of receipt.commands){command.exitCode=null;command.timeout=flag==="timeout";command.outputLimit=flag==="outputLimit";}value.aggregate={passed:1,failed:0,indeterminate:1,complete:false,sentence:"1 of 2 required checks passed; 0 failed; 1 indeterminate; executable evidence is partial; missing/indeterminate requirements remain."};value.evaluatorSnapshot.evidence=value.evaluatorSnapshot.evidence.filter((row:any)=>row.kind!=="unit");await resealV3(value);expect((await admitConnectedV3Observation(value)).valid,`${reason}/${execution}`).toBe(true);}
    for(const bad of [{reason:"TIMEOUT",execution:"NOT_RUN",cleanup:"CONFIRMED"},{reason:"OUTPUT_LIMIT",execution:"NOT_RUN",cleanup:"CONFIRMED"},{reason:"CLEANUP_UNRESOLVED",execution:"RUN",cleanup:"CONFIRMED"}]){const value:any=await makeV3Envelope();const receipt=value.receipts[0];receipt.state="INDETERMINATE";Object.assign(receipt,bad);for(const command of receipt.commands){command.exitCode=null;command.timeout=bad.reason==="TIMEOUT";command.outputLimit=bad.reason==="OUTPUT_LIMIT";}value.aggregate={passed:1,failed:0,indeterminate:1,complete:false,sentence:"1 of 2 required checks passed; 0 failed; 1 indeterminate; executable evidence is partial; missing/indeterminate requirements remain."};value.evaluatorSnapshot.evidence=value.evaluatorSnapshot.evidence.filter((row:any)=>row.kind!=="unit");await resealV3(value);expect((await admitConnectedV3Observation(value)).valid).toBe(false);}
  });

  it("rejects fully re-digested projection, independence, claim, order and exit contradictions", async () => {
    const mutations = [
      (x: any) => { x.evaluatorSnapshot.evidence[0].independent = true; },
      (x: any) => { x.evaluatorSnapshot.claims = [{ kind: "tests_added" }]; },
      (x: any) => { x.receipts.reverse(); },
      (x: any) => { x.receipts[0].commands[0].exitCode = 1; },
      (x: any) => { x.aggregate.passed = 1; x.aggregate.complete = false; },
      (x: any) => { x.evaluatorSnapshot.evidence[0].status = "FAIL"; },
    ];
    for (const mutate of mutations) { const value: any = await makeV3Envelope(); mutate(value); await resealV3(value); expect((await admitConnectedV3Observation(value)).valid).toBe(false); }
  });
});
