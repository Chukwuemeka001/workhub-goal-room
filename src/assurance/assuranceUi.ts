import { evaluateAgentChange } from "./agentChangeAssurance";
import type { AssuranceFixture } from "./assuranceFixtures";

export interface AssuranceCockpitOptions {
  readonly releaseGuardianRoot: Pick<HTMLElement, "querySelector" | "scrollIntoView">;
}

export function createAssuranceCockpit(root: HTMLElement, fixtures: readonly AssuranceFixture[], options: AssuranceCockpitOptions) {
  if (fixtures.length === 0) throw new Error("ASSURANCE_FIXTURES_REQUIRED");
  const documentLike = root.ownerDocument;
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, value?: string) => {
    const element = documentLike.createElement(tag);
    if (value !== undefined) element.textContent = value;
    return element;
  };

  const render = (fixture: AssuranceFixture) => {
    const result = evaluateAgentChange(fixture.snapshot);
    if (!result.valid) {
      const invalid = node("p", "INVALID_ASSURANCE_SNAPSHOT — no routing decision or risk badge is available.");
      invalid.setAttribute("role", "status");
      root.replaceChildren(invalid);
      return;
    }

    const header = node("header");
    header.append(
      node("p", "EXCEPTION ROUTER · DECLARED SNAPSHOT"),
      node("h2", "AGENT CHANGE ASSURANCE"),
      node("p", "Before protected PR review, compare one agent-authored declaration across its claims, paths, candidate identity, and evidence."),
      node("p", "This is exception, not ceremony: routine changes return to normal protected PR review; contradictions and local v1 policy risks can be prepared for Release Guardian."),
    );

    const selectorLabel = node("label", "Illustrative declaration");
    const selector = node("select");
    selector.id = "assurance-fixture-selector";
    selectorLabel.htmlFor = selector.id;
    for (const entry of fixtures) {
      const option = node("option", entry.label);
      option.value = entry.id;
      option.selected = entry.id === fixture.id;
      selector.append(option);
    }
    selector.addEventListener("change", () => {
      const selected = fixtures.find((entry) => entry.id === selector.value);
      if (selected) render(selected);
    });

    const summary = node("section");
    summary.className = "assurance-summary";
    const decision = node("strong", result.decision);
    decision.className = "assurance-decision";
    decision.setAttribute("role", "status");
    decision.setAttribute("aria-label", `Assurance routing recommendation: ${result.decision}`);
    decision.setAttribute("data-decision", result.decision);
    summary.append(
      node("h3", "Declared routing result"), decision,
      node("p", `Risk tier: ${result.riskTier}`),
      node("p", `Authority: ${result.authority}`),
      node("p", `Identity basis: ${result.identityBasis}`),
      node("p", `Expected ↔ reviewed SHA: ${fixture.snapshot.expectedCandidateSha} ↔ ${fixture.snapshot.reviewedCandidateSha}`),
    );

    const joins = node("section");
    joins.append(node("h3", "Why this differs from green CI"));
    const joinList = node("ul");
    for (const text of ["claim ↔ declared paths", "expected ↔ reviewed SHA", "evidence subject ↔ candidate SHA", "independent verifier ↔ agent self-evidence"]) joinList.append(node("li", text));
    joins.append(joinList);

    const claims = node("section");
    claims.append(node("h3", "Claim ↔ declared paths"));
    const claimList = node("ul");
    for (const claim of fixture.snapshot.claims) {
      if (claim.kind === "prose") claimList.append(node("li", `Unverified context: ${claim.text}`));
      else claimList.append(node("li", claim.kind === "tests_added" ? "Machine claim: tests_added" : `Machine claim: files_changed_only (${claim.paths.join(", ")})`));
    }
    for (const finding of result.findings.filter((entry) => entry.code === "CLAIM_DIFF_MISMATCH")) claimList.append(node("li", `${finding.code}: ${finding.detail}`));
    claims.append(claimList, node("p", "Prose is display-only and never satisfies a machine-checkable claim."));

    const evidence = node("section");
    evidence.append(node("h3", "Evidence subject ↔ candidate SHA"));
    const evidenceList = node("ul");
    for (const entry of result.evidenceBindings) {
      const label = entry.state === "CANDIDATE_BOUND" ? "candidate-bound" : entry.state === "OTHER_CANDIDATE" ? "other-candidate" : entry.state.toLowerCase();
      evidenceList.append(node("li", `${entry.kind}: ${label} · ${entry.independent ? "independent verifier" : "agent/self or declared non-independent"}`));
    }
    for (const entry of fixture.snapshot.evidence) {
      const relation = entry.subjectSha === fixture.snapshot.expectedCandidateSha ? "candidate-bound" : "other-candidate";
      evidenceList.append(node("li", `${entry.kind} declaration: ${relation} (${entry.subjectSha}) · ${entry.producer === "agent" ? "agent self-evidence" : entry.producer}`));
    }
    evidence.append(evidenceList, node("p", "candidate-bound describes declared SHA equality; other-candidate identifies a declared mismatch. Neither means temporal freshness or external verification."));

    const action = node("section");
    action.className = "assurance-next-action";
    action.append(node("h3", "Next action"), node("p", result.nextAction));

    const provenance = node("section");
    provenance.append(node("h3", "Fixture disclosure"), node("p", fixture.snapshot.provenance.label));
    if (fixture.snapshot.provenance.url) {
      const link = node("a", "Public source");
      link.href = fixture.snapshot.provenance.url;
      link.rel = "noreferrer";
      provenance.append(link);
    }
    provenance.append(node("p", "Illustrative submitted declaration. Not fetched from GitHub, not read from repository bytes, and not evidence of prevalence."));

    const boundary = node("p", "This recommendation is not merge authority or Owner acceptance. It cannot verify a SHA, issue a command, satisfy a protected check, or approve deployment.");
    boundary.className = "assurance-boundary";
    const children: HTMLElement[] = [header, selectorLabel, selector, summary, joins, claims, evidence, action, provenance, boundary];
    if (result.decision === "ESCALATE") {
      const button = node("button", "Prepare Release Guardian review");
      button.type = "button";
      button.className = "assurance-escalate";
      const status = node("p", "No escalation, command, verification, or Owner decision occurred.");
      status.className = "assurance-handoff-status";
      status.setAttribute("aria-live", "polite");
      button.addEventListener("click", () => {
        const ownerIntent = options.releaseGuardianRoot.querySelector<HTMLTextAreaElement>("#desktop-owner-intent");
        if (!ownerIntent) {
          status.textContent = "Release Guardian Owner intent is unavailable. No escalation, command, verification, or Owner decision occurred.";
          return;
        }
        const decisive = result.findings.map((finding) => `${finding.code}: ${finding.subject}`).join("; ");
        ownerIntent.value = `Review declared agent change ${fixture.snapshot.expectedCandidateSha} in Release Guardian. Re-verify the exact candidate. ACA declared findings: ${decisive}.`;
        ownerIntent.setCustomValidity("");
        ownerIntent.focus();
        options.releaseGuardianRoot.scrollIntoView({ behavior: "smooth", block: "start" });
        status.textContent = "Release Guardian review text prepared and focused. No escalation, command, verification, or Owner decision occurred.";
      });
      children.push(button, status);
    }
    root.replaceChildren(...children);
  };

  render(fixtures[0]);
  return Object.freeze({ render });
}
