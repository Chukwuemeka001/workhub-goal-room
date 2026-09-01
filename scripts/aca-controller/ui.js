const root = document.querySelector("#result");
const lifecycle = document.querySelector("#lifecycle");
const observe = document.querySelector("#observe");
const cancel = document.querySelector("#cancel");
const session = document.body.dataset.session;
let generation = 0;
let active;
const node = (tag, text) => { const value = document.createElement(tag); if (text !== undefined) value.textContent = text; return value; };
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const controllerProjection = value => {
  if (!plain(value) || value.authority !== "NONE") return null;
  const hasExternal=["agent-change-assurance/connected-v4","agent-change-assurance/external-unavailable-v1"].includes(value.schema);
  const local = hasExternal ? value.local : value;
  const external = hasExternal ? value.external : null;
  if (!plain(local) || local.schema !== "agent-change-assurance/connected-v3" || !Array.isArray(local.receipts) || local.receipts.length !== 2 || local.receipts[0]?.checkId !== "unit" || local.receipts[1]?.checkId !== "build") return null;
  if(external){
    const available=value.schema==="agent-change-assurance/connected-v4"&&external.schema==="github-external-observation/v1"&&external.availability==="AVAILABLE"&&["PARENT_COMMIT_ONLY","REMOTE_HEAD_DIFFERS"].includes(external.subject);
    const unavailable=value.schema==="agent-change-assurance/external-unavailable-v1"&&external.availability==="UNAVAILABLE"&&external.subject==="UNKNOWN"&&external.lifecycle==="NOT_OBSERVED"&&external.outcome==="NOT_OBSERVED"&&external.checkRuns?.length===0&&external.statuses?.length===0;
    if(!plain(external)||external.authority!=="NONE"||!Array.isArray(external.checkRuns)||!Array.isArray(external.statuses)||(!available&&!unavailable))return null;
  }
  const passed = local.receipts.filter(receipt => receipt.state === "PASS").length, failed = local.receipts.filter(receipt => receipt.state === "FAIL").length, indeterminate = 2 - passed - failed, completed = passed + failed, completeness = completed === 2 ? "complete" : completed === 1 ? "partial" : "absent";
  return Object.freeze({ schema:value.schema, qualification: local.qualification, receipts: local.receipts, repository: local.repository, external, authority: "NONE", aggregate: Object.freeze({ passed, failed, indeterminate, complete: completed === 2, sentence: `${passed} of 2 required checks passed; ${failed} failed; ${indeterminate} indeterminate; executable evidence is ${completeness}; ${indeterminate ? "missing/indeterminate requirements remain" : "no missing/indeterminate requirements"}.` }) });
};
const headers = () => ({ "Content-Type": "application/json", "X-WorkHub-ACA-Session": session });
const focusMounted = heading => { heading.focus(); heading.scrollIntoView({ block: "nearest" }); };
function renderEnvelope(value) {
  const heading = node("h2", "EXECUTABLE EVIDENCE · CONNECTED"); heading.tabIndex = -1;
  const aggregate = node("section"); aggregate.append(node("h3", "Required check aggregate"), node("p", value.aggregate.sentence), node("p", "Authority: NONE"));
  const qualification = node("section"); qualification.append(node("h3", "Sandbox qualification"), node("p", `QUALIFIED · ${value.qualification.policyVersion}`), node("p", `Image ${value.qualification.imageId.slice(0, 20)}… · spec ${value.qualification.verifierSpecDigest.slice(0, 16)}…`));
  const full = node("details"); full.append(node("summary", "Full sandbox binding"), node("code", `image ${value.qualification.imageId} · verifier spec ${value.qualification.verifierSpecDigest}`)); qualification.append(full);
  const checks = node("section"); checks.append(node("h3", "Executable checks"));
  for (const receipt of value.receipts) {
    const details = node("details"); details.className = "receipt";
    details.append(node("summary", `${receipt.checkId}: ${receipt.state} · ${receipt.reason} · ${receipt.execution}`), node("p", `Receipt ${receipt.receiptDigest}`));
    for (const command of receipt.commands) {
      const article = node("article"); article.append(node("h4", command.commandId));
      for (const [name, stream] of [["stdout", command.stdout], ["stderr", command.stderr]]) {
        article.append(node("p", `${name}: ${stream.observedBytes} observed bytes · sha256 ${stream.sha256} · truncated ${stream.truncated ? "yes" : "no"}`));
        const preview = node("bdi", stream.preview); preview.dir = "auto"; preview.className = "preview"; article.append(preview);
      }
      details.append(article);
    }
    checks.append(details);
  }
  const repository = value.repository;
  const binding = node("section"); binding.append(node("h3", "Exact candidate binding"), node("p", `Snapshot ${repository.snapshotDigest}`), node("p", `Parent ${repository.parentCommit} · tree ${repository.parentTree}`), node("p", `Base ${repository.baseCommit} · tree ${repository.baseTree}`), node("p", `Manifest ${repository.manifestDigest} · diff ${repository.diffDigest}`));
  const externalSections=[];
  if(value.external){
    if(value.external.availability==="UNAVAILABLE"){
      const unavailable=node("section");unavailable.className="external external-unavailable";unavailable.append(node("h3",`External evidence unavailable · ${value.external.reason}`),node("p","Availability: UNAVAILABLE"),node("p","Subject: UNKNOWN"),node("p","Lifecycle: NOT_OBSERVED"),node("p","Outcome: NOT_OBSERVED"),node("p","Authority: NONE"),node("p","No stale or partial external rows are displayed; no candidate FAIL was produced."));externalSections.push(unavailable);
    }else{
    const subjectCopy=value.external.subject==="PARENT_COMMIT_ONLY"?`Remote evidence covers PR head ${value.external.pull.head.sha}; this local dirty snapshot is not represented remotely.`:`Remote evidence covers PR head ${value.external.pull.head.sha}. Remote evidence does not represent the observed local candidate.`;
    const subjectPhrase=value.external.subject==="PARENT_COMMIT_ONLY"?"the PR parent commit; the local dirty snapshot is not represented remotely":"the remote PR head";
    let sentence=value.external.aggregate.total===0?`External observation complete: GitHub returned no admitted check runs or legacy statuses for ${subjectPhrase}; required-check satisfaction is not inferred.`:value.external.aggregate.failed?`External observation complete: ${value.external.aggregate.passed} succeeded; ${value.external.aggregate.failed} failed; ${value.external.aggregate.pending} pending. Failure is recorded external evidence for ${subjectPhrase}, not proof about the local dirty snapshot.`:value.external.aggregate.pending?`External observation complete: ${value.external.aggregate.passed} succeeded; 0 failed; ${value.external.aggregate.pending} pending. Pending records are neither pass nor fail.`:`External observation complete: ${value.external.aggregate.passed} succeeded; 0 failed; 0 pending. These records cover ${subjectPhrase}.`;if(value.external.subject==="REMOTE_HEAD_DIFFERS")sentence+=" Remote evidence does not represent the observed local candidate.";
    const summary=node("section");summary.className="external";summary.append(node("h3","External evidence · GitHub read-only"),node("p",subjectCopy),node("p","Availability: AVAILABLE"),node("p",`Subject: ${value.external.subject}`),node("p",`Lifecycle: ${value.external.lifecycle}`),node("p",`Outcome: ${value.external.outcome}`),node("p",sentence),node("p","Authority: NONE"));
    const checks=node("details");checks.className="external";checks.append(node("summary",`Check runs (${value.external.checkRuns.length})`));for(const row of value.external.checkRuns){const line=node("bdi",`${row.appSlug} · ${row.name} · ${row.status} · ${row.conclusion??"pending"}`);line.dir="auto";checks.append(line)}
    const statuses=node("details");statuses.className="external";statuses.append(node("summary",`Legacy statuses (${value.external.statuses.length})`));for(const row of value.external.statuses){const line=node("bdi",`${row.context} · ${row.creatorLogin} · ${row.state}`);line.dir="auto";statuses.append(line)}
    const coverage=node("details");coverage.className="external";coverage.append(node("summary","Not observed by this tracer"),node("p",value.external.coverage.notObserved.join(" · ")));externalSections.push(summary,checks,statuses,coverage);
    }
  }
  const warning = node("p", "Candidate code ran only inside a qualified local sandbox. PASS does not prove correctness, coverage, security, safety, approval, readiness, mergeability, deployment, Release Guardian submission, or Owner decision. Evidence is candidate-bound and not independent."); warning.className = "warning";
  root.replaceChildren(heading, aggregate, ...externalSections, qualification, checks, binding, warning); observe.textContent = "Reobserve exact local candidate"; focusMounted(heading);
}
function renderUnavailable(code) { const heading = node("h2", "SANDBOX QUALIFICATION · UNAVAILABLE"); heading.tabIndex = -1; root.replaceChildren(heading, node("p", `${code} · No candidate check ran and no executable evidence was produced.`)); lifecycle.textContent = "UNAVAILABLE · Sandbox qualification did not admit execution."; focusMounted(heading); }
observe.addEventListener("click", async () => {
  if (active) return;
  const current = ++generation; active = new AbortController();
  root.replaceChildren(); lifecycle.textContent = "LOADING · Prior claims and executable results cleared; qualification and checks in progress."; observe.disabled = true; cancel.hidden = false;
  try {
    const response = await fetch("/api/observe", { method: "POST", headers: headers(), body: "", signal: active.signal });
    const value = await response.json();
    if (current !== generation) return;
    const projection = controllerProjection(value);
    if (!response.ok) { if (["SANDBOX_UNAVAILABLE","SANDBOX_POLICY_UNAVAILABLE"].includes(value?.code)) { renderUnavailable(value.code); return; } throw new Error("INVALID_CONNECTED_OBSERVATION"); }
    const expected=["agent-change-assurance/connected-v4","agent-change-assurance/external-unavailable-v1"].includes(value.schema)?"connected-v4-exact":"connected-v3-exact";
    if (response.headers.get("x-workhub-aca-admission") !== expected || !projection) throw new Error("INVALID_CONNECTED_OBSERVATION");
    renderEnvelope(projection); lifecycle.textContent = "CONNECTED · Controller-rederived exact sandbox projection admitted.";
  } catch (error) {
    if (current !== generation) return;
    const cancelled = error.name === "AbortError";
    const heading = node("h2", cancelled ? "OBSERVATION CANCELLED · INDETERMINATE" : "LOCAL OBSERVATION · REFUSED"); heading.tabIndex = -1;
    root.replaceChildren(heading, node("p", cancelled ? "CANCELLED · No candidate FAIL was produced." : "Observation evidence is invalid."));
    lifecycle.textContent = cancelled ? "CANCELLED · Executable evidence invalidated; no candidate FAIL was produced." : "REFUSED · Observation was not admitted; no executable result is attached.";
    focusMounted(heading);
  } finally {
    if (current === generation) { active = undefined; observe.disabled = false; cancel.hidden = true; }
  }
});
cancel.addEventListener("click", async () => {
  if (!active) return;
  const current = ++generation; lifecycle.textContent = "CANCELLING · Cancellation sent; waiting for cleanup settlement."; cancel.disabled = true;
  try { await fetch("/api/cancel", { method: "POST", headers: headers(), body: "" }); } finally {
    active.abort(); active = undefined; observe.disabled = false; cancel.disabled = false; cancel.hidden = true;
    if (current === generation) { const heading = node("h2", "OBSERVATION CANCELLED · INDETERMINATE"); heading.tabIndex = -1; root.replaceChildren(heading, node("p", "CANCELLED · Cleanup settled; no candidate FAIL was produced.")); lifecycle.textContent = "CANCELLED · Executable evidence invalidated."; observe.focus(); observe.scrollIntoView({ block: "nearest" }); }
  }
});
