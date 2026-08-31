import { describe, expect, it } from "vitest";
import type { AssuranceFixture } from "./assuranceFixtures";
import { createAssuranceCockpit } from "./assuranceUi";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
class FakeElement {
  textContent = "";
  value = "";
  href = "";
  rel = "";
  id = "";
  className = "";
  type = "";
  selected = false;
  htmlFor = "";
  children: FakeElement[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, () => void>();
  ownerDocument: { createElement: (tag: string) => FakeElement };
  focusCount = 0;
  scrollCount = 0;
  validity = "stale";
  queryResult: FakeElement | null = null;
  constructor(readonly tagName: string, ownerDocument?: { createElement: (tag: string) => FakeElement }) {
    this.ownerDocument = ownerDocument ?? documentLike;
  }
  append(...nodes: FakeElement[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: FakeElement[]) { this.children = nodes; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  addEventListener(name: string, listener: () => void) { this.listeners.set(name, listener); }
  click() { this.listeners.get("click")?.(); }
  focus() { this.focusCount += 1; }
  scrollIntoView() { this.scrollCount += 1; }
  setCustomValidity(value: string) { this.validity = value; }
  querySelector() { return this.queryResult; }
  allText(): string { return [this.textContent, ...this.children.map((child) => child.allText())].join(" "); }
  findByText(text: string): FakeElement | undefined { return this.textContent === text ? this : this.children.map((child) => child.findByText(text)).find(Boolean); }
}
const documentLike = { createElement: (tag: string) => new FakeElement(tag, documentLike) };

function escalationFixture(): AssuranceFixture {
  return {
    id: "hostile",
    label: "<img src=x onerror=alert(1)>",
    snapshot: {
      schemaVersion: "agent-change-assurance/v1",
      provenance: { label: "<script>not executable</script>", url: "https://example.com/source" },
      repository: "example/repo",
      expectedCandidateSha: SHA_A,
      reviewedCandidateSha: SHA_B,
      baseSha: SHA_B,
      changedPaths: ["src/auth/token.ts"],
      additions: 1,
      deletions: 0,
      claims: [{ kind: "prose", text: "<b>claimed safe</b>" }, { kind: "files_changed_only", paths: ["src/auth/token.ts"] }],
      evidence: [{ kind: "unit", subjectSha: SHA_B, status: "PASS", producer: "agent", independent: true }],
      requiredEvidenceKinds: ["unit"],
    },
  };
}

describe("Agent Change Assurance cockpit", () => {
  it("renders compact exception routing, semantic joins, authority limits, and an action for every valid outcome", () => {
    const root = new FakeElement("section");
    const ownerIntent = new FakeElement("textarea");
    const guardian = new FakeElement("main");
    guardian.queryResult = ownerIntent;
    createAssuranceCockpit(root as unknown as HTMLElement, [escalationFixture()], {
      releaseGuardianRoot: guardian as unknown as HTMLElement,
    });
    const text = root.allText();
    for (const expected of [
      "AGENT CHANGE ASSURANCE", "exception, not ceremony", "claim ↔ declared paths", "expected ↔ reviewed SHA",
      "evidence subject ↔ candidate SHA", "independent verifier ↔ agent self-evidence", "DECLARED_UNVERIFIED", "Authority: NONE",
      "Next action", "candidate-bound", "other-candidate", "not merge authority or Owner acceptance",
      "Illustrative submitted declaration", "Prepare Release Guardian review", "<script>not executable</script>", "<b>claimed safe</b>",
    ]) expect(text).toContain(expected);
  });

  it("repeat-safely prefills and focuses without receiving a callback or command capability", () => {
    const root = new FakeElement("section");
    const ownerIntent = new FakeElement("textarea");
    const guardian = new FakeElement("main");
    guardian.queryResult = ownerIntent;
    createAssuranceCockpit(root as unknown as HTMLElement, [escalationFixture()], {
      releaseGuardianRoot: guardian as unknown as HTMLElement,
    });
    const button = root.findByText("Prepare Release Guardian review");
    button?.click();
    button?.click();
    expect(ownerIntent.value).toContain(SHA_A);
    expect(ownerIntent.validity).toBe("");
    expect(ownerIntent.focusCount).toBe(2);
    expect(guardian.scrollCount).toBe(2);
    expect(root.allText()).toContain("No escalation, command, verification, or Owner decision occurred.");
  });

  it("resolves the current Owner textarea after the Goal Room replaces its rendered node", () => {
    const root = new FakeElement("section");
    const staleIntent = new FakeElement("textarea");
    const currentIntent = new FakeElement("textarea");
    const guardian = new FakeElement("main");
    guardian.queryResult = staleIntent;
    createAssuranceCockpit(root as unknown as HTMLElement, [escalationFixture()], {
      releaseGuardianRoot: guardian as unknown as HTMLElement,
    });
    guardian.queryResult = currentIntent;

    root.findByText("Prepare Release Guardian review")?.click();

    expect(staleIntent.value).toBe("");
    expect(staleIntent.focusCount).toBe(0);
    expect(currentIntent.value).toContain(SHA_A);
    expect(currentIntent.focusCount).toBe(1);
  });
});
