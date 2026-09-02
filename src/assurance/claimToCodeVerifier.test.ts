import { describe, expect, it } from "vitest";
import { admitConnectedObservation, connectedEnvelopeDigest, type ConnectedAdmission } from "./connectedAssurance";
import { CLAIM_PACKET_LIMITS, verifyClaimsAgainstObservation } from "./claimToCodeVerifier";

const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40), E = "e".repeat(64), F = "f".repeat(64);
type Change = { path: string; status: "A" | "M" | "C" | "R" | "D"; oldPath?: string; oldMode?: "000000" | "100644" | "100755"; newMode?: "000000" | "100644" | "100755" };

async function admitted(changes: readonly Change[], candidate = A, base = B): Promise<Extract<ConnectedAdmission, { valid: true }>> {
  const changedPaths = [...changes].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0).map((change) => ({
    path: change.path,
    ...(change.oldPath === undefined ? {} : { oldPath: change.oldPath }),
    status: change.status,
    oldMode: change.oldMode ?? (change.status === "A" ? "000000" : "100644"),
    newMode: change.newMode ?? (change.status === "D" ? "000000" : "100644"),
    additions: change.status === "D" ? 0 : 1,
    deletions: change.status === "A" ? 0 : 1,
    binary: false,
  }));
  const manifestPaths = changedPaths.filter((row) => row.status !== "D").map((row) => ({ mode: row.newMode, path: row.path, blob: B, size: 2, contentDigest: E }));
  for (const row of changedPaths.filter((entry) => entry.status === "C")) if (!manifestPaths.some((entry) => entry.path === row.oldPath)) manifestPaths.push({ mode: row.oldMode, path: row.oldPath!, blob: B, size: 2, contentDigest: E });
  manifestPaths.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const repository: Record<string, any> = {
    displayName: "fixture-repository", observedBranch: "feature/claims", observedHead: candidate, configuredBase: base, resolvedBase: base,
    candidate: { commit: candidate, tree: C }, base: { commit: base, tree: "d".repeat(40) }, trackedState: "CLEAN", trackedDigest: F, untrackedCount: 0, untrackedInventoryDigest: F,
    manifest: manifestPaths, manifestDigest: F, contentManifestDigest: F, changedPaths,
    additions: changedPaths.reduce((sum, row) => sum + row.additions, 0), deletions: changedPaths.reduce((sum, row) => sum + row.deletions, 0),
    statusDigest: F, numstatDigest: F, patchDigest: F, diffDigest: F,
  };
  repository.manifestDigest = await connectedEnvelopeDigest(repository.manifest);
  repository.contentManifestDigest = await connectedEnvelopeDigest(repository.manifest.map(({ path, mode, size, contentDigest }: Record<string, unknown>) => ({ path, mode, size, contentDigest })));
  repository.diffDigest = await connectedEnvelopeDigest({ base: repository.base, candidate: repository.candidate, changedPaths: repository.changedPaths });
  const envelope: Record<string, any> = {
    schema: "agent-change-assurance/connected-v2", mode: "CONNECTED_LOCAL", repositoryIdentityBasis: "LOCAL_GIT_OBSERVED", claimBasis: "NOT_OBSERVED", evidenceBasis: "NO_EXECUTABLE_EVIDENCE", authority: "NONE", repository,
    checks: [{ checkId: "unit", state: "INDETERMINATE", reason: "SANDBOX_UNAVAILABLE", execution: "NOT_RUN" }, { checkId: "build", state: "INDETERMINATE", reason: "SANDBOX_UNAVAILABLE", execution: "NOT_RUN" }],
    sandbox: { status: "UNAVAILABLE", reason: "SANDBOX_UNAVAILABLE" }, githubCi: "NOT_OBSERVED_BY_THIS_LOCAL_VERIFIER",
    evaluatorSnapshot: { schemaVersion: "agent-change-assurance/v1", provenance: { label: "Connected local Git observation" }, repository: repository.displayName, expectedCandidateSha: candidate, reviewedCandidateSha: candidate, baseSha: base, changedPaths: changedPaths.map((row) => row.path), additions: repository.additions, deletions: repository.deletions, claims: [], evidence: [], requiredEvidenceKinds: ["unit", "build"] },
  };
  envelope.envelopeDigest = await connectedEnvelopeDigest(envelope);
  const admission = await admitConnectedObservation(envelope);
  if (!admission.valid) throw new Error("fixture must cross connected admission");
  return admission;
}

const packet = (claims: readonly unknown[], candidateSha = A) => ({ schema: "claim-to-code/v1", candidateSha, originalRequest: "Add a focused verifier.", completionSummary: "Added tests and implementation.", claims });

describe("claim-to-code verifier v1", () => {
  it("re-admits connected custody and binds a supported test-path result to every exact object", async () => {
    const observation = await admitted([{ path: "src/value.test.ts", status: "A" }]);
    const result = await verifyClaimsAgainstObservation(packet([{ id: "tests", kind: "tests_added" }]), observation);
    expect(result).toMatchObject({
      valid: true, schema: "claim-verification/v1", authority: "NONE", candidateBinding: "EXACT_LOCAL_GIT_OBSERVED",
      binding: { admittedEnvelopeDigest: observation.envelope.envelopeDigest, candidateCommit: A, candidateTree: C, baseCommit: B, baseTree: "d".repeat(40), diffDigest: observation.envelope.repository.diffDigest },
      rows: [{ id: "tests", verdict: "SUPPORTED", reasonCode: "TEST_PATH_CHANGE_OBSERVED" }],
      machineClaimCondition: "SATISFIED", connectedDecision: "REQUEST_EVIDENCE", effectiveRecommendation: "REQUEST_EVIDENCE", evidenceBasis: "NO_EXECUTABLE_EVIDENCE",
    });
    if (result.valid) {
      expect(result.canonicalDecodedClaimPacketDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(result.resultDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(result.rows[0].detail).toBe("This establishes only that a candidate-present changed path matches the v1 test-path convention. Tests were not run; coverage, assertions, relevance, and passing status are not proven.");
    }
  });

  it("refuses a raw or fabricated connected envelope instead of trusting a type cast", async () => {
    const observation = await admitted([{ path: "src/value.test.ts", status: "A" }]);
    await expect(verifyClaimsAgainstObservation(packet([{ id: "tests", kind: "tests_added" }]), observation.envelope as never)).resolves.toEqual({ valid: false, code: "CONNECTED_OBSERVATION_REFUSED", authority: "NONE" });
    const fabricated = { valid: true, envelope: { repository: { candidate: { commit: A }, changedPaths: [{ path: "invented.test.ts", status: "A" }] } }, evaluation: { decision: "REQUEST_EVIDENCE" } };
    await expect(verifyClaimsAgainstObservation(packet([{ id: "tests", kind: "tests_added" }]), fabricated as never)).resolves.toEqual({ valid: false, code: "CONNECTED_OBSERVATION_REFUSED", authority: "NONE" });
  });

  it("uses the complete changedPaths.path set and only new rename/copy paths", async () => {
    const observation = await admitted([{ path: "deleted.ts", status: "D" }, { path: "new.test.ts", oldPath: "old.test.ts", status: "R" }]);
    const supported = await verifyClaimsAgainstObservation(packet([{ id: "files", kind: "files_changed_only", paths: ["new.test.ts", "deleted.ts"] }]), observation);
    expect(supported).toMatchObject({ valid: true, rows: [{ verdict: "SUPPORTED", reasonCode: "EXACT_PATH_SET_MATCH" }] });
    const contradicted = await verifyClaimsAgainstObservation(packet([{ id: "files", kind: "files_changed_only", paths: ["new.test.ts"] }]), observation);
    expect(contradicted).toMatchObject({ valid: true, rows: [{ verdict: "CONTRADICTED", reasonCode: "PATH_SET_MISMATCH" }], effectiveRecommendation: "ESCALATE" });
  });

  it("detaches decoded packet values before asynchronous re-admission and deeply freezes the result", async () => {
    const observation = await admitted([{ path: "src/value.ts", status: "M" }]);
    const mutable = packet([{ id: "files", kind: "files_changed_only", paths: ["src/value.ts"] }]) as any;
    const pending = verifyClaimsAgainstObservation(mutable, observation);
    mutable.originalRequest = "mutated";
    mutable.claims[0].paths[0] = "other.ts";
    const result = await pending;
    expect(result).toMatchObject({ valid: true, context: { originalRequest: "Add a focused verifier." }, rows: [{ verdict: "SUPPORTED" }] });
    if (result.valid) {
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.binding)).toBe(true);
      expect(Object.isFrozen(result.context)).toBe(true);
      expect(Object.isFrozen(result.rows)).toBe(true);
      expect(result.rows.every(Object.isFrozen)).toBe(true);
      expect(Object.isFrozen(result.counts)).toBe(true);
    }
  });

  it("fails closed on exact shapes, accessors, exotic arrays, duplicates, forbidden capability keys, malformed identities, and UTF-8 numeric limits", async () => {
    const observation = await admitted([{ path: "src/value.ts", status: "M" }]);
    let getterCalls = 0;
    const accessor = Object.defineProperty({}, "schema", { enumerable: true, get: () => { getterCalls++; return "claim-to-code/v1"; } });
    const arrayWithExtra: any = [{ id: "tests", kind: "tests_added" }]; arrayWithExtra.foo = true;
    const sparse = Array(1);
    const inherited: unknown[] = []; Object.setPrototypeOf(inherited, { 0: { id: "tests", kind: "tests_added" }, length: 1 });
    const valid = packet([{ id: "tests", kind: "tests_added" }]);
    const cases: unknown[] = [null, 1, [], Object.assign(Object.create(null), valid), accessor,
      { ...valid, repository: "other" }, { ...valid, authority: "OWNER" }, { ...valid, claims: arrayWithExtra }, { ...valid, claims: sparse }, { ...valid, claims: inherited },
      packet([]), packet([{ id: "same", kind: "prose", text: "one" }, { id: "same", kind: "prose", text: "two" }]),
      packet([{ id: "one", kind: "tests_added" }, { id: "two", kind: "tests_added" }]), packet([{ id: "one", kind: "files_changed_only", paths: ["a"] }, { id: "two", kind: "files_changed_only", paths: ["b"] }]),
      packet([{ id: "bad id", kind: "tests_added" }]), packet([{ id: "x".repeat(CLAIM_PACKET_LIMITS.idUtf8Bytes + 1), kind: "prose", text: "x" }]),
      packet([{ id: "files", kind: "files_changed_only", paths: ["../secret"] }]), packet([{ id: "files", kind: "files_changed_only", paths: ["src/a", "src/a"] }]), packet([{ id: "files", kind: "files_changed_only", paths: [`src/${"x".repeat(CLAIM_PACKET_LIMITS.pathUtf8Bytes)}`] }]),
      packet([{ id: "tests", kind: "tests_added", command: "npm test" }]),
      packet([{ id: "words", kind: "prose", text: "é".repeat(CLAIM_PACKET_LIMITS.proseUtf8Bytes / 2 + 1) }]),
      { ...valid, originalRequest: "é".repeat(CLAIM_PACKET_LIMITS.requestUtf8Bytes / 2 + 1) }, { ...valid, completionSummary: "x".repeat(CLAIM_PACKET_LIMITS.summaryUtf8Bytes + 1) },
      { ...valid, candidateSha: "A".repeat(40) }, { ...valid, candidateSha: ` ${A}` }, { ...valid, candidateSha: A.slice(0, 12) },
      packet(Array.from({ length: CLAIM_PACKET_LIMITS.claimCount + 1 }, (_, index) => ({ id: `p${index}`, kind: "prose", text: "x" }))),
      packet([{ id: "files", kind: "files_changed_only", paths: Array.from({ length: CLAIM_PACKET_LIMITS.pathsPerClaim + 1 }, (_, index) => `src/${index}`) }]),
      packet([{ id: "files", kind: "files_changed_only", paths: Array.from({ length: CLAIM_PACKET_LIMITS.pathsPerClaim }, (_, index) => `src/${String(index).padStart(3, "0")}/${"x".repeat(121)}`) }]),
    ];
    for (const value of cases) await expect(verifyClaimsAgainstObservation(value, observation)).resolves.toEqual({ valid: false, code: "PACKET_SCHEMA_REFUSED", authority: "NONE" });
    expect(getterCalls).toBe(0);
    await expect(verifyClaimsAgainstObservation(packet([{ id: "words", kind: "prose", text: "é".repeat(CLAIM_PACKET_LIMITS.proseUtf8Bytes / 2) }]), observation)).resolves.toMatchObject({ valid: true });
  });

  it("refuses nested accessors, symbol extras, and trapping proxies without executing or throwing", async () => {
    const observation = await admitted([{ path: "src/value.ts", status: "M" }]);
    let getterCalls = 0;
    const accessorClaims: unknown[] = [];
    Object.defineProperty(accessorClaims, "0", { enumerable: true, configurable: true, get: () => { getterCalls++; return { id: "tests", kind: "tests_added" }; } });
    accessorClaims.length = 1;
    await expect(verifyClaimsAgainstObservation({ ...packet([{ id: "tests", kind: "tests_added" }]), claims: accessorClaims }, observation)).resolves.toEqual({ valid: false, code: "PACKET_SCHEMA_REFUSED", authority: "NONE" });
    expect(getterCalls).toBe(0);

    const symbolRoot = packet([{ id: "tests", kind: "tests_added" }]) as Record<PropertyKey, unknown>;
    symbolRoot[Symbol("authority")] = "OWNER";
    await expect(verifyClaimsAgainstObservation(symbolRoot, observation)).resolves.toEqual({ valid: false, code: "PACKET_SCHEMA_REFUSED", authority: "NONE" });

    const symbolClaim = { id: "tests", kind: "tests_added" } as Record<PropertyKey, unknown>;
    symbolClaim[Symbol("command")] = "npm test";
    await expect(verifyClaimsAgainstObservation(packet([symbolClaim]), observation)).resolves.toEqual({ valid: false, code: "PACKET_SCHEMA_REFUSED", authority: "NONE" });

    const hostile = new Proxy({}, { ownKeys: () => { throw new Error("HOSTILE_TRAP"); } });
    await expect(verifyClaimsAgainstObservation(hostile, observation)).resolves.toEqual({ valid: false, code: "PACKET_SCHEMA_REFUSED", authority: "NONE" });
  });

  it("admits every frozen numeric boundary at the exact UTF-8/count limit", async () => {
    const observation = await admitted([{ path: "src/value.ts", status: "M" }]);
    const textBoundary = { schema: "claim-to-code/v1", candidateSha: A, originalRequest: "x".repeat(CLAIM_PACKET_LIMITS.requestUtf8Bytes), completionSummary: "y".repeat(CLAIM_PACKET_LIMITS.summaryUtf8Bytes), claims: [{ id: "i".repeat(CLAIM_PACKET_LIMITS.idUtf8Bytes), kind: "prose", text: "é".repeat(CLAIM_PACKET_LIMITS.proseUtf8Bytes / 2) }] };
    await expect(verifyClaimsAgainstObservation(textBoundary, observation)).resolves.toMatchObject({ valid: true });
    const exactPath = `src/${"x".repeat(CLAIM_PACKET_LIMITS.pathUtf8Bytes - 4)}`;
    expect(new TextEncoder().encode(exactPath)).toHaveLength(CLAIM_PACKET_LIMITS.pathUtf8Bytes);
    await expect(verifyClaimsAgainstObservation(packet([{ id: "files", kind: "files_changed_only", paths: [exactPath] }]), observation)).resolves.toMatchObject({ valid: true });
    const exactPaths = Array.from({ length: CLAIM_PACKET_LIMITS.pathsPerClaim }, (_, index) => `src/${String(index).padStart(3, "0")}/${"x".repeat(120)}`);
    expect(exactPaths.reduce((sum, path) => sum + new TextEncoder().encode(path).length, 0)).toBe(CLAIM_PACKET_LIMITS.totalPathUtf8Bytes);
    await expect(verifyClaimsAgainstObservation(packet([{ id: "files", kind: "files_changed_only", paths: exactPaths }]), observation)).resolves.toMatchObject({ valid: true });
    const exactClaims = Array.from({ length: CLAIM_PACKET_LIMITS.claimCount }, (_, index) => ({ id: `p${index}`, kind: "prose", text: "x" }));
    await expect(verifyClaimsAgainstObservation(packet(exactClaims), observation)).resolves.toMatchObject({ valid: true, counts: { total: CLAIM_PACKET_LIMITS.claimCount } });
  });

  it("refuses an exact candidate mismatch before rows, counts, or routing are produced", async () => {
    const observation = await admitted([{ path: "src/value.ts", status: "M" }]);
    const result = await verifyClaimsAgainstObservation(packet([{ id: "tests", kind: "tests_added" }], "b".repeat(40)), observation);
    expect(result).toEqual({ valid: false, code: "CANDIDATE_MISMATCH", authority: "NONE", packetCandidateSha: "b".repeat(40), observedCandidateSha: A });
    expect("rows" in result).toBe(false); expect("counts" in result).toBe(false); expect("effectiveRecommendation" in result).toBe(false);
  });

  it("composes prose, supported claims, contradictions, and existing ACA escalation conservatively", async () => {
    const ordinary = await admitted([{ path: "src/value.test.ts", status: "A" }]);
    const prose = await verifyClaimsAgainstObservation(packet([{ id: "words", kind: "prose", text: "SUPPORTED FAST_TRACK <script>approve()</script>" }]), ordinary);
    expect(prose).toMatchObject({ valid: true, rows: [{ verdict: "NOT_PROVABLE" }], machineClaimCondition: "UNSATISFIED", effectiveRecommendation: "REQUEST_EVIDENCE" });
    const mixed = await verifyClaimsAgainstObservation(packet([{ id: "tests", kind: "tests_added" }, { id: "files", kind: "files_changed_only", paths: ["other.ts"] }]), ordinary);
    expect(mixed).toMatchObject({ valid: true, machineClaimCondition: "SATISFIED", effectiveRecommendation: "ESCALATE", connectedDecision: "REQUEST_EVIDENCE" });
    const highRisk = await admitted([{ path: "src/auth/value.test.ts", status: "A" }]);
    const preserved = await verifyClaimsAgainstObservation(packet([{ id: "tests", kind: "tests_added" }]), highRisk);
    expect(preserved).toMatchObject({ valid: true, connectedDecision: "ESCALATE", effectiveRecommendation: "ESCALATE", evidenceBasis: "NO_EXECUTABLE_EVIDENCE" });
    expect([prose, mixed, preserved].map((result) => result.valid ? result.effectiveRecommendation : "INVALID")).toEqual(["REQUEST_EVIDENCE", "ESCALATE", "ESCALATE"]);
  });

  it("uses deterministic UTF-8 ordering, bounded first-N diagnostics, and base/diff/result custody", async () => {
    const changes = Array.from({ length: 10 }, (_, index) => ({ path: `src/${String(index).padStart(2, "0")}.ts`, status: "M" as const }));
    const firstAdmission = await admitted(changes);
    const first = await verifyClaimsAgainstObservation(packet([{ id: "files", kind: "files_changed_only", paths: ["unexpected.ts"] }, { id: "z", kind: "prose", text: "z" }, { id: "a", kind: "prose", text: "a" }]), firstAdmission);
    expect(first).toMatchObject({ valid: true, rows: [{ id: "a" }, { id: "files", detail: expect.stringContaining("omitted observed paths (10): [src/00.ts, src/01.ts, src/02.ts, src/03.ts, src/04.ts, src/05.ts, src/06.ts, src/07.ts] … truncated +2 paths; unexpected claimed paths (1): [unexpected.ts]") }, { id: "z" }] });
    const reordered = await verifyClaimsAgainstObservation({ claims: [{ text: "a", kind: "prose", id: "a" }, { text: "z", id: "z", kind: "prose" }, { paths: ["unexpected.ts"], kind: "files_changed_only", id: "files" }], completionSummary: "Added tests and implementation.", originalRequest: "Add a focused verifier.", candidateSha: A, schema: "claim-to-code/v1" }, firstAdmission);
    expect(reordered).toEqual(first);
    const secondAdmission = await admitted([{ path: "other.ts", status: "M" }], A, "9".repeat(40));
    const second = await verifyClaimsAgainstObservation(packet([{ id: "files", kind: "files_changed_only", paths: ["other.ts"] }]), secondAdmission);
    expect(second).toMatchObject({ valid: true, binding: { candidateCommit: A, baseCommit: "9".repeat(40), diffDigest: secondAdmission.envelope.repository.diffDigest } });
    if (first.valid && second.valid) { expect(second.binding.admittedEnvelopeDigest).not.toBe(first.binding.admittedEnvelopeDigest); expect(second.resultDigest).not.toBe(first.resultDigest); }
  });

  it("bounds dual first-N path diagnostics without throwing", async () => {
    const observedPaths = Array.from({ length: CLAIM_PACKET_LIMITS.diagnosticPathCount }, (_, index) => `observed/${String(index).padStart(2, "0")}-${"o".repeat(470)}.ts`);
    const claimedPaths = Array.from({ length: CLAIM_PACKET_LIMITS.diagnosticPathCount }, (_, index) => `claimed/${String(index).padStart(2, "0")}-${"c".repeat(470)}.ts`);
    const observation = await admitted(observedPaths.map((path) => ({ path, status: "M" as const })));
    const result = await verifyClaimsAgainstObservation(packet([{ id: "files", kind: "files_changed_only", paths: claimedPaths }]), observation);
    expect(result).toMatchObject({ valid: true, rows: [{ verdict: "CONTRADICTED", reasonCode: "PATH_SET_MISMATCH" }], effectiveRecommendation: "ESCALATE" });
    if (result.valid) {
      const detail = result.rows[0].detail;
      expect(new TextEncoder().encode(detail).length).toBeLessThanOrEqual(CLAIM_PACKET_LIMITS.diagnosticUtf8Bytes);
      expect(detail).toContain(`omitted observed paths (${observedPaths.length})`);
      expect(detail).toContain(`unexpected claimed paths (${claimedPaths.length})`);
      expect(detail).toContain("truncated");
    }
  });

  it("refuses duplicate semantic tuples and enforces exact symbol UTF-8 admission", async () => {
    const observation = await admitted([{ path: "src/value.ts", status: "M" }]);
    const refused = [
      packet([{ id: "a", kind: "required_file_present", path: "src/value.ts" }, { id: "b", kind: "required_file_present", path: "src/value.ts" }]),
      packet([{ id: "a", kind: "required_symbol_present", path: "src/value.ts", symbol: "x" }, { id: "b", kind: "required_symbol_present", path: "src/value.ts", symbol: "x" }]),
      packet([{ id: "a", kind: "forbidden_path_untouched", path: "x" }, { id: "b", kind: "forbidden_path_untouched", path: "x" }]),
      packet([{ id: "x", kind: "required_symbol_present", path: "src/value.ts", symbol: "é".repeat(CLAIM_PACKET_LIMITS.symbolUtf8Bytes / 2 + 1) }]),
      packet([{ id: "x", kind: "required_symbol_present", path: "src/value.ts", symbol: " padded" }]),
      packet([{ id: "x", kind: "required_symbol_present", path: "src/value.ts", symbol: "e\u0301" }]),
      packet([{ id: "x", kind: "required_symbol_present", path: "src/value.ts", symbol: "x", command: "cat" }]),
    ];
    for (const value of refused) await expect(verifyClaimsAgainstObservation(value, observation)).resolves.toEqual({ valid: false, code: "PACKET_SCHEMA_REFUSED", authority: "NONE" });
    await expect(verifyClaimsAgainstObservation(packet([{ id: "x", kind: "required_symbol_present", path: "src/value.ts", symbol: "é".repeat(CLAIM_PACKET_LIMITS.symbolUtf8Bytes / 2) }]), observation)).resolves.toMatchObject({ valid: true });
  });

  it("binds parameter substitutions into both packet and result digests", async () => {
    const observation = await admitted([{ path: "src/value.ts", status: "M" }]);
    const first = await verifyClaimsAgainstObservation(packet([{ id: "x", kind: "required_symbol_present", path: "src/value.ts", symbol: "first" }]), observation);
    const second = await verifyClaimsAgainstObservation(packet([{ id: "x", kind: "required_symbol_present", path: "src/value.ts", symbol: "second" }]), observation);
    expect(first).toMatchObject({ valid: true }); expect(second).toMatchObject({ valid: true });
    if (first.valid && second.valid) { expect(first.canonicalDecodedClaimPacketDigest).not.toBe(second.canonicalDecodedClaimPacketDigest); expect(first.resultDigest).not.toBe(second.resultDigest); }
  });

  it("reports ordinary accessors and Proxy traps under distinct realistic guarantees", async () => {
    const observation = await admitted([{ path: "src/value.ts", status: "M" }]);
    let getterCalls = 0, trapCalls = 0;
    const accessor = Object.defineProperty({}, "schema", { get: () => { getterCalls++; return "claim-to-code/v1"; } });
    await expect(verifyClaimsAgainstObservation(accessor, observation)).resolves.toEqual({ valid: false, code: "PACKET_SCHEMA_REFUSED", authority: "NONE" });
    const proxy = new Proxy({}, { getPrototypeOf: () => { trapCalls++; throw new Error("trap"); } });
    await expect(verifyClaimsAgainstObservation(proxy, observation)).resolves.toEqual({ valid: false, code: "PACKET_SCHEMA_REFUSED", authority: "NONE" });
    expect(getterCalls).toBe(0); expect(trapCalls).toBeGreaterThan(0);
  });

  it("forbidden_path_untouched counts exact destinations and rename sources but not copy sources", async () => {
    for (const [change, verdict] of [
      [{ path: "forbidden.txt", status: "D" as const }, "CONTRADICTED"],
      [{ path: "safe.txt", oldPath: "forbidden.txt", status: "R" as const }, "CONTRADICTED"],
      [{ path: "safe.txt", oldPath: "forbidden.txt", status: "C" as const }, "SUPPORTED"],
    ] as const) {
      const result = await verifyClaimsAgainstObservation(packet([{ id: "forbidden", kind: "forbidden_path_untouched", path: "forbidden.txt" }]), await admitted(change.status === "D" ? [change, { path: "src/value.ts", status: "A" }] : [change]));
      expect(result).toMatchObject({ valid: true, rows: [{ verdict, reasonCode: verdict === "SUPPORTED" ? "FORBIDDEN_PATH_UNTOUCHED" : "FORBIDDEN_PATH_TOUCHED" }] });
    }
  });

  it("required_symbol_present contradicts absent files and stays NOT_PROVABLE for present files", async () => {
    const observation = await admitted([{ path: "src/value.ts", status: "M" }]);
    const result = await verifyClaimsAgainstObservation(packet([
      { id: "present", kind: "required_symbol_present", path: "src/value.ts", symbol: "verifyThing" },
      { id: "absent", kind: "required_symbol_present", path: "src/missing.ts", symbol: "verifyThing" },
    ]), observation);
    expect(result).toMatchObject({ valid: true, rows: [
      { id: "absent", verdict: "CONTRADICTED", reasonCode: "REQUIRED_SYMBOL_FILE_ABSENT", detail: "CONTRADICTED — required file is absent from the admitted candidate manifest; this does not independently inspect the symbol." },
      { id: "present", verdict: "NOT_PROVABLE", reasonCode: "REQUIRED_SYMBOL_SOURCE_BYTES_UNAVAILABLE", detail: "NOT PROVABLE — the file is present, but source bytes and parser evidence are unavailable; the symbol was not searched and is not claimed absent." },
    ], machineClaimCondition: "UNSATISFIED", effectiveRecommendation: "ESCALATE" });
    expect(JSON.stringify(result)).not.toMatch(/missing symbol|symbol verified/i);
  });

  it("required_file_present uses exact admitted manifest identity", async () => {
    const observation = await admitted([{ path: "src/value.ts", status: "M" }]);
    const result = await verifyClaimsAgainstObservation(packet([
      { id: "present", kind: "required_file_present", path: "src/value.ts" },
      { id: "absent", kind: "required_file_present", path: "src/Value.ts" },
    ]), observation);
    expect(result).toMatchObject({ valid: true, rows: [
      { id: "absent", verdict: "CONTRADICTED", reasonCode: "REQUIRED_FILE_ABSENT" },
      { id: "present", verdict: "SUPPORTED", reasonCode: "REQUIRED_FILE_PRESENT" },
    ], effectiveRecommendation: "ESCALATE" });
  });

  it("sensitive_paths_unchanged shares ACA policy and cannot create or remove base findings", async () => {
    const renamed = await verifyClaimsAgainstObservation(packet([{ id: "sensitive", kind: "sensitive_paths_unchanged" }]), await admitted([{ path: "src/plain.ts", oldPath: "src/auth/token.ts", status: "R" }]));
    expect(renamed).toMatchObject({ valid: true, connectedDecision: "ESCALATE", rows: [{ verdict: "CONTRADICTED", reasonCode: "SENSITIVE_POLICY_PATH_TOUCHED" }], effectiveRecommendation: "ESCALATE" });
    const copied = await verifyClaimsAgainstObservation(packet([{ id: "sensitive", kind: "sensitive_paths_unchanged" }]), await admitted([{ path: "src/plain.ts", oldPath: "src/auth/token.ts", status: "C" }]));
    expect(copied).toMatchObject({ valid: true, connectedDecision: "REQUEST_EVIDENCE", rows: [{ verdict: "SUPPORTED", reasonCode: "NO_SENSITIVE_POLICY_PATH_TOUCHED" }] });
  });

  it("production_config_unchanged uses exact conservative tokens and touched semantics", async () => {
    for (const [path, verdict] of [["config/test.json", "CONTRADICTED"], ["x/service-prod.yaml", "CONTRADICTED"], ["x/productionish.yaml", "SUPPORTED"], ["x/preproduction.yaml", "SUPPORTED"], ["x/prodigy.json", "SUPPORTED"]] as const) {
      const result = await verifyClaimsAgainstObservation(packet([{ id: "config", kind: "production_config_unchanged" }]), await admitted([{ path, status: "M" }]));
      expect(result).toMatchObject({ valid: true, rows: [{ verdict, reasonCode: verdict === "SUPPORTED" ? "NO_PRODUCTION_CONFIG_CONVENTION_PATH_TOUCHED" : "PRODUCTION_CONFIG_CONVENTION_PATH_TOUCHED" }] });
    }
  });

  it("workflow_unchanged counts destinations and rename sources but not copy sources", async () => {
    for (const [changes, verdict] of [
      [[{ path: "src/value.ts", status: "M" as const }], "SUPPORTED"],
      [[{ path: ".github/workflows/ci.yml", status: "D" as const }, { path: "src/value.ts", status: "A" as const }], "CONTRADICTED"],
      [[{ path: "src/renamed.ts", oldPath: ".gitlab-ci.yml", status: "R" as const }], "CONTRADICTED"],
      [[{ path: "src/copied.ts", oldPath: ".gitlab-ci.yml", status: "C" as const }], "SUPPORTED"],
    ] as const) {
      const result = await verifyClaimsAgainstObservation(packet([{ id: "workflow", kind: "workflow_unchanged" }]), await admitted(changes));
      expect(result).toMatchObject({ valid: true, rows: [{ verdict, reasonCode: verdict === "SUPPORTED" ? "NO_WORKFLOW_CONVENTION_PATH_TOUCHED" : "WORKFLOW_CONVENTION_PATH_TOUCHED" }] });
    }
  });

  it("supports dependency_changed for exact recognized basenames and requirements patterns only", async () => {
    for (const [changes, verdict] of [
      [[{ path: "nested/package.json", status: "M" as const }], "SUPPORTED"],
      [[{ path: "requirements-dev.txt", status: "A" as const }], "SUPPORTED"],
      [[{ path: "package.json.bak", status: "M" as const }], "CONTRADICTED"],
      [[{ path: "package-lock.json", status: "D" as const }, { path: "src/value.ts", status: "A" as const }], "CONTRADICTED"],
    ] as const) {
      const result = await verifyClaimsAgainstObservation(packet([{ id: "dependency", kind: "dependency_changed" }]), await admitted(changes));
      expect(result).toMatchObject({ valid: true, rows: [{ verdict, reasonCode: verdict === "SUPPORTED" ? "DEPENDENCY_CONVENTION_PATH_CHANGE_OBSERVED" : "NO_DEPENDENCY_CONVENTION_PATH_CHANGE_OBSERVED" }] });
    }
  });

  it("supports migration_included only at exact local-v1 migration boundaries", async () => {
    for (const [path, verdict] of [["db/001_add.sql", "SUPPORTED"], ["database/22-fix.SQL", "SUPPORTED"], ["db/001.sql", "CONTRADICTED"], ["db/001x.sql", "CONTRADICTED"]] as const) {
      const result = await verifyClaimsAgainstObservation(packet([{ id: "migration", kind: "migration_included" }]), await admitted([{ path, status: "M" }]));
      expect(result).toMatchObject({ valid: true, rows: [{ verdict, reasonCode: verdict === "SUPPORTED" ? "MIGRATION_CONVENTION_PATH_CHANGE_OBSERVED" : "NO_MIGRATION_CONVENTION_PATH_CHANGE_OBSERVED", detail: expect.stringContaining("reversibility") }] });
    }
  });

  it("supports documentation_updated only for candidate-present non-deleted convention paths", async () => {
    for (const [changes, verdict, reasonCode] of [
      [[{ path: "docs/guide.md", status: "M" as const }], "SUPPORTED", "DOCUMENTATION_CONVENTION_PATH_CHANGE_OBSERVED"],
      [[{ path: "docs/old.md", status: "D" as const }, { path: "src/value.ts", status: "A" as const }], "CONTRADICTED", "NO_DOCUMENTATION_CONVENTION_PATH_CHANGE_OBSERVED"],
      [[{ path: "src/value.ts", status: "M" as const }], "CONTRADICTED", "NO_DOCUMENTATION_CONVENTION_PATH_CHANGE_OBSERVED"],
    ] as const) {
      const result = await verifyClaimsAgainstObservation(packet([{ id: "docs", kind: "documentation_updated" }]), await admitted(changes));
      expect(result).toMatchObject({ valid: true, rows: [{ verdict, reasonCode }] });
    }
  });

  it("requires A/M/C/R plus candidate manifest membership and matching mode for tests_added", async () => {
    for (const changes of [
      [{ path: "gone.test.ts", status: "D" as const }, { path: "src/value.ts", status: "A" as const }],
      [{ path: "mode.test.ts", status: "M" as const, newMode: "100755" as const }],
    ]) {
      const observation = await admitted(changes);
      const modeMismatch = changes[0].path === "mode.test.ts";
      const supplied = modeMismatch ? structuredClone(observation) : observation;
      if (modeMismatch) supplied.envelope.repository.manifest[0].mode = "100644";
      const result = await verifyClaimsAgainstObservation(packet([{ id: "tests", kind: "tests_added" }]), supplied);
      expect(result).toMatchObject(modeMismatch
        ? { valid: false, code: "CONNECTED_OBSERVATION_REFUSED", authority: "NONE" }
        : { valid: true, rows: [{ verdict: "CONTRADICTED", reasonCode: "NO_TEST_PATH_CHANGE_OBSERVED" }] });
    }
  });
});
