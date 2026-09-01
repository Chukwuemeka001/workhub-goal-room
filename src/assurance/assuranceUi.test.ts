import { describe, expect, it } from "vitest";
import type { AssuranceFixture } from "./assuranceFixtures";
import { connectedEnvelopeDigest } from "./connectedAssurance";
import { createAssuranceCockpit } from "./assuranceUi";

const A = "a".repeat(40), B = "b".repeat(40), T = "c".repeat(40), D = "d".repeat(64);
class FakeElement {
  textContent = ""; value = ""; href = ""; rel = ""; id = ""; className = ""; type = ""; selected = false; htmlFor = ""; disabled = false;
  children: FakeElement[] = []; attributes = new Map<string, string>(); listeners = new Map<string, () => void>();
  ownerDocument: { createElement: (tag: string) => FakeElement }; focusCount = 0; scrollCount = 0; validity = "stale"; queryResult: FakeElement | null = null;
  constructor(readonly tagName: string, ownerDocument?: { createElement: (tag: string) => FakeElement }) { this.ownerDocument = ownerDocument ?? documentLike; }
  append(...nodes: FakeElement[]) { this.children.push(...nodes); } replaceChildren(...nodes: FakeElement[]) { this.children = nodes; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); } addEventListener(name: string, listener: () => void) { this.listeners.set(name, listener); }
  click() { if (!this.disabled) this.listeners.get("click")?.(); } focus() { this.focusCount++; } scrollIntoView() { this.scrollCount++; }
  setCustomValidity(value: string) { this.validity = value; } querySelector() { return this.queryResult; }
  allText(): string { return [this.textContent, ...this.children.map((child) => child.allText())].join(" "); }
  findByText(text: string): FakeElement | undefined { return this.textContent === text ? this : this.children.map((child) => child.findByText(text)).find(Boolean); }
}
const documentLike = { createElement: (tag: string) => new FakeElement(tag, documentLike) };
const fixture = (): AssuranceFixture => ({ id: "hostile", label: "<img src=x onerror=alert(1)>", snapshot: {
  schemaVersion: "agent-change-assurance/v1", provenance: { label: "<script>not executable</script>" }, repository: "example/repo",
  expectedCandidateSha: A, reviewedCandidateSha: B, baseSha: B, changedPaths: ["src/auth/token.ts"], additions: 1, deletions: 0,
  claims: [{ kind: "prose", text: "<b>claimed safe</b>" }, { kind: "files_changed_only", paths: ["src/auth/token.ts"] }],
  evidence: [{ kind: "unit", subjectSha: B, status: "PASS", producer: "agent", independent: true }], requiredEvidenceKinds: ["unit"],
} });
const connected = async () => {
  const repository: any = {
    displayName: "<img src=x onerror=alert(1)>", observedBranch: "feature/x", observedHead: A, configuredBase: B, resolvedBase: B,
    candidate: { commit: A, tree: T }, base: { commit: B, tree: B }, trackedState: "DIRTY", trackedDigest: D, untrackedCount: 1, untrackedInventoryDigest: D,
    manifest: [{ mode: "100644", path: "src/auth/token.ts", blob: B, size: 2, contentDigest: D }], manifestDigest: D, contentManifestDigest: D,
    changedPaths: [{ path: "src/auth/token.ts", status: "M", oldMode: "100644", newMode: "100644", additions: 1, deletions: 0, binary: false }],
    additions: 1, deletions: 0, statusDigest: D, numstatDigest: D, patchDigest: D, diffDigest: D,
  };
  repository.manifestDigest = await connectedEnvelopeDigest(repository.manifest);
  repository.contentManifestDigest = await connectedEnvelopeDigest(repository.manifest.map(({ path, mode, size, contentDigest }: any) => ({ path, mode, size, contentDigest })));
  repository.diffDigest = await connectedEnvelopeDigest({ base: repository.base, candidate: repository.candidate, changedPaths: repository.changedPaths });
  const value: any = {
    schema: "agent-change-assurance/connected-v2", mode: "CONNECTED_LOCAL", repositoryIdentityBasis: "LOCAL_GIT_OBSERVED", claimBasis: "NOT_OBSERVED", evidenceBasis: "NO_EXECUTABLE_EVIDENCE", authority: "NONE", repository,
    checks: [{ checkId: "unit", state: "INDETERMINATE", reason: "SANDBOX_UNAVAILABLE", execution: "NOT_RUN" }, { checkId: "build", state: "INDETERMINATE", reason: "SANDBOX_UNAVAILABLE", execution: "NOT_RUN" }],
    sandbox: { status: "UNAVAILABLE", reason: "SANDBOX_UNAVAILABLE" }, githubCi: "NOT_OBSERVED_BY_THIS_LOCAL_VERIFIER",
    evaluatorSnapshot: { schemaVersion: "agent-change-assurance/v1", provenance: { label: "Connected local Git observation" }, repository: repository.displayName, expectedCandidateSha: A, reviewedCandidateSha: A, baseSha: B, changedPaths: ["src/auth/token.ts"], additions: 1, deletions: 0, claims: [], evidence: [], requiredEvidenceKinds: ["unit", "build"] },
  };
  value.envelopeDigest = await connectedEnvelopeDigest(value); return value;
};
const tick = async () => { for (let index = 0; index < 5; index++) await new Promise((resolve) => setTimeout(resolve, 0)); };

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
  });

  it("runs only after explicit click and renders connected Git truth with checks NOT RUN", async () => {
    const root = new FakeElement("section"); let calls = 0;
    createAssuranceCockpit(root as unknown as HTMLElement, [fixture()], { releaseGuardianRoot: new FakeElement("main") as unknown as HTMLElement, fetchObservation: async () => { calls++; return connected(); } });
    root.findByText("Observe exact local candidate")?.click(); expect(root.allText()).toContain("LOCAL VERIFIER CHECKING"); await tick();
    expect(calls).toBe(1); const text = root.allText();
    for (const expected of ["POINT-IN-TIME", "LOCAL_GIT_OBSERVED", "Configured base", "INDETERMINATE", "SANDBOX_UNAVAILABLE", "NOT RUN", "NOT OBSERVED BY THIS LOCAL VERIFIER", "Authority: NONE", "Risk tier: HIGH", "HIGH_RISK_PATH", "src/auth/token.ts", A, B, T, "<img src=x onerror=alert(1)>"]) expect(text).toContain(expected);
    expect(text).not.toContain("LIVE LOCAL");
    expect(text).not.toContain("LOCAL PASS"); expect(text).not.toContain("DEMO FIXTURE");
  });

  it("connection failure never falls back; Examples deliberately enters persistent DEMO_FIXTURE", async () => {
    const root = new FakeElement("section");
    createAssuranceCockpit(root as unknown as HTMLElement, [fixture()], { releaseGuardianRoot: new FakeElement("main") as unknown as HTMLElement, fetchObservation: async () => { throw new Error("BASE_UNRESOLVED"); } });
    root.findByText("Observe exact local candidate")?.click(); await tick();
    expect(root.allText()).toContain("BASE_UNRESOLVED"); expect(root.allText()).not.toContain("<script>not executable</script>");
    root.findByText("Examples")?.click();
    for (const expected of ["DEMO FIXTURE", "Illustrative submitted declaration", "<script>not executable</script>", "<b>claimed safe</b>"]) expect(root.allText()).toContain(expected);
    const selector = root.children.find((child) => child.tagName === "select"); selector?.listeners.get("change")?.();
    expect(root.allText()).toContain("DEMO FIXTURE");
  });

  it("connected high-risk escalation keeps DOM-only Release Guardian handoff", async () => {
    const root = new FakeElement("section"), guardian = new FakeElement("main"), ownerIntent = new FakeElement("textarea"); guardian.queryResult = ownerIntent;
    createAssuranceCockpit(root as unknown as HTMLElement, [fixture()], { releaseGuardianRoot: guardian as unknown as HTMLElement, fetchObservation: connected });
    root.findByText("Observe exact local candidate")?.click(); await tick();
    expect(root.allText()).toContain("ESCALATE"); root.findByText("Prepare Release Guardian review")?.click();
    for (const expected of [A, T, B, "diff "]) expect(ownerIntent.value).toContain(expected);
    expect(ownerIntent.value).toContain("tracked DIRTY"); expect(ownerIntent.focusCount).toBe(1); expect(guardian.scrollCount).toBe(1);
    expect(root.allText()).toContain("No escalation, command, verification, or Owner decision occurred.");
  });
});
