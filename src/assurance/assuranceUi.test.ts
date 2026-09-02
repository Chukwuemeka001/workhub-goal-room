import { describe, expect, it } from "vitest";
import type { AssuranceFixture } from "./assuranceFixtures";
import { connectedEnvelopeDigest } from "./connectedAssurance";
import { CLAIM_PACKET_LIMITS } from "./claimToCodeVerifier";
import { createAssuranceCockpit } from "./assuranceUi";

const A = "a".repeat(40), B = "b".repeat(40), T = "c".repeat(40), D = "d".repeat(64);
const DOM_EVENTS: string[] = [];
class FakeElement {
  textContent = ""; value = ""; href = ""; rel = ""; id = ""; className = ""; type = ""; selected = false; htmlFor = ""; disabled = false; maxLength = 0;
  children: FakeElement[] = []; attributes = new Map<string, string>(); listeners = new Map<string, () => void>();
  ownerDocument: { createElement: (tag: string) => FakeElement }; focusCount = 0; scrollCount = 0; validity = "stale"; queryResult: FakeElement | null = null;
  constructor(readonly tagName: string, ownerDocument?: { createElement: (tag: string) => FakeElement }) { this.ownerDocument = ownerDocument ?? documentLike; }
  append(...nodes: FakeElement[]) { this.children.push(...nodes); } replaceChildren(...nodes: FakeElement[]) { this.children = nodes; DOM_EVENTS.push("replace"); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); } addEventListener(name: string, listener: () => void) { this.listeners.set(name, listener); }
  click() { if (!this.disabled) this.listeners.get("click")?.(); } focus() { this.focusCount++; DOM_EVENTS.push("focus"); } scrollIntoView() { this.scrollCount++; }
  setCustomValidity(value: string) { this.validity = value; } querySelector() { return this.queryResult; }
  allText(): string { return [this.textContent, ...this.children.map((child) => child.allText())].join(" "); }
  findByText(text: string): FakeElement | undefined { return this.textContent === text ? this : this.children.map((child) => child.findByText(text)).find(Boolean); }
  findByTag(tag: string): FakeElement | undefined { return this.tagName === tag ? this : this.children.map((child) => child.findByTag(tag)).find(Boolean); }
  findAllByTag(tag: string): FakeElement[] { return [...(this.tagName === tag ? [this] : []), ...this.children.flatMap((child) => child.findAllByTag(tag))]; }
  findByClass(className: string): FakeElement | undefined { return this.className.split(/\s+/).includes(className) ? this : this.children.map((child) => child.findByClass(className)).find(Boolean); }
}
const documentLike = { createElement: (tag: string) => new FakeElement(tag, documentLike) };
const fixture = (): AssuranceFixture => ({ id: "hostile", label: "<img src=x onerror=alert(1)>", snapshot: {
  schemaVersion: "agent-change-assurance/v1", provenance: { label: "<script>not executable</script>" }, repository: "example/repo",
  expectedCandidateSha: A, reviewedCandidateSha: B, baseSha: B, changedPaths: ["src/auth/token.ts"], additions: 1, deletions: 0,
  claims: [{ kind: "prose", text: "<b>claimed safe</b>" }, { kind: "files_changed_only", paths: ["src/auth/token.ts"] }],
  evidence: [{ kind: "unit", subjectSha: B, status: "PASS", producer: "agent", independent: true }], requiredEvidenceKinds: ["unit"],
} });
const connected = async (path = "src/auth/token.ts", status: "A" | "M" = "M") => {
  const repository: any = {
    displayName: "<img src=x onerror=alert(1)>", observedBranch: "feature/x", observedHead: A, configuredBase: B, resolvedBase: B,
    candidate: { commit: A, tree: T }, base: { commit: B, tree: B }, trackedState: "DIRTY", trackedDigest: D, untrackedCount: 1, untrackedInventoryDigest: D,
    manifest: [{ mode: "100644", path, blob: B, size: 2, contentDigest: D }], manifestDigest: D, contentManifestDigest: D,
    changedPaths: [{ path, status, oldMode: status === "A" ? "000000" : "100644", newMode: "100644", additions: 1, deletions: 0, binary: false }],
    additions: 1, deletions: 0, statusDigest: D, numstatDigest: D, patchDigest: D, diffDigest: D,
  };
  repository.manifestDigest = await connectedEnvelopeDigest(repository.manifest);
  repository.contentManifestDigest = await connectedEnvelopeDigest(repository.manifest.map(({ path, mode, size, contentDigest }: any) => ({ path, mode, size, contentDigest })));
  repository.diffDigest = await connectedEnvelopeDigest({ base: repository.base, candidate: repository.candidate, changedPaths: repository.changedPaths });
  const value: any = {
    schema: "agent-change-assurance/connected-v2", mode: "CONNECTED_LOCAL", repositoryIdentityBasis: "LOCAL_GIT_OBSERVED", claimBasis: "NOT_OBSERVED", evidenceBasis: "NO_EXECUTABLE_EVIDENCE", authority: "NONE", repository,
    checks: [{ checkId: "unit", state: "INDETERMINATE", reason: "SANDBOX_UNAVAILABLE", execution: "NOT_RUN" }, { checkId: "build", state: "INDETERMINATE", reason: "SANDBOX_UNAVAILABLE", execution: "NOT_RUN" }],
    sandbox: { status: "UNAVAILABLE", reason: "SANDBOX_UNAVAILABLE" }, githubCi: "NOT_OBSERVED_BY_THIS_LOCAL_VERIFIER",
    evaluatorSnapshot: { schemaVersion: "agent-change-assurance/v1", provenance: { label: "Connected local Git observation" }, repository: repository.displayName, expectedCandidateSha: A, reviewedCandidateSha: A, baseSha: B, changedPaths: [path], additions: 1, deletions: 0, claims: [], evidence: [], requiredEvidenceKinds: ["unit", "build"] },
  };
  value.envelopeDigest = await connectedEnvelopeDigest(value); return value;
};
const connectedV3 = async (unitState: "PASS" | "FAIL" | "INDETERMINATE" = "PASS", buildState: "PASS" | "FAIL" | "INDETERMINATE" = "PASS") => {
  const snapshot = "9".repeat(64), spec = "8".repeat(64), image = `sha256:${"7".repeat(64)}`, hostilePrefix = "<script>literal</script>😀", hostile = hostilePrefix + "x".repeat(4096 - new TextEncoder().encode(hostilePrefix).length);
  const diffRows = [{ path: "src/a.ts", status: "M", oldMode: "100644", newMode: "100644", oldBlob: A, newBlob: B, additions: 1, deletions: 0, binary: false }];
  const diffDigest = await connectedEnvelopeDigest({ schema: "aca-base-snapshot-diff/v2", baseCommit: B, baseTree: B, snapshotDigest: snapshot, rows: diffRows, additions: 1, deletions: 0 });
  const output = { sha256: "6".repeat(64), observedBytes: new TextEncoder().encode(hostile).length, preview: hostile, truncated: false, limitExceeded: false };
  const common: any = { schema: "aca-check-receipt/v1", attemptId: "attempt", snapshotDigest: snapshot, parentCommit: A, parentTree: T, baseCommit: B, baseTree: B, manifestDigest: "5".repeat(64), contentManifestDigest: "4".repeat(64), diffDigest, lockfile: { blobId: B, bytes: 10, digest: "2".repeat(64) }, imageId: image, imageLabels: { contract: "aca-sandbox/v1", spec }, verifierSpecDigest: spec, policyVersion: "aca-isolation-v1", startedAt: "2026-09-01T00:00:00.000Z", finishedAt: "2026-09-01T00:00:01.000Z", execution: "RUN", cleanup: "CONFIRMED" };
  const makeCommand = (commandId: string, state: string) => ({ commandId, exitCode: state === "PASS" ? 0 : state === "FAIL" ? 1 : null, signal: null, timeout: state === "INDETERMINATE", outputLimit: false, stdout: output, stderr: output });
  const receipts: any[] = [["unit", unitState, ["unit-vitest"]], ["build", buildState, ["build-typescript", "build-vite"]]].map(([checkId, state, ids]: any) => ({ ...common, checkId, state, reason: state === "PASS" ? "CHECK_PASSED" : state === "FAIL" ? "CHECK_FAILED" : "TIMEOUT", commands: ids.map((id: string, index: number) => makeCommand(id, index === 0 ? state : "PASS")) }));
  for (const receipt of receipts) receipt.receiptDigest = await connectedEnvelopeDigest(receipt);
  const repository = { displayName: "repo", snapshotDigest: snapshot, parentCommit: A, parentTree: T, baseCommit: B, baseTree: B, manifestDigest: "5".repeat(64), contentManifestDigest: "4".repeat(64), diffDigest, diffRows, changedPaths: ["src/a.ts"], additions: 1, deletions: 0 };
  const states = [unitState, buildState], passed = states.filter((state) => state === "PASS").length, failed = states.filter((state) => state === "FAIL").length;
  const indeterminate=2-passed-failed,completed=passed+failed,completeness=completed===2?"complete":completed===1?"partial":"absent";
  const aggregate = { passed, failed, indeterminate, complete: completed===2, sentence: `${passed} of 2 required checks passed; ${failed} failed; ${indeterminate} indeterminate; executable evidence is ${completeness}; ${indeterminate?"missing/indeterminate requirements remain":"no missing/indeterminate requirements"}.` };
  const evidence = receipts.filter((receipt) => receipt.state !== "INDETERMINATE").map((receipt) => ({ kind: receipt.checkId, subjectSha: snapshot, status: receipt.state, producer: "local_tool", independent: false }));
  const value: any = { schema: "agent-change-assurance/connected-v3", mode: "CONNECTED_LOCAL", repositoryIdentityBasis: "CUMULATIVE_DIRTY_SNAPSHOT", claimBasis: "NOT_OBSERVED", evidenceBasis: "QUALIFIED_LOCAL_SANDBOX", authority: "NONE", repository, qualification: { status: "QUALIFIED", policyVersion: "aca-isolation-v1", imageId: image, verifierSpecDigest: spec }, receipts, checks: receipts.map((receipt) => ({ checkId: receipt.checkId, state: receipt.state, reason: receipt.reason, execution: receipt.execution, receiptDigest: receipt.receiptDigest })), aggregate, evaluatorSnapshot: { schemaVersion: "agent-change-assurance/v1", provenance: { label: "Qualified local Docker sandbox" }, repository: "repo", expectedCandidateSha: snapshot, reviewedCandidateSha: snapshot, baseSha: B, changedPaths: ["src/a.ts"], additions: 1, deletions: 0, claims: [], evidence, requiredEvidenceKinds: ["unit", "build"] }, githubCi: "NOT_OBSERVED_BY_THIS_LOCAL_VERIFIER" };
  value.envelopeDigest = await connectedEnvelopeDigest(value); return JSON.parse(JSON.stringify(value));
};

const tick = async () => { for (let index = 0; index < 5; index++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const waitFor = async (predicate: () => boolean) => { for (let index = 0; index < 500; index++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 0)); } throw new Error("WAIT_FOR_TIMEOUT"); };

describe("Agent Change Assurance cockpit modes", () => {
  it("starts truthfully idle when a local observation capability is supplied, with no automatic run", async () => {
    const root = new FakeElement("section"); let calls = 0;
    createAssuranceCockpit(root as unknown as HTMLElement, [fixture()], { releaseGuardianRoot: new FakeElement("main") as unknown as HTMLElement, fetchObservation: async () => { calls++; return connected(); } });
    await tick(); expect(calls).toBe(0);
    const text = root.allText();
    expect(text).toContain("Local observation has not started");
    expect(text).toContain("Observe exact local candidate");
    expect(text).not.toContain("STATIC_UNAVAILABLE");
    expect(text).not.toMatch(/FAST_TRACK|REQUEST_EVIDENCE|ESCALATE|DEMO FIXTURE|stdout|stderr|envelopeDigest/);
  });

  it("starts STATIC_UNAVAILABLE without a local capability", () => {
    const root = new FakeElement("section");
    createAssuranceCockpit(root as unknown as HTMLElement, [fixture()], { releaseGuardianRoot: new FakeElement("main") as unknown as HTMLElement });
    const text = root.allText();
    expect(text).toContain("Local verifier unavailable in this deployment");
    expect(text).toContain("STATIC_UNAVAILABLE");
    expect(text).not.toMatch(/FAST_TRACK|REQUEST_EVIDENCE|ESCALATE|DEMO FIXTURE/);
    expect(text).not.toContain("Verify claims against observed candidate");
    expect(root.findByTag("textarea")).toBeUndefined();
  });

  it("runs only after explicit click and renders connected Git truth with checks NOT RUN", async () => {
    const root = new FakeElement("section"); let calls = 0;
    createAssuranceCockpit(root as unknown as HTMLElement, [fixture()], { releaseGuardianRoot: new FakeElement("main") as unknown as HTMLElement, fetchObservation: async () => { calls++; return connected(); } });
    root.findByText("Observe exact local candidate")?.click(); expect(root.allText()).toContain("LOCAL VERIFIER CHECKING"); await waitFor(() => root.allText().includes("POINT-IN-TIME"));
    expect(calls).toBe(1); const text = root.allText();
    for (const expected of ["POINT-IN-TIME", "LOCAL_GIT_OBSERVED", "Configured base", "INDETERMINATE", "SANDBOX_UNAVAILABLE", "NOT RUN", "NOT OBSERVED BY THIS LOCAL VERIFIER", "Authority: NONE", "Risk tier: HIGH", "HIGH_RISK_PATH", "src/auth/token.ts", A, B, T, "<img src=x onerror=alert(1)>"]) expect(text).toContain(expected);
    expect(text).not.toContain("LIVE LOCAL");
    expect(text).not.toContain("LOCAL PASS"); expect(text).not.toContain("DEMO FIXTURE");
  });

  it("verifies a structured packet only after explicit action and renders hostile prose literally", async () => {
    const root = new FakeElement("section"); let calls = 0;
    createAssuranceCockpit(root as unknown as HTMLElement, [fixture()], { releaseGuardianRoot: new FakeElement("main") as unknown as HTMLElement, fetchObservation: async () => { calls++; return connected(); } });
    root.findByText("Observe exact local candidate")?.click(); await waitFor(() => root.findByTag("textarea") !== undefined);
    expect(root.allText()).not.toContain("PROSE_NOT_MACHINE_PROVABLE");
    const input = root.findByTag("textarea");
    expect(input).toBeDefined();
    expect(root.allText()).toContain('"claims":[{"id":"tests","kind":"tests_added"}]');
    if (input) input.value = JSON.stringify({
      schema: "claim-to-code/v1", candidateSha: A, originalRequest: "<script>owner request</script>", completionSummary: "<b>agent summary</b>",
      claims: [{ id: "files", kind: "files_changed_only", paths: ["src/auth/token.ts"] }, { id: "words", kind: "prose", text: "<img src=x onerror=alert(1)> safe" }],
    });
    root.findByText("Verify claims against observed candidate")?.click(); await tick();
    expect(calls).toBe(1);
    for (const expected of ["EXACT_LOCAL_GIT_OBSERVED", "Effect on ACA routing conditions", "Effective recommendation: ESCALATE", "EXACT_PATH_SET_MATCH", "PROSE_NOT_MACHINE_PROVABLE", "Submitted text — untrusted/display only", "<script>owner request</script>", "<b>agent summary</b>", "<img src=x onerror=alert(1)> safe", "decoded JSON value only", "Authority: NONE", "NO_EXECUTABLE_EVIDENCE"]) expect(root.allText()).toContain(expected);
    expect(root.findByClass("assurance-claim-verification")).toBeDefined();
    const directions: string[] = []; const collectDirections = (entry: FakeElement) => { const direction = entry.attributes.get("dir"); if (direction) directions.push(direction); entry.children.forEach(collectDirections); }; collectDirections(root);
    expect(directions.filter((value) => value === "auto").length).toBeGreaterThanOrEqual(3);
  });

  it("refuses malformed and mismatched packets without replacing the connected receipt", async () => {
    const root = new FakeElement("section");
    createAssuranceCockpit(root as unknown as HTMLElement, [fixture()], { releaseGuardianRoot: new FakeElement("main") as unknown as HTMLElement, fetchObservation: () => connected() });
    root.findByText("Observe exact local candidate")?.click(); await waitFor(() => root.findByTag("textarea") !== undefined);
    const verify = (value: string) => { const input = root.findByTag("textarea"); if (input) input.value = value; root.findByText("Verify claims against observed candidate")?.click(); };
    verify("{");
    expect(root.allText()).toContain("CLAIM PACKET REFUSED · PACKET_JSON_MALFORMED");
    for (const expected of ["CONNECTED_LOCAL", A, "src/auth/token.ts"]) expect(root.allText()).toContain(expected);
    verify(JSON.stringify({ schema: "claim-to-code/v1", candidateSha: "b".repeat(40), originalRequest: "Review this.", completionSummary: "Done.", claims: [{ id: "tests", kind: "tests_added" }] })); await tick();
    expect(root.allText()).toContain("CLAIM PACKET REFUSED · CANDIDATE_MISMATCH");
    expect(root.allText()).toContain("No claim verdict or routing change was produced");
    expect(root.allText()).toContain(`Packet candidate ${"b".repeat(40)}`);
    expect(root.allText()).toContain(`observed candidate ${A}`);
    for (const expected of ["CONNECTED_LOCAL", A, "src/auth/token.ts"]) expect(root.allText()).toContain(expected);
  });

  it("clears the prior claim result and packet on explicit re-observation", async () => {
    const root = new FakeElement("section"); let calls = 0;
    createAssuranceCockpit(root as unknown as HTMLElement, [fixture()], { releaseGuardianRoot: new FakeElement("main") as unknown as HTMLElement, fetchObservation: async () => { calls++; return connected(); } });
    root.findByText("Observe exact local candidate")?.click(); await waitFor(() => root.findByTag("textarea") !== undefined);
    const input = root.findByTag("textarea");
    if (input) input.value = JSON.stringify({ schema: "claim-to-code/v1", candidateSha: A, originalRequest: "Review.", completionSummary: "Done.", claims: [{ id: "files", kind: "files_changed_only", paths: ["src/auth/token.ts"] }] });
    root.findByText("Verify claims against observed candidate")?.click(); await waitFor(() => root.allText().includes("EXACT_PATH_SET_MATCH"));
    expect(root.allText()).toContain("EXACT_PATH_SET_MATCH");
    root.findByText("Observe exact local candidate")?.click();
    expect(root.allText()).not.toContain("EXACT_PATH_SET_MATCH");
    await tick();
    expect(calls).toBe(2);
    expect(root.allText()).not.toContain("EXACT_PATH_SET_MATCH");
    expect(root.findByTag("textarea")?.value).toBe("");
  });

  it("connection failure never falls back; Examples deliberately enters persistent DEMO_FIXTURE", async () => {
    const root = new FakeElement("section");
    createAssuranceCockpit(root as unknown as HTMLElement, [fixture()], { releaseGuardianRoot: new FakeElement("main") as unknown as HTMLElement, fetchObservation: async () => { throw new Error("BASE_UNRESOLVED"); } });
    root.findByText("Observe exact local candidate")?.click(); await waitFor(() => root.allText().includes("BASE_UNRESOLVED"));
    expect(root.allText()).toContain("BASE_UNRESOLVED"); expect(root.allText()).not.toContain("<script>not executable</script>");
    root.findByText("Examples")?.click();
    for (const expected of ["DEMO FIXTURE", "Illustrative submitted declaration", "<script>not executable</script>", "<b>claimed safe</b>"]) expect(root.allText()).toContain(expected);
    const selector = root.children.find((child) => child.tagName === "select"); selector?.listeners.get("change")?.();
    expect(root.allText()).toContain("DEMO FIXTURE");
  });

  it("enforces the raw UTF-8 cap before JSON.parse and distinguishes schema refusal", async () => {
    const root = new FakeElement("section");
    createAssuranceCockpit(root as unknown as HTMLElement, [fixture()], { releaseGuardianRoot: new FakeElement("main") as unknown as HTMLElement, fetchObservation: () => connected() });
    root.findByText("Observe exact local candidate")?.click(); await waitFor(() => root.findByTag("textarea") !== undefined);
    const input = root.findByTag("textarea"); expect(input?.maxLength).toBe(CLAIM_PACKET_LIMITS.rawJsonUtf8Bytes);
    expect(input?.attributes.get("aria-describedby")).toBe("assurance-claim-packet-help");
    expect(root.allText()).toContain(`Raw UTF-8 limit: ${CLAIM_PACKET_LIMITS.rawJsonUtf8Bytes} bytes`);
    const originalParse = JSON.parse; let parses = 0;
    JSON.parse = ((text: string) => { parses++; return originalParse(text); }) as typeof JSON.parse;
    try {
      if (input) input.value = "é".repeat(CLAIM_PACKET_LIMITS.rawJsonUtf8Bytes / 2 + 1);
      root.findByText("Verify claims against observed candidate")?.click();
      expect(parses).toBe(0); expect(root.allText()).toContain("PACKET_SCHEMA_REFUSED");
      const nextInput = root.findByTag("textarea"); if (nextInput) nextInput.value = `${" ".repeat(CLAIM_PACKET_LIMITS.rawJsonUtf8Bytes - 2)}{}`;
      root.findByText("Verify claims against observed candidate")?.click(); await tick();
      expect(parses).toBe(1); expect(root.allText()).toContain("PACKET_SCHEMA_REFUSED");
    } finally { JSON.parse = originalParse; }
    expect(root.allText()).not.toMatch(/Counts:|EXACT_PATH_SET_MATCH|Effective recommendation:/);
  });

  it("renders the exact tests_added truth caveat with accessible focus and no untrusted markup", async () => {
    const root = new FakeElement("section");
    createAssuranceCockpit(root as unknown as HTMLElement, [fixture()], { releaseGuardianRoot: new FakeElement("main") as unknown as HTMLElement, fetchObservation: () => connected("tests/value.test.ts", "A") });
    root.findByText("Observe exact local candidate")?.click(); await waitFor(() => root.findByTag("textarea") !== undefined);
    const input = root.findByTag("textarea"); if (input) input.value = JSON.stringify({ schema: "claim-to-code/v1", candidateSha: A, originalRequest: "<script>request</script>", completionSummary: "<img src=x onerror=alert(1)>", claims: [{ id: "tests", kind: "tests_added" }] });
    DOM_EVENTS.length = 0;
    root.findByText("Verify claims against observed candidate")?.click(); await tick();
    const text = root.allText();
    expect(text).toContain("SUPPORTED — test-path change observed");
    expect(text).toContain("This establishes only that a candidate-present changed path matches the v1 test-path convention. Tests were not run; coverage, assertions, relevance, and passing status are not proven.");
    expect(text).not.toMatch(/tests verified|tests pass|PASS badge|quality score/i);
    const heading = root.findByText("Verified against this admitted observation"); expect(heading?.focusCount).toBe(1); expect(heading?.scrollCount).toBe(1);
    expect(DOM_EVENTS.lastIndexOf("focus")).toBeGreaterThan(DOM_EVENTS.lastIndexOf("replace"));
    expect(root.findByTag("script")).toBeUndefined(); expect(root.findByTag("img")).toBeUndefined();
    const attributes: string[] = []; const walk = (entry: FakeElement) => { attributes.push(...entry.attributes.values()); entry.children.forEach(walk); }; walk(root);
    expect(attributes.join(" ")).not.toContain("<script>request</script>");
  });

  it("fences late claim completion when a same-SHA re-observation starts and stays clear after refusal", async () => {
    const root = new FakeElement("section"); let calls = 0; let rejectSecond: ((reason: Error) => void) | undefined;
    const cockpit = createAssuranceCockpit(root as unknown as HTMLElement, [fixture()], { releaseGuardianRoot: new FakeElement("main") as unknown as HTMLElement, fetchObservation: async () => {
      calls++; if (calls === 1) return connected(); return new Promise((_, reject) => { rejectSecond = reject; });
    } });
    root.findByText("Observe exact local candidate")?.click(); await waitFor(() => root.findByTag("textarea") !== undefined);
    const input = root.findByTag("textarea"); if (input) input.value = JSON.stringify({ schema: "claim-to-code/v1", candidateSha: A, originalRequest: "Review.", completionSummary: "Done.", claims: [{ id: "files", kind: "files_changed_only", paths: ["src/auth/token.ts"] }] });
    root.findByText("Verify claims against observed candidate")?.click();
    root.findByText("Observe exact local candidate")?.click();
    expect(root.allText()).toContain("prior claim output cleared"); expect(root.allText()).not.toContain("EXACT_PATH_SET_MATCH");
    await tick(); expect(root.allText()).not.toContain("EXACT_PATH_SET_MATCH");
    await waitFor(() => rejectSecond !== undefined); rejectSecond?.(new Error("BASE_UNRESOLVED"));
    await waitFor(() => root.allText().includes("BASE_UNRESOLVED"));
    expect(root.allText()).toContain("BASE_UNRESOLVED"); expect(root.allText()).not.toMatch(/EXACT_PATH_SET_MATCH|Counts:|Effective recommendation:/);
    cockpit.destroy(); expect(root.children).toHaveLength(0);
  });

  it("fences late observation completion after demo transition or teardown", async () => {
    const root = new FakeElement("section"); let resolveObservation: ((value: unknown) => void) | undefined;
    const cockpit = createAssuranceCockpit(root as unknown as HTMLElement, [fixture()], { releaseGuardianRoot: new FakeElement("main") as unknown as HTMLElement, fetchObservation: () => new Promise((resolve) => { resolveObservation = resolve; }) });
    root.findByText("Observe exact local candidate")?.click();
    cockpit.render(fixture()); expect(root.allText()).toContain("DEMO FIXTURE"); expect(root.findByTag("textarea")).toBeUndefined();
    resolveObservation?.(await connected()); await tick(); expect(root.allText()).toContain("DEMO FIXTURE"); expect(root.allText()).not.toContain("CONNECTED_LOCAL");
    cockpit.observe(); cockpit.destroy(); await tick(); expect(root.children).toHaveLength(0);
  });

  it("discloses the full cumulative packet format and bounded corrective refusal", async () => {
    const root = new FakeElement("section");
    createAssuranceCockpit(root as unknown as HTMLElement, [fixture()], { releaseGuardianRoot: new FakeElement("main") as unknown as HTMLElement, fetchObservation: () => connected() });
    root.findByText("Observe exact local candidate")?.click(); await waitFor(() => root.findByTag("textarea") !== undefined);
    for (const expected of ["Packet format and rules", A, "syntax only — paths and symbols are not asserted to exist", "documentation_updated", "migration_included", "dependency_changed", "workflow_unchanged", "production_config_unchanged", "sensitive_paths_unchanged", "required_file_present", "required_symbol_present", "forbidden_path_untouched", "local-v1"]) expect(root.allText()).toContain(expected);
    for (const expected of [
      '"id":"example-tests","kind":"tests_added"',
      '"id":"example-files","kind":"files_changed_only","paths":["src/example.ts"]',
      '"id":"example-prose","kind":"prose","text":"Display-only claim"',
      '"id":"example-required-symbol","kind":"required_symbol_present","path":"src/example.ts","symbol":"exampleSymbol"',
    ]) expect(root.allText()).toContain(expected);
    const input = root.findByTag("textarea"); if (input) input.value = JSON.stringify({ schema: "claim-to-code/v1", candidateSha: A, originalRequest: "Review.", completionSummary: "Done.", claims: [{ id: "bad", kind: "required_symbol_present", path: "../x", symbol: "x" }] });
    root.findByText("Verify claims against observed candidate")?.click(); await tick();
    for (const expected of ["Exact root keys", "All admitted kinds", "Singleton", "Repeatable", "canonical relative paths", "256 UTF-8 bytes", "64 claims", "64 UTF-8 bytes per ID", "4096 UTF-8 bytes per originalRequest", "4096 UTF-8 bytes per completionSummary", "2048 UTF-8 bytes per prose text", "4096 UTF-8 bytes per bounded diagnostic", "8 displayed diagnostic paths", "Correct the packet and retry; the connected observation was not changed."]) expect(root.allText()).toContain(expected);
  });

  it("renders summary-first grouped rows with isolated hostile submitted values", async () => {
    const root = new FakeElement("section");
    createAssuranceCockpit(root as unknown as HTMLElement, [fixture()], { releaseGuardianRoot: new FakeElement("main") as unknown as HTMLElement, fetchObservation: () => connected() });
    root.findByText("Observe exact local candidate")?.click(); await waitFor(() => root.findByTag("textarea") !== undefined);
    const hostile = "\u202e<script>OWNER APPROVED</script>\u2066";
    const input = root.findByTag("textarea"); if (input) input.value = JSON.stringify({ schema: "claim-to-code/v1", candidateSha: A, originalRequest: hostile, completionSummary: hostile, claims: [
      { id: "z", kind: "required_file_present", path: "src/auth/token.ts" },
      { id: "a", kind: "documentation_updated" },
      { id: "m", kind: "required_symbol_present", path: "src/auth/token.ts", symbol: hostile },
    ] });
    root.findByText("Verify claims against observed candidate")?.click(); await waitFor(() => root.allText().includes("REQUIRED_SYMBOL_SOURCE_BYTES_UNAVAILABLE"));
    const text = root.allText();
    const summaryIndex = text.indexOf("Verification summary"); const rowIndex = text.indexOf("Submitted claim (untrusted/display only)");
    expect(summaryIndex).toBeGreaterThanOrEqual(0); expect(rowIndex).toBeGreaterThan(summaryIndex);
    for (const expected of ["Effective recommendation: ESCALATE", "Existing ACA decision: ESCALATE", "Executable evidence: NO_EXECUTABLE_EVIDENCE", "Authority: NONE", "At least one submitted machine claim is supported by its local-v1 rule: YES", "This is not packet approval; contradictions still escalate, NOT_PROVABLE rows remain unresolved, and executable evidence is absent.", "CONTRADICTED", "NOT_PROVABLE", "SUPPORTED", "Evaluated local-v1 proposition", "Trusted reason code", "Trusted caveat"]) expect(text).toContain(expected);
    expect(text).not.toContain("Machine-claim condition:");
    const details = root.findAllByTag("details").filter((entry) => ["CONTRADICTED", "NOT_PROVABLE", "SUPPORTED"].some((label) => entry.allText().includes(label)));
    expect(details).toHaveLength(3); expect(details[0].allText()).toContain("CONTRADICTED"); expect(details[0].attributes.has("open")).toBe(true);
    const bdis = root.findAllByTag("bdi"); expect(bdis.length).toBeGreaterThanOrEqual(8); expect(bdis.every((entry) => entry.attributes.get("dir") === "auto")).toBe(true);
    expect(root.findByTag("script")).toBeUndefined();
  });

  it("renders a deterministic 64-row hostile maximum with keyboard disclosures and bounded isolation", async () => {
    const root = new FakeElement("section");
    createAssuranceCockpit(root as unknown as HTMLElement, [fixture()], { releaseGuardianRoot: new FakeElement("main") as unknown as HTMLElement, fetchObservation: () => connected() });
    root.findByText("Observe exact local candidate")?.click(); await waitFor(() => root.findByTag("textarea") !== undefined);
    const claims = Array.from({ length: CLAIM_PACKET_LIMITS.claimCount }, (_, index) => ({ id: `p${String(index).padStart(2, "0")}`, kind: "forbidden_path_untouched", path: `hostile/${String(index).padStart(2, "0")}-${"x".repeat(350)}.txt` }));
    const input = root.findByTag("textarea"); if (input) input.value = JSON.stringify({ schema: "claim-to-code/v1", candidateSha: A, originalRequest: "<OWNER>\u202e", completionSummary: "FAST_TRACK\u2066", claims });
    root.findByText("Verify claims against observed candidate")?.click(); await waitFor(() => root.allText().includes("Counts: supported 64"));
    expect(root.findAllByTag("article")).toHaveLength(CLAIM_PACKET_LIMITS.claimCount);
    const summaries = root.findAllByTag("summary").filter((entry) => /^(CONTRADICTED|NOT_PROVABLE|SUPPORTED)/.test(entry.textContent));
    expect(summaries.map((entry) => entry.textContent)).toEqual(["CONTRADICTED · 0", "NOT_PROVABLE · 0", "SUPPORTED · 64"]);
    expect(root.findAllByTag("bdi").every((entry) => entry.attributes.get("dir") === "auto")).toBe(true);
    expect(root.findAllByTag("bdi").some((entry) => entry.textContent === "FAST_TRACK\u2066")).toBe(true);
  });

  it("includes claim contradiction IDs and exact observation binding only in a DOM draft", async () => {
    const root = new FakeElement("section"), guardian = new FakeElement("main"), ownerIntent = new FakeElement("textarea"); guardian.queryResult = ownerIntent;
    createAssuranceCockpit(root as unknown as HTMLElement, [fixture()], { releaseGuardianRoot: guardian as unknown as HTMLElement, fetchObservation: () => connected() });
    root.findByText("Observe exact local candidate")?.click(); await waitFor(() => root.findByTag("textarea") !== undefined);
    const input = root.findByTag("textarea"); if (input) input.value = JSON.stringify({ schema: "claim-to-code/v1", candidateSha: A, originalRequest: "Review.", completionSummary: "Done.", claims: [{ id: "omits-change", kind: "files_changed_only", paths: ["other.ts"] }] });
    root.findByText("Verify claims against observed candidate")?.click(); await waitFor(() => root.allText().includes("PATH_SET_MISMATCH"));
    root.findByText("Draft Release Guardian review")?.click();
    for (const expected of ["omits-change: PATH_SET_MISMATCH", `envelope `, A, T, B, "diff "]) expect(ownerIntent.value).toContain(expected);
    expect(root.allText()).toContain("No Release Guardian submission, command, escalation, or Owner decision occurred. The local claim comparison above remains the only verification performed.");
  });

  it("renders connected-v3 qualification, aggregate, receipts, hostile previews, focus, and authority limits", async () => {
    const root = new FakeElement("section");
    createAssuranceCockpit(root as unknown as HTMLElement, [fixture()], { releaseGuardianRoot: new FakeElement("main") as unknown as HTMLElement, fetchObservation: async () => connectedV3("PASS", "INDETERMINATE") });
    root.findByText("Observe exact local candidate")?.click();
    expect(root.allText()).toContain("LOADING"); expect(root.allText()).not.toContain("src/auth/token.ts");
    await waitFor(() => root.allText().includes("EXECUTABLE EVIDENCE · CONNECTED"));
    const text = root.allText();
    for (const expected of ["QUALIFIED", "aca-isolation-v1", "1 of 2 required checks passed", "unit: PASS · CHECK_PASSED · RUN", "build: INDETERMINATE · TIMEOUT · RUN", "Authority: NONE", "Routing: REQUEST_EVIDENCE", "Candidate code ran only inside the qualified local sandbox", "<script>literal</script>"]) expect(text).toContain(expected);
    expect(root.findAllByTag("bdi")).toHaveLength(6);
    expect(new TextEncoder().encode(root.findAllByTag("bdi")[0].textContent).length).toBe(4096);
    expect(root.findAllByTag("bdi").every((entry) => entry.attributes.get("dir") === "auto")).toBe(true);
    expect(root.findByTag("script")).toBeUndefined(); expect(root.findByTag("img")).toBeUndefined();
    const heading = root.findByText("EXECUTABLE EVIDENCE · CONNECTED"); expect(heading?.focusCount).toBe(1); expect(DOM_EVENTS.lastIndexOf("focus")).toBeGreaterThan(DOM_EVENTS.lastIndexOf("replace"));
  });

  it("detects connected-v4 and renders an explicit unavailable boundary without raw-provider interpretation", async () => {
    const root = new FakeElement("section"), v4 = { schema: "agent-change-assurance/connected-v4", authority: "NONE", external: { owner: "<script>raw-provider</script>" } };
    createAssuranceCockpit(root as unknown as HTMLElement, [fixture()], { releaseGuardianRoot: new FakeElement("main") as unknown as HTMLElement, fetchObservation: async () => v4 });
    root.findByText("Observe exact local candidate")?.click(); await waitFor(() => root.allText().includes("EXTERNAL_CONNECTOR_UNAVAILABLE"));
    expect(root.allText()).not.toContain("LOCAL OBSERVATION · REFUSED"); expect(root.allText()).not.toContain("raw-provider");
  });

  it("threads AbortSignal, fences late completion, and settles cancellation as indeterminate rather than FAIL", async () => {
    const root = new FakeElement("section"); let signal: AbortSignal | undefined; let rejectRun: ((reason: Error) => void) | undefined;
    createAssuranceCockpit(root as unknown as HTMLElement, [fixture()], { releaseGuardianRoot: new FakeElement("main") as unknown as HTMLElement, fetchObservation: (received) => { signal = received; return new Promise((_, reject) => { rejectRun = reject; received?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }); }); } });
    root.findByText("Observe exact local candidate")?.click(); expect(signal?.aborted).toBe(false);
    root.findByText("Cancel observation")?.click(); expect(signal?.aborted).toBe(true); expect(root.allText()).toContain("CANCELLING");
    rejectRun?.(new Error("late")); await waitFor(() => root.allText().includes("OBSERVATION CANCELLED · INDETERMINATE"));
    expect(root.allText()).toContain("no candidate FAIL was produced"); expect(root.allText()).not.toContain("CHECK_FAILED");
    expect(root.findByText("OBSERVATION CANCELLED · INDETERMINATE")?.focusCount ?? 0).toBe(0);
    expect(root.findByText("Observe exact local candidate")?.focusCount).toBe(1);
  });

  it("connected high-risk escalation keeps DOM-only Release Guardian handoff", async () => {
    const root = new FakeElement("section"), guardian = new FakeElement("main"), ownerIntent = new FakeElement("textarea"); guardian.queryResult = ownerIntent;
    createAssuranceCockpit(root as unknown as HTMLElement, [fixture()], { releaseGuardianRoot: guardian as unknown as HTMLElement, fetchObservation: () => connected() });
    root.findByText("Observe exact local candidate")?.click(); await waitFor(() => root.findByTag("textarea") !== undefined);
    expect(root.allText()).toContain("ESCALATE"); root.findByText("Draft Release Guardian review")?.click();
    for (const expected of [A, T, B, "diff ", "envelope "]) expect(ownerIntent.value).toContain(expected);
    expect(ownerIntent.focusCount).toBe(1); expect(guardian.scrollCount).toBe(1);
    expect(root.allText()).toContain("No Release Guardian submission, command, escalation, or Owner decision occurred. No local claim packet has been compared.");
  });
});
