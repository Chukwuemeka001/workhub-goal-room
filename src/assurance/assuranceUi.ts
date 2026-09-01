import { evaluateAgentChange } from "./agentChangeAssurance";
import { admitConnectedObservation, type ConnectedAdmission } from "./connectedAssurance";
import type { AssuranceFixture } from "./assuranceFixtures";

export interface AssuranceCockpitOptions {
  readonly releaseGuardianRoot: Pick<HTMLElement, "querySelector" | "scrollIntoView">;
  readonly fetchObservation?: () => Promise<unknown>;
}

export function createAssuranceCockpit(root: HTMLElement, fixtures: readonly AssuranceFixture[], options: AssuranceCockpitOptions) {
  if (fixtures.length === 0) throw new Error("ASSURANCE_FIXTURES_REQUIRED");
  const documentLike = root.ownerDocument;
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, value?: string) => { const element = documentLike.createElement(tag); if (value !== undefined) element.textContent = value; return element; };
  let busy = false;

  const actions = () => {
    const observe = node("button", "Observe exact local candidate"); observe.type = "button"; observe.disabled = busy || !options.fetchObservation; observe.addEventListener("click", () => { void runObservation(); });
    const examples = node("button", "Examples"); examples.type = "button"; examples.addEventListener("click", () => renderDemo(fixtures[0]));
    return [observe, examples];
  };
  const handoff = (candidate: string, findings: readonly { code: string; subject: string }[], binding = "") => {
    const button = node("button", "Prepare Release Guardian review"); button.type = "button"; button.className = "assurance-escalate";
    const status = node("p", "No escalation, command, verification, or Owner decision occurred."); status.className = "assurance-handoff-status"; status.setAttribute("aria-live", "polite");
    button.addEventListener("click", () => {
      const ownerIntent = options.releaseGuardianRoot.querySelector<HTMLTextAreaElement>("#desktop-owner-intent");
      if (!ownerIntent) { status.textContent = "Release Guardian Owner intent is unavailable. No escalation, command, verification, or Owner decision occurred."; return; }
      ownerIntent.value = `Review exact agent change ${candidate} in Release Guardian. Re-verify the exact candidate.${binding ? ` Observed binding: ${binding}.` : ""} ACA findings: ${findings.map((finding) => `${finding.code}: ${finding.subject}`).join("; ")}.`;
      ownerIntent.setCustomValidity(""); ownerIntent.focus(); options.releaseGuardianRoot.scrollIntoView({ behavior: "smooth", block: "start" });
      status.textContent = "Release Guardian review text prepared and focused. No escalation, command, verification, or Owner decision occurred.";
    });
    return [button, status];
  };
  const header = (mode: string, copy: string) => {
    const value = node("header"); value.append(node("p", mode), node("h2", "AGENT CHANGE ASSURANCE"), node("p", copy)); return value;
  };

  const renderStatic = (code?: string) => {
    const status = node("p", code ? `Local verifier unavailable in this deployment · ${code}` : "Local verifier unavailable in this deployment"); status.setAttribute("role", "status"); status.className = "assurance-verifier-status";
    const boundary = node("p", "STATIC_UNAVAILABLE · No live routing recommendation or candidate-bound receipt is displayed. The static browser-only build has no verifier endpoint."); boundary.className = "assurance-boundary";
    root.replaceChildren(header("STATIC_UNAVAILABLE", "Use the optional loopback development verifier only by deliberate action."), status, boundary, ...actions());
  };

  const renderIdle = () => {
    const status = node("p", "Local observation has not started. No repository, candidate, diff, claim, or executable evidence has been observed."); status.setAttribute("role", "status"); status.className = "assurance-verifier-status";
    const boundary = node("p", "LOCAL_OBSERVATION_NOT_STARTED · Deliberate observation is read-only and has no approval, merge, deployment, or Owner authority."); boundary.className = "assurance-boundary";
    root.replaceChildren(header("LOCAL OBSERVATION · NOT STARTED", "Use the loopback verifier only by deliberate action."), status, boundary, ...actions());
  };

  const renderRefused = (code: string) => {
    const status = node("p", `Local verifier refused the observation · ${code}`); status.setAttribute("role", "status"); status.className = "assurance-verifier-status";
    const boundary = node("p", "LOCAL_OBSERVATION_REFUSED · No live routing recommendation or candidate-bound receipt is displayed, and no fixture fallback occurred."); boundary.className = "assurance-boundary";
    root.replaceChildren(header("LOCAL OBSERVATION · REFUSED", "The requested local observation failed closed."), status, boundary, ...actions());
  };

  const renderDemo = (fixture: AssuranceFixture) => {
    const result = evaluateAgentChange(fixture.snapshot);
    if (!result.valid) { renderRefused("INVALID_ASSURANCE_SNAPSHOT"); return; }
    const badge = node("p", "DEMO FIXTURE"); badge.className = "assurance-verifier-status"; badge.setAttribute("role", "status");
    const selectorLabel = node("label", "Illustrative declaration"); const selector = node("select"); selector.id = "assurance-fixture-selector"; selectorLabel.htmlFor = selector.id;
    for (const entry of fixtures) { const option = node("option", entry.label); option.value = entry.id; option.selected = entry.id === fixture.id; selector.append(option); }
    selector.addEventListener("change", () => { const selected = fixtures.find((entry) => entry.id === selector.value); if (selected) renderDemo(selected); });
    const summary = node("section"); const decision = node("strong", result.decision); decision.className = "assurance-decision"; decision.setAttribute("data-decision", result.decision);
    summary.append(node("h3", "Declared routing result"), decision, node("p", `Risk tier: ${result.riskTier}`), node("p", `Authority: ${result.authority}`), node("p", `Identity basis: ${result.identityBasis}`));
    const claims = node("section"); claims.append(node("h3", "Claim ↔ declared paths")); const claimList = node("ul");
    for (const claim of fixture.snapshot.claims) claimList.append(node("li", claim.kind === "prose" ? `Unverified context: ${claim.text}` : claim.kind === "tests_added" ? "Machine claim: tests_added" : `Machine claim: files_changed_only (${claim.paths.join(", ")})`));
    claims.append(claimList, node("p", "Prose is display-only and never satisfies a machine-checkable claim."));
    const evidence = node("section"); evidence.append(node("h3", "Evidence subject ↔ candidate SHA"), node("p", "candidate-bound and other-candidate describe declared SHA equality only; neither means external verification."));
    const provenance = node("section"); provenance.append(node("h3", "Fixture disclosure"), node("p", fixture.snapshot.provenance.label), node("p", "Illustrative submitted declaration. Not fetched from GitHub, not read from repository bytes, and not evidence of prevalence."));
    const boundary = node("p", "This recommendation is not merge authority or Owner acceptance. It cannot verify a SHA, issue a command, satisfy a protected check, or approve deployment."); boundary.className = "assurance-boundary";
    const children: HTMLElement[] = [badge, header("EXCEPTION ROUTER · DECLARED SNAPSHOT", "This is exception, not ceremony; demo declarations are never connected evidence."), selectorLabel, selector, summary, claims, evidence, provenance, boundary, ...actions()];
    if (result.decision === "ESCALATE") children.push(...handoff(fixture.snapshot.expectedCandidateSha, result.findings));
    root.replaceChildren(...children);
  };

  const renderConnected = (admission: Extract<ConnectedAdmission, { valid: true }>) => {
    const envelope = admission.envelope; const repository = envelope.repository; const result = admission.evaluation;
    const routing = node("section"); const decision = node("strong", result.decision); decision.className = "assurance-decision"; decision.setAttribute("data-decision", result.decision);
    routing.append(node("h3", "Point-in-time routing result"), decision, node("p", result.nextAction), node("p", `Risk tier: ${result.riskTier}`), node("p", `Authority: ${result.authority}`));
    const identity = node("section"); identity.append(node("h3", "Exact local Git binding"), node("p", `Repository: ${repository.displayName} · branch: ${repository.observedBranch}`), node("p", `Candidate: ${repository.candidate.commit.slice(0, 12)} · tree: ${repository.candidate.tree.slice(0, 12)}`), node("p", `Configured base: ${repository.configuredBase.slice(0, 12)} · resolved base: ${repository.resolvedBase.slice(0, 12)}`), node("p", `Diff: ${repository.changedPaths.length} paths · ${repository.diffDigest}`), node("p", `Tracked: ${repository.trackedState} · untracked inventory: ${repository.untrackedCount} paths (${repository.untrackedInventoryDigest.slice(0, 12)})`));
    const fullIds = node("details"); const fullIdsSummary = node("summary", "Full object identifiers"); const fullIdsValue = node("code", `candidate ${repository.candidate.commit} · candidate tree ${repository.candidate.tree} · base ${repository.base.commit} · base tree ${repository.base.tree}`); fullIds.append(fullIdsSummary, fullIdsValue); identity.append(fullIds);
    const findings = node("section"); findings.append(node("h3", "Decisive findings")); const findingList = node("ul");
    for (const finding of result.findings) findingList.append(node("li", `${finding.code} · ${finding.subject} · ${finding.detail}`));
    findings.append(findingList);
    const bases = node("section"); bases.append(node("h3", "Truth bases"), node("p", `Repository identity: ${envelope.repositoryIdentityBasis}`), node("p", `Submitted claims: ${envelope.claimBasis}`), node("p", `Executable evidence: ${envelope.evidenceBasis}`));
    const checks = node("section"); checks.append(node("h3", "Executable checks")); const list = node("ul");
    for (const check of envelope.checks) list.append(node("li", `${check.checkId}: ${check.state} · ${check.reason} · ${check.execution.replace("_", " ")}`));
    checks.append(list, node("p", "GitHub/CI: NOT OBSERVED BY THIS LOCAL VERIFIER"));
    const boundary = node("p", "Local Git observation is not candidate execution, GitHub verification, CI attestation, merge safety, deployment safety, approval, or Owner acceptance."); boundary.className = "assurance-boundary";
    const freshness = node("p", "POINT-IN-TIME SNAPSHOT · Repository changes after this response are not monitored. Reobserve before relying on this routing result."); freshness.className = "assurance-boundary";
    const children: HTMLElement[] = [header("CONNECTED_LOCAL · POINT-IN-TIME", "LOCAL_GIT_OBSERVED; exact unreplaced Git objects were observed with the pinned local Git executable. Candidate-controlled code was not executed."), freshness, routing, findings, identity, bases, checks, boundary, ...actions()];
    if (result.decision === "ESCALATE") children.push(...handoff(repository.candidate.commit, result.findings, `candidate tree ${repository.candidate.tree}; explicit base ${repository.base.commit}; base tree ${repository.base.tree}; diff ${repository.diffDigest}; tracked ${repository.trackedState}; untracked ${repository.untrackedCount} paths with inventory digest ${repository.untrackedInventoryDigest}`));
    root.replaceChildren(...children);
  };

  const runObservation = async () => {
    if (!options.fetchObservation || busy) return;
    busy = true; const checking = node("p", "LOCAL VERIFIER CHECKING"); checking.setAttribute("role", "status"); root.replaceChildren(checking);
    try {
      const admission = await admitConnectedObservation(await options.fetchObservation());
      busy = false;
      if (admission.valid) renderConnected(admission); else renderRefused("INVALID_CONNECTED_OBSERVATION");
    } catch (error) {
      busy = false;
      const candidate = String((error as Error)?.message ?? "LOCAL_VERIFIER_UNAVAILABLE");
      const code = /^(?:BASE_UNRESOLVED|BASE_NOT_ANCESTOR|EMPTY_CHANGE|SOURCE_MOVED|GIT_OBSERVATION_TIMEOUT|REPOSITORY_ROOT_MISMATCH|BUSY)$/.test(candidate) ? candidate : "LOCAL_VERIFIER_UNAVAILABLE";
      renderRefused(code);
    } finally { busy = false; }
  };

  if (options.fetchObservation) renderIdle(); else renderStatic();
  return Object.freeze({ render: renderDemo, observe: runObservation });
}
