import { evaluateAgentChange } from "./agentChangeAssurance";
import { admitConnectedObservation, admitConnectedV3Observation, type ConnectedAdmission } from "./connectedAssurance";
import { CLAIM_PACKET_LIMITS, verifyClaimsAgainstObservation, type ClaimVerificationResult } from "./claimToCodeVerifier";
import { LOCAL_V1_PATH_POLICY_SUMMARY } from "./pathPolicy";
import type { AssuranceFixture } from "./assuranceFixtures";

export interface AssuranceCockpitOptions {
  readonly releaseGuardianRoot: Pick<HTMLElement, "querySelector" | "scrollIntoView">;
  readonly fetchObservation?: (signal?: AbortSignal) => Promise<unknown>;
}
type ClaimUiState = ClaimVerificationResult | { readonly valid: false; readonly code: "PACKET_JSON_MALFORMED"; readonly authority: "NONE" };

export function createAssuranceCockpit(root: HTMLElement, fixtures: readonly AssuranceFixture[], options: AssuranceCockpitOptions) {
  if (fixtures.length === 0) throw new Error("ASSURANCE_FIXTURES_REQUIRED");
  const documentLike = root.ownerDocument;
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, value?: string) => { const element = documentLike.createElement(tag); if (value !== undefined) element.textContent = value; return element; };
  let busy = false, generation = 0, claimAttempt = 0, destroyed = false;
  let activeAbort: AbortController | undefined, activePromise: Promise<void> | undefined;

  const actions = (live = true) => {
    const result: HTMLElement[] = [];
    if (live && options.fetchObservation) { const observe = node("button", busy ? "Observation in progress" : "Observe exact local candidate"); observe.type = "button"; observe.disabled = busy; observe.addEventListener("click", () => { void runObservation(); }); result.push(observe); }
    const examples = node("button", "Examples"); examples.type = "button"; examples.disabled = busy; examples.addEventListener("click", () => renderDemo(fixtures[0])); result.push(examples);
    return result;
  };
  const handoff = (candidate: string, findings: readonly { code: string; subject: string }[], binding = "", claimContradictions: readonly { id: string; reasonCode: string }[] = [], hasClaimResult = false) => {
    const button = node("button", "Draft Release Guardian review"); button.type = "button"; button.className = "assurance-escalate";
    const scopedStatus = hasClaimResult ? "No Release Guardian submission, command, escalation, or Owner decision occurred. The local claim comparison above remains the only verification performed." : "No Release Guardian submission, command, escalation, or Owner decision occurred. No local claim packet has been compared.";
    const status = node("p", scopedStatus); status.className = "assurance-handoff-status"; status.setAttribute("aria-live", "polite");
    button.addEventListener("click", () => {
      const ownerIntent = options.releaseGuardianRoot.querySelector<HTMLTextAreaElement>("#desktop-owner-intent");
      if (!ownerIntent) { status.textContent = `Release Guardian Owner intent is unavailable. ${scopedStatus}`; return; }
      const contradictions = claimContradictions.length ? ` Claim contradictions: ${claimContradictions.map((row) => `${row.id}: ${row.reasonCode}`).join("; ")}.` : "";
      ownerIntent.value = `Draft review for exact agent change ${candidate}. Re-observe and re-verify the exact candidate.${binding ? ` Observation binding: ${binding}.` : ""} ACA findings: ${findings.map((finding) => `${finding.code}: ${finding.subject}`).join("; ")}.${contradictions}`;
      ownerIntent.setCustomValidity(""); ownerIntent.focus(); options.releaseGuardianRoot.scrollIntoView({ behavior: "smooth", block: "start" });
      status.textContent = hasClaimResult ? "Draft review text inserted and focused. No Release Guardian submission, command, escalation, or Owner decision occurred. The local claim comparison above remains the only verification performed." : "Draft review text inserted and focused. No Release Guardian submission, command, escalation, or Owner decision occurred. No local claim packet has been compared.";
    });
    return [button, status];
  };
  const header = (mode: string, copy: string) => { const value = node("header"); value.append(node("p", mode), node("h2", "AGENT CHANGE ASSURANCE"), node("p", copy)); return value; };
  const invalidateClaims = () => { generation++; claimAttempt++; };

  const renderStatic = (code?: string) => {
    const status = node("p", code ? `Local verifier unavailable in this deployment · ${code}` : "Local verifier unavailable in this deployment"); status.setAttribute("role", "status"); status.className = "assurance-verifier-status";
    const boundary = node("p", "STATIC_UNAVAILABLE · No packet control, live claim output, routing recommendation, or candidate-bound receipt is available. The static browser-only build has no verifier endpoint."); boundary.className = "assurance-boundary";
    root.replaceChildren(header("STATIC_UNAVAILABLE", "Observe an exact local candidate to enable claim verification; this deployment cannot do so."), status, boundary, ...actions(false));
  };
  const renderIdle = () => {
    const status = node("p", "Local observation has not started. Observe an exact local candidate to enable claim verification."); status.setAttribute("role", "status"); status.className = "assurance-verifier-status";
    const boundary = node("p", "LOCAL_OBSERVATION_NOT_STARTED · No repository, candidate, diff, claim, or executable evidence has been observed. No approval, merge, deployment, or Owner authority exists."); boundary.className = "assurance-boundary";
    root.replaceChildren(header("LOCAL OBSERVATION · NOT STARTED", "Exact local observation is required before a claim packet can be evaluated."), status, boundary, ...actions());
  };
  const renderRefused = (code: string) => {
    const status = node("p", `Local verifier refused the observation · ${code}`); status.setAttribute("role", "status"); status.className = "assurance-verifier-status";
    const boundary = node("p", "LOCAL_OBSERVATION_REFUSED · Claim output was cleared. No live routing recommendation or candidate-bound receipt is displayed, and no fixture fallback occurred."); boundary.className = "assurance-boundary";
    root.replaceChildren(header("LOCAL OBSERVATION · REFUSED", "The requested local observation failed closed."), status, boundary, ...actions());
  };
  const renderExternalConnectorUnavailable = () => {
    const status=node("p","External evidence is available only in the installed trusted controller.");status.setAttribute("role","status");status.className="assurance-verifier-status";
    const boundary=node("p","EXTERNAL_CONNECTOR_UNAVAILABLE · This integrated cockpit does not admit or reinterpret connected-v4 provider objects. Use the installed controller for normalized external evidence. Authority: NONE.");boundary.className="assurance-boundary";
    root.replaceChildren(header("EXTERNAL CONNECTOR · UNAVAILABLE","The connected-v4 response was detected and refused at this capability boundary."),status,boundary,...actions());
  };
  const renderDemo = (fixture: AssuranceFixture) => {
    if (destroyed) return; activeAbort?.abort(); activeAbort = undefined; invalidateClaims(); busy = false;
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
    const boundary = node("p", "DEMO_FIXTURE has no connected packet control or live claim output. This declaration is not merge authority or Owner acceptance and cannot verify a SHA, issue a command, satisfy a protected check, or approve deployment."); boundary.className = "assurance-boundary";
    const children: HTMLElement[] = [badge, header("EXCEPTION ROUTER · DECLARED SNAPSHOT", "This is exception, not ceremony; demo declarations are never connected evidence."), selectorLabel, selector, summary, claims, evidence, provenance, boundary, ...actions(false)];
    if (result.decision === "ESCALATE") children.push(...handoff(fixture.snapshot.expectedCandidateSha, result.findings));
    root.replaceChildren(...children);
  };

  const renderConnected = (admission: Extract<ConnectedAdmission, { valid: true }>, token: number, claimState?: ClaimUiState, claimText = "") => {
    if (destroyed || token !== generation) return;
    const envelope = admission.envelope, repository = envelope.repository, result = admission.evaluation;
    const claimVerification = node("section"); claimVerification.className = "assurance-claim-verification"; claimVerification.append(node("h3", "Claim-to-code verification"));
    const claimLabel = node("label", "Structured claim-to-code/v1 packet — local decoded JSON"); const claimInput = node("textarea"); claimInput.id = "assurance-claim-packet"; claimInput.maxLength = CLAIM_PACKET_LIMITS.rawJsonUtf8Bytes; claimInput.value = claimText; claimLabel.htmlFor = claimInput.id;
    const help = node("p", `Paste one decoded claim-to-code/v1 JSON object with schema, candidateSha, originalRequest, completionSummary, and claims. Example machine claim: {"claims":[{"id":"tests","kind":"tests_added"}]}. Raw UTF-8 limit: ${CLAIM_PACKET_LIMITS.rawJsonUtf8Bytes} bytes. Verification occurs only on explicit click.`); help.id = "assurance-claim-packet-help"; claimInput.setAttribute("aria-describedby", help.id);
    const format = node("details"); const formatSummary = node("summary", "Packet format and rules");
    const claimExamples = [
      { id: "example-tests", kind: "tests_added" },
      { id: "example-files", kind: "files_changed_only", paths: ["src/example.ts"] },
      { id: "example-prose", kind: "prose", text: "Display-only claim" },
      { id: "example-docs", kind: "documentation_updated" },
      { id: "example-migration", kind: "migration_included" },
      { id: "example-dependency", kind: "dependency_changed" },
      { id: "example-workflow", kind: "workflow_unchanged" },
      { id: "example-production-config", kind: "production_config_unchanged" },
      { id: "example-sensitive", kind: "sensitive_paths_unchanged" },
      { id: "example-required-file", kind: "required_file_present", path: "src/example.ts" },
      { id: "example-required-symbol", kind: "required_symbol_present", path: "src/example.ts", symbol: "exampleSymbol" },
      { id: "example-forbidden", kind: "forbidden_path_untouched", path: "secrets/example.txt" },
    ];
    const fullExample = JSON.stringify({ schema: "claim-to-code/v1", candidateSha: repository.candidate.commit, originalRequest: "Review this exact candidate.", completionSummary: "Candidate work completed.", claims: claimExamples });
    const forms = JSON.stringify(claimExamples);
    format.append(formatSummary, node("p", `Complete schema-valid packet for the currently observed full candidate SHA: ${fullExample}`), node("p", `All admitted claim forms as schema-valid JSON claim objects — syntax only — paths and symbols are not asserted to exist: ${forms}`), node("p", `Decoded-JSON value boundary; duplicate raw JSON keys are not detected. Verification requires an explicit click and performs no execution, command, submission, or effect. Paths match exactly and must be canonical relative paths. Singleton kinds: tests_added, files_changed_only, documentation_updated, migration_included, dependency_changed, workflow_unchanged, production_config_unchanged, sensitive_paths_unchanged. Repeatable kinds: prose and parameterized required_file_present, required_symbol_present, forbidden_path_untouched; duplicate semantic tuples are refused. Symbols are trimmed NFC strings without controls, at most ${CLAIM_PACKET_LIMITS.symbolUtf8Bytes} UTF-8 bytes. ${LOCAL_V1_PATH_POLICY_SUMMARY}`));
    const verifyClaims = node("button", "Verify claims against observed candidate"); verifyClaims.type = "button";
    verifyClaims.addEventListener("click", () => {
      const text = claimInput.value, attempt = ++claimAttempt;
      if (new TextEncoder().encode(text).length > CLAIM_PACKET_LIMITS.rawJsonUtf8Bytes) {
        renderConnected(admission, token, Object.freeze({ valid: false, code: "PACKET_SCHEMA_REFUSED", authority: "NONE" }), text); return;
      }
      let packet: unknown;
      try { packet = JSON.parse(text); } catch { renderConnected(admission, token, Object.freeze({ valid: false, code: "PACKET_JSON_MALFORMED", authority: "NONE" }), text); return; }
      void verifyClaimsAgainstObservation(packet, admission).then((verified) => {
        if (destroyed || token !== generation || attempt !== claimAttempt) return;
        renderConnected(admission, token, verified, text);
      });
    });
    claimVerification.append(claimLabel, help, format, claimInput, verifyClaims);
    let claimFocusTarget: HTMLElement | undefined;
    if (claimState && !claimState.valid) {
      const refusal = node("div"); refusal.setAttribute("role", "alert"); refusal.setAttribute("tabindex", "-1");
      const wording = claimState.code === "CANDIDATE_MISMATCH" ? `Packet refused before claim evaluation. Packet candidate ${claimState.packetCandidateSha} does not match observed candidate ${claimState.observedCandidateSha}. Correct candidateSha and retry. No claim verdict or routing change was produced.`
        : claimState.code === "PACKET_JSON_MALFORMED" ? "Packet JSON is malformed. No claim verdict or routing change was produced."
          : "Packet schema or frozen size limits were refused. No claim verdict or routing change was produced.";
      refusal.append(node("h4", `CLAIM PACKET REFUSED · ${claimState.code}`), node("p", `${wording} Connected repository receipt unchanged.`));
      if (claimState.code === "PACKET_SCHEMA_REFUSED") refusal.append(node("p", `Correction guidance — Exact root keys: schema, candidateSha, originalRequest, completionSummary, claims. All admitted kinds: tests_added, files_changed_only, prose, documentation_updated, migration_included, dependency_changed, workflow_unchanged, production_config_unchanged, sensitive_paths_unchanged, required_file_present, required_symbol_present, forbidden_path_untouched. Singleton convention kinds and files_changed_only/tests_added may appear once; Repeatable prose and parameterized kinds require unique IDs and semantic tuples. Paths must be NFC canonical relative paths, at most ${CLAIM_PACKET_LIMITS.pathUtf8Bytes} UTF-8 bytes. Symbols must be trimmed NFC without controls, at most ${CLAIM_PACKET_LIMITS.symbolUtf8Bytes} UTF-8 bytes. Numeric limits: ${CLAIM_PACKET_LIMITS.claimCount} claims; ${CLAIM_PACKET_LIMITS.idUtf8Bytes} UTF-8 bytes per ID; ${CLAIM_PACKET_LIMITS.requestUtf8Bytes} UTF-8 bytes per originalRequest; ${CLAIM_PACKET_LIMITS.summaryUtf8Bytes} UTF-8 bytes per completionSummary; ${CLAIM_PACKET_LIMITS.proseUtf8Bytes} UTF-8 bytes per prose text; ${CLAIM_PACKET_LIMITS.pathsPerClaim} paths per list; ${CLAIM_PACKET_LIMITS.totalPathUtf8Bytes} total path bytes; ${CLAIM_PACKET_LIMITS.diagnosticUtf8Bytes} UTF-8 bytes per bounded diagnostic; ${CLAIM_PACKET_LIMITS.diagnosticPathCount} displayed diagnostic paths; ${CLAIM_PACKET_LIMITS.rawJsonUtf8Bytes} raw JSON bytes. Correct the packet and retry; the connected observation was not changed.`));
      claimVerification.append(refusal); claimFocusTarget = refusal;
    }
    if (claimState?.valid) {
      const resultHeading = node("h4", "Verified against this admitted observation"); resultHeading.setAttribute("tabindex", "-1"); claimVerification.append(resultHeading);
      const routingEffect = node("section"); routingEffect.append(node("h5", "Verification summary · Effect on ACA routing conditions"), node("p", `Effective recommendation: ${claimState.effectiveRecommendation}`), node("p", `Existing ACA decision: ${claimState.connectedDecision}`), node("p", `Executable evidence: ${claimState.evidenceBasis}`), node("p", "Authority: NONE"), node("p", `Counts: supported ${claimState.counts.supported} · contradicted ${claimState.counts.contradicted} · not provable ${claimState.counts.notProvable} · total ${claimState.counts.total}`), node("p", `At least one submitted machine claim is supported by its local-v1 rule: ${claimState.machineClaimCondition === "SATISFIED" ? "YES" : "NO"}.`), node("p", "This is not packet approval; contradictions still escalate, NOT_PROVABLE rows remain unresolved, and executable evidence is absent."));
      const binding = claimState.binding;
      const bindingSummary = node("section"); bindingSummary.append(node("h5", "Candidate and digest custody"), node("p", `Candidate binding: ${claimState.candidateBinding}`), node("p", `Candidate ${binding.candidateCommit.slice(0, 12)} · tree ${binding.candidateTree.slice(0, 12)} · base ${binding.baseCommit.slice(0, 12)} · base tree ${binding.baseTree.slice(0, 12)} · diff ${binding.diffDigest.slice(0, 12)}`), node("p", `Admitted envelope digest: ${binding.admittedEnvelopeDigest}`), node("p", `Canonical decoded claim-packet digest: ${claimState.canonicalDecodedClaimPacketDigest}`), node("p", `Deterministic result digest: ${claimState.resultDigest}`), node("p", "Digests prove deterministic integrity, not authenticity. v1 evaluates the decoded JSON value only; it makes no raw-byte identity or duplicate-key claim."));
      const isolated = (label: string, value: string) => { const line = node("p"); line.append(node("span", label), node("bdi", value)); const valueNode = line.children[1] as HTMLElement; valueNode.setAttribute("dir", "auto"); valueNode.className = "assurance-untrusted"; return line; };
      const submitted = node("section"); submitted.append(node("h5", "Submitted text — untrusted/display only"), isolated("Original request (untrusted/display only): ", claimState.context.originalRequest), isolated("Agent completion summary (untrusted/display only): ", claimState.context.completionSummary));
      const proposition = (kind: string) => ({
        documentation_updated: "Whether a candidate-present documentation-convention path changed.", migration_included: "Whether a candidate-present migration-convention path changed.", dependency_changed: "Whether a candidate-present dependency-convention path changed.", workflow_unchanged: "Whether no workflow-convention path was touched.", production_config_unchanged: "Whether no production-config-convention path was touched.", sensitive_paths_unchanged: "Whether no shared-policy-sensitive path was touched.", required_file_present: "Whether the exact path is present in the candidate manifest.", required_symbol_present: "Whether admitted metadata can prove the submitted symbol proposition.", forbidden_path_untouched: "Whether the exact path was untouched under destination/rename-source rules.", tests_added: "Whether a candidate-present test-convention path changed.", files_changed_only: "Whether submitted and observed destination path sets are exactly equal.", prose: "Submitted prose is display-only and not machine provable.",
      } as Record<string, string>)[kind] ?? "Closed local-v1 proposition.";
      const verdictLabel = (row: (typeof claimState.rows)[number]) => row.verdict === "SUPPORTED"
        ? `SUPPORTED — ${row.kind === "documentation_updated" ? "documentation-convention path change observed" : row.kind === "migration_included" ? "migration-convention path change observed" : row.kind === "dependency_changed" ? "dependency-manifest/lockfile-convention path change observed" : row.kind === "workflow_unchanged" ? "no local-v1 workflow-convention path touched" : row.kind === "production_config_unchanged" ? "no local-v1 production-config-convention path touched" : row.kind === "sensitive_paths_unchanged" ? "no local-v1 policy-sensitive path touched" : row.kind === "tests_added" ? "test-path change observed" : row.kind === "files_changed_only" ? "claimed path set exactly equals the observed v1 comparison set" : "local-v1 proposition supported"}`
        : row.verdict === "CONTRADICTED" ? "CONTRADICTED by the local-v1 path rule" : "NOT PROVABLE";
      const groups = node("section"); groups.append(node("h5", "Claim ledger by verdict"));
      for (const verdict of ["CONTRADICTED", "NOT_PROVABLE", "SUPPORTED"] as const) {
        const rows = claimState.rows.filter((row) => row.verdict === verdict); const disclosure = node("details");
        if (verdict === "CONTRADICTED" && rows.length > 0 && claimState.effectiveRecommendation === "ESCALATE") disclosure.setAttribute("open", "");
        disclosure.append(node("summary", `${verdict} · ${rows.length}`));
        for (const row of rows) {
          const item = node("article"); item.className = "assurance-claim-row";
          item.append(node("strong", verdictLabel(row)), node("p", "Submitted claim (untrusted/display only)"), isolated("Submitted ID: ", row.id), isolated("Submitted kind: ", row.kind));
          if (row.path !== undefined) item.append(isolated("Submitted path: ", row.path));
          if (row.symbol !== undefined) item.append(isolated("Submitted symbol: ", row.symbol));
          for (const path of row.paths ?? []) item.append(isolated("Submitted path: ", path));
          if (row.text !== undefined) item.append(isolated("Submitted prose: ", row.text));
          item.append(node("p", `Evaluated local-v1 proposition: ${proposition(row.kind)}`), node("p", `Trusted verdict: ${row.verdict}`), node("p", `Trusted reason code: ${row.reasonCode}`));
          if (row.kind === "files_changed_only") item.append(isolated("Bounded diagnostic (contains untrusted paths): ", row.detail)); else item.append(node("p", `Trusted caveat: ${row.detail}`));
          disclosure.append(item);
        }
        groups.append(disclosure);
      }
      claimVerification.append(routingEffect, bindingSummary, submitted, groups, node("p", "Claim verification does not prove correctness, safety, test execution, coverage, assertions, relevance, passing status, approval, mergeability, readiness, quality, or deployability."));
      claimFocusTarget = resultHeading;
    }
    const routing = node("section"); const decision = node("strong", result.decision); decision.className = "assurance-decision"; decision.setAttribute("data-decision", result.decision);
    routing.append(node("h3", "Point-in-time ACA routing result"), decision, node("p", result.nextAction), node("p", `Risk tier: ${result.riskTier}`), node("p", `Authority: ${result.authority}`));
    const identity = node("section"); identity.append(node("h3", "Exact local Git binding"), node("p", `Repository: ${repository.displayName} · branch: ${repository.observedBranch}`), node("p", `Candidate: ${repository.candidate.commit.slice(0, 12)} · tree: ${repository.candidate.tree.slice(0, 12)}`), node("p", `Configured base: ${repository.configuredBase.slice(0, 12)} · resolved base: ${repository.resolvedBase.slice(0, 12)}`), node("p", `Diff: ${repository.changedPaths.length} paths · ${repository.diffDigest}`), node("p", `Tracked: ${repository.trackedState} · untracked inventory: ${repository.untrackedCount} paths (${repository.untrackedInventoryDigest.slice(0, 12)})`));
    const fullIds = node("details"); fullIds.append(node("summary", "Full object identifiers"), node("code", `candidate ${repository.candidate.commit} · candidate tree ${repository.candidate.tree} · base ${repository.base.commit} · base tree ${repository.base.tree}`)); identity.append(fullIds);
    const findings = node("section"); findings.append(node("h3", "Decisive ACA findings")); const findingList = node("ul"); for (const finding of result.findings) findingList.append(node("li", `${finding.code} · ${finding.subject} · ${finding.detail}`)); findings.append(findingList);
    const bases = node("section"); bases.append(node("h3", "Truth bases"), node("p", `Repository identity: ${envelope.repositoryIdentityBasis}`), node("p", `Submitted claims before packet verification: ${envelope.claimBasis}`), node("p", `Executable evidence: ${envelope.evidenceBasis}`));
    const checks = node("section"); checks.append(node("h3", "Executable checks")); const list = node("ul"); for (const check of envelope.checks) list.append(node("li", `${check.checkId}: ${check.state} · ${check.reason} · ${check.execution.replace("_", " ")}`)); checks.append(list, node("p", "GitHub/CI: NOT OBSERVED BY THIS LOCAL VERIFIER"));
    const boundary = node("p", "Local Git observation and claim-path comparison are not candidate execution, GitHub verification, CI attestation, correctness, safety, approval, mergeability, readiness, quality, deployment safety, or Owner acceptance."); boundary.className = "assurance-boundary";
    const freshness = node("p", "POINT-IN-TIME SNAPSHOT · Repository changes after this response are not monitored. Reobserve before relying on this routing result."); freshness.className = "assurance-boundary";
    const children: HTMLElement[] = [header("CONNECTED_LOCAL · POINT-IN-TIME", "LOCAL_GIT_OBSERVED; exact unreplaced Git objects were observed with the pinned local Git executable. Candidate-controlled code was not executed."), freshness, routing, findings, identity, bases, checks, claimVerification, boundary, ...actions()];
    const claimContradictions = claimState?.valid ? claimState.rows.filter((row) => row.verdict === "CONTRADICTED").map((row) => ({ id: row.id, reasonCode: row.reasonCode })) : [];
    if (result.decision === "ESCALATE" || (claimState?.valid && claimState.effectiveRecommendation === "ESCALATE")) children.push(...handoff(repository.candidate.commit, result.findings, `envelope ${envelope.envelopeDigest}; candidate tree ${repository.candidate.tree}; explicit base ${repository.base.commit}; base tree ${repository.base.tree}; diff ${repository.diffDigest}`, claimContradictions, claimState?.valid === true));
    root.replaceChildren(...children);
    claimFocusTarget?.focus(); claimFocusTarget?.scrollIntoView({ block: "nearest" });
  };

  const renderConnectedV3 = (admission: any, token: number) => {
    if (destroyed || token !== generation) return;
    const envelope = admission.envelope, repository = envelope.repository;
    const heading = node("h2", "EXECUTABLE EVIDENCE · CONNECTED"); heading.setAttribute("tabindex", "-1");
    const qualification = node("section"); qualification.append(node("h3", "Sandbox qualification"), node("p", `QUALIFIED · ${envelope.qualification.policyVersion}`), node("p", `Image ${envelope.qualification.imageId.slice(0, 20)}… · spec ${envelope.qualification.verifierSpecDigest.slice(0, 16)}…`));
    const fullQualification = node("details"); fullQualification.append(node("summary", "Full sandbox binding"), node("code", `image ${envelope.qualification.imageId} · verifier spec ${envelope.qualification.verifierSpecDigest}`)); qualification.append(fullQualification);
    const aggregate = node("section"); aggregate.append(node("h3", "Required check aggregate"), node("p", envelope.aggregate.sentence), node("p", `Authority: ${envelope.authority}`), node("p", `Routing: ${admission.evaluation.decision}`));
    const checks = node("section"); checks.append(node("h3", "Executable checks"));
    for (const receipt of envelope.receipts) {
      const disclosure = node("details"); disclosure.className = "assurance-executable-receipt";
      disclosure.append(node("summary", `${receipt.checkId}: ${receipt.state} · ${receipt.reason} · ${receipt.execution}`), node("p", `Receipt ${receipt.receiptDigest}`));
      for (const command of receipt.commands) {
        const row = node("article"); row.append(node("h4", command.commandId));
        for (const [streamName, stream] of [["stdout", command.stdout], ["stderr", command.stderr]] as const) {
          const facts = node("p", `${streamName}: ${stream.observedBytes} observed bytes · sha256 ${stream.sha256} · truncated ${stream.truncated ? "yes" : "no"}`);
          const preview = node("bdi", stream.preview); preview.setAttribute("dir", "auto"); preview.className = "assurance-untrusted assurance-output-preview";
          row.append(facts, preview);
        }
        disclosure.append(row);
      }
      checks.append(disclosure);
    }
    const binding = node("section"); binding.append(node("h3", "Exact cumulative candidate binding"), node("p", `Snapshot ${repository.snapshotDigest}`), node("p", `Parent ${repository.parentCommit} · tree ${repository.parentTree}`), node("p", `Base ${repository.baseCommit} · tree ${repository.baseTree}`), node("p", `Manifest ${repository.manifestDigest} · diff ${repository.diffDigest}`));
    const warning = node("p", "Candidate code ran only inside the qualified local sandbox. PASS does not prove correctness, coverage, security, safety, approval, readiness, mergeability, deployability, Release Guardian submission, or Owner decision. Local executable evidence is candidate-bound and not independent."); warning.className = "assurance-boundary";
    root.replaceChildren(header("CONNECTED_LOCAL · POINT-IN-TIME", "Qualified local executable evidence for one exact cumulative dirty snapshot."), heading, aggregate, qualification, checks, binding, warning, ...actions());
    heading.focus(); heading.scrollIntoView({ block: "nearest" });
  };

  const renderLoading = (token: number) => {
    const status = node("p", "LOADING · LOCAL VERIFIER CHECKING · prior claim output cleared · prior executable results cleared · sandbox qualification and checks in progress"); status.setAttribute("role", "status");
    const cancel = node("button", "Cancel observation"); cancel.type = "button"; cancel.addEventListener("click", () => { void cancelObservation(token); });
    root.replaceChildren(status, cancel);
  };
  const cancelObservation = async (token: number) => {
    if (!busy || token !== generation) return;
    const cancelledGeneration = ++generation; claimAttempt++; activeAbort?.abort();
    const status = node("p", "CANCELLING · cancellation sent; waiting for sandbox cleanup settlement"); status.setAttribute("role", "status"); root.replaceChildren(status);
    try { await activePromise; } catch { /* settlement is rendered below */ }
    if (destroyed || cancelledGeneration !== generation) return;
    busy = false; activeAbort = undefined; activePromise = undefined;
    const heading = node("h2", "OBSERVATION CANCELLED · INDETERMINATE"); heading.setAttribute("tabindex", "-1");
    const restoredActions = actions(); root.replaceChildren(heading, node("p", "CANCELLED · executable evidence is invalid and no candidate FAIL was produced."), ...restoredActions);
    restoredActions[0]?.focus(); restoredActions[0]?.scrollIntoView({ block: "nearest" });
  };

  const runObservation = async () => {
    if (!options.fetchObservation || busy || destroyed) return;
    const token = ++generation; claimAttempt++; busy = true; activeAbort = new AbortController(); renderLoading(token);
    const operation = (async () => {
      try {
        const raw = await options.fetchObservation?.(activeAbort?.signal); if (destroyed || token !== generation) return;
        let schema: unknown; try { schema = raw && typeof raw === "object" ? Object.getOwnPropertyDescriptor(raw, "schema")?.value : undefined; } catch { schema = undefined; }
        if(schema==="agent-change-assurance/connected-v4"){busy=false;activeAbort=undefined;renderExternalConnectorUnavailable();return;}
        const admission = schema === "agent-change-assurance/connected-v3" ? await admitConnectedV3Observation(raw) : await admitConnectedObservation(raw); if (destroyed || token !== generation) return;
        busy = false; activeAbort = undefined;
        if (admission.valid) { if (schema === "agent-change-assurance/connected-v3") renderConnectedV3(admission, token); else renderConnected(admission as Extract<ConnectedAdmission, { valid: true }>, token); }
        else renderRefused("INVALID_CONNECTED_OBSERVATION");
      } catch (error) {
        if (destroyed || token !== generation) return; busy = false; activeAbort = undefined;
        const candidate = String((error as Error)?.message ?? "LOCAL_VERIFIER_UNAVAILABLE");
        const code = /^(?:BASE_UNRESOLVED|BASE_NOT_ANCESTOR|EMPTY_CHANGE|SOURCE_MOVED|GIT_OBSERVATION_TIMEOUT|REPOSITORY_ROOT_MISMATCH|BUSY)$/.test(candidate) ? candidate : "LOCAL_VERIFIER_UNAVAILABLE";
        renderRefused(code);
      } finally { if (token === generation) { busy = false; activePromise = undefined; } }
    })();
    activePromise = operation;
    await operation;
  };

  if (options.fetchObservation) renderIdle(); else renderStatic();
  return Object.freeze({ render: renderDemo, observe: runObservation, destroy: () => { if (destroyed) return; destroyed = true; activeAbort?.abort(); activeAbort = undefined; invalidateClaims(); busy = false; root.replaceChildren(); } });
}
