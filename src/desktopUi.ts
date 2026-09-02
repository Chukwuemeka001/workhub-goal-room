import type { DesktopTabId, DesktopView } from "./desktopView";
import type { AcceptanceBinding } from "./acceptanceDialog";
import { AGENT_LAUNCH_PROMPT, copyAgentLaunchPrompt, prefillReleaseReviewIntent } from "./releaseQuickstart";
import { RELEASE_MATCHED_TUPLE_STATEMENT, RELEASE_VERIFICATION_CLAIM_BOUNDARY } from "./verifier/releaseRules";

export type DesktopSurfaceActions = {
  onSetIntent(intent: string): Promise<void>;
  onPrimary(kind: DesktopView["ownerAction"]["kind"]): Promise<void>;
  onOpenAcceptance(binding: AcceptanceBinding): void;
  onOpenRevision(kind: "goal" | "plan", version: number, trigger: HTMLElement): void;
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className?: string) {
  const node = el(tag, className);
  node.textContent = value;
  return node;
}
function valueList(values: string[], className = "desktop-value-list") {
  const list = el("ul", className);
  for (const value of values.length ? values : ["None recorded"]) list.append(text("li", value));
  return list;
}

export function createDesktopSurface(root: HTMLElement, actions: DesktopSurfaceActions) {
  let activeTab: DesktopTabId = "goal";
  let currentView: DesktopView | null = null;
  let connection = { label: "Checking WebMCP…", status: "checking" };
  const onSelectTab = (id: DesktopTabId) => {
    activeTab = id;
    if (currentView) render(currentView);
    root.querySelector<HTMLElement>(`#desktop-tab-${id}`)?.focus();
  };

  function renderGoal(view: DesktopView) {
    const data = view.inspectors.goal;
    const fragment = document.createDocumentFragment();
    fragment.append(text("h2", data.title, "desktop-panel-heading"), text("p", data.meta, "desktop-inspector-meta"));
    if (data.revisionDelta) fragment.append(text("blockquote", `Latest revision request: ${data.revisionDelta}`, "desktop-revision-delta"));
    for (const group of data.groups) {
      const section = el("section", "desktop-inspector-group");
      section.append(text("h3", group.heading), valueList(group.values));
      fragment.append(section);
    }
    return fragment;
  }
  function renderPlan(view: DesktopView) {
    const data = view.inspectors.plan;
    const fragment = document.createDocumentFragment();
    fragment.append(text("h2", data.title, "desktop-panel-heading"), text("p", `${data.binding} · ${data.status.replaceAll("_", " ")}`, "desktop-inspector-meta"));
    if (data.revisionDelta) fragment.append(text("blockquote", `Latest revision request: ${data.revisionDelta}`, "desktop-revision-delta"));
    fragment.append(valueList(data.steps.map((step) => step.title), "desktop-plan-list"));
    return fragment;
  }
  function renderProof(view: DesktopView) {
    const data = view.inspectors.proof;
    const fragment = document.createDocumentFragment();
    const heading = text("h2", `${data.title} · ${data.verdict}`, "desktop-panel-heading");
    heading.dataset.verdict = data.verdict;
    fragment.append(heading);
    if (data.digest) fragment.append(text("code", data.digest, "desktop-full-digest"));
    if (data.ruleSet) fragment.append(text("p", `Rule set ${data.ruleSet}`, "desktop-inspector-meta"));
    fragment.append(valueList([...data.checks, ...data.findings], "desktop-check-list"));
    if (data.passIsNotAcceptance) fragment.append(text("p", "PASS means the explicit checks succeeded. PASS does not accept the Goal.", "desktop-pass-boundary"));
    if (data.completionBinding) fragment.append(text("p", `Completion request bound to ${data.completionBinding}`, "desktop-binding"));
    if (data.acceptanceBinding) fragment.append(text("p", `Owner acceptance bound to ${data.acceptanceBinding}`, "desktop-binding"));
    const release = view.custody.releaseCustody;
    if (release) {
      fragment.append(text("h3", "Exact release proof custody", "desktop-subheading"));
      const list = el("dl", "desktop-release-custody");
      for (const [label, value] of [
        ["Verifier profile", release.profile],
        ["Source base commit", release.sourceBaseCommit],
        ["Candidate manifest SHA-256", release.candidateManifestSha256],
        ["Proof manifest SHA-256", release.proofManifestSha256],
        ["Rollback patch", release.compactRollbackPatch],
      ] as const) {
        const row = el("div");
        row.append(text("dt", label), text("dd", value));
        list.append(row);
      }
      fragment.append(
        text("p", RELEASE_MATCHED_TUPLE_STATEMENT, "desktop-binding"),
        list,
        text("p", RELEASE_VERIFICATION_CLAIM_BOUNDARY, "desktop-pass-boundary"),
      );
    }
    if (data.history.length) {
      fragment.append(text("h3", "Candidate history", "desktop-subheading"));
      const history = el("ol", "desktop-candidate-history");
      for (const candidate of data.history) {
        const item = el("li");
        item.dataset.verdict = candidate.verdict;
        item.append(text("strong", `Candidate v${candidate.version} ${candidate.verdict}`), text("code", candidate.digest));
        history.append(item);
      }
      fragment.append(history);
    }
    return fragment;
  }
  function renderActivity(view: DesktopView) {
    const data = view.inspectors.activity;
    const fragment = document.createDocumentFragment();
    fragment.append(text("h2", data.title, "desktop-panel-heading"), text("h3", "Origin & decisions", "desktop-subheading"));
    const origin = el("ol", "desktop-activity-list");
    for (const event of data.origin) {
      const item = el("li");
      item.append(text("strong", event.label), text("span", event.actor === "owner" ? "Owner" : "WebMCP agent"));
      if (event.text) item.append(text("p", event.text));
      origin.append(item);
    }
    if (!data.origin.length) origin.append(text("li", "No origin events recorded"));
    fragment.append(origin, text("h3", "Receipts", "desktop-subheading"));
    const receipts = el("ol", "desktop-activity-list");
    for (const receipt of [...data.receipts].reverse()) {
      const item = el("li"); item.dataset.accepted = String(receipt.accepted);
      item.append(text("strong", receipt.label), text("span", receipt.source), text("code", `R${receipt.sequence}`));
      receipts.append(item);
    }
    if (!data.receipts.length) receipts.append(text("li", "No command receipts recorded"));
    fragment.append(receipts);
    return fragment;
  }

  function render(view: DesktopView) {
    currentView = view;
    const goalHeader = el("header", "desktop-goal-header");
    goalHeader.setAttribute("aria-label", "Goal Contract status");
    const brand = el("div", "desktop-brand"); brand.append(text("span", "W", "desktop-mark"), text("span", "WORKHUB · GOAL ROOM"));
    const identity = el("div", "desktop-goal-identity");
    const goalHeading = text("h1", view.goal.title); goalHeading.id = "desktop-goal-title";
    identity.append(text("p", "GOAL CONTRACT", "desktop-label"), goalHeading, text("p", `${view.goal.version ? `v${view.goal.version}` : "not admitted"} · ${view.goal.status.replaceAll("_", " ")} · ${view.goal.origin}`, "desktop-goal-meta"));
    const status = el("div", "desktop-top-status");
    const connectionNode = text("span", connection.label, "desktop-connection"); connectionNode.dataset.status = connection.status;
    const roomStatus = text("span", view.status, "desktop-status"); roomStatus.setAttribute("role", "status"); roomStatus.setAttribute("aria-live", "polite");
    status.append(connectionNode, roomStatus); goalHeader.append(brand, identity, status);

    const now = el("section", "desktop-now"); now.dataset.actor = view.now.actor; now.dataset.attention = String(view.now.ownerAttention); now.setAttribute("aria-labelledby", "desktop-now-heading");
    const nowCopy = el("div", "desktop-now-copy");
    const actor = text("p", view.ownerAction.kind === "terminal" ? "TERMINAL · OWNER ACCEPTED" : `${view.now.actor.toUpperCase()} ACTS NOW`, "desktop-actor");
    const nowTitle = view.ownerAction.kind === "set-intent" ? "A passing agent build is not an authorized release." : view.now.title;
    const nowLegalAction = view.now.legalAction;
    const nowBoundary = view.now.boundary;
    const nowHeading = text("h2", nowTitle); nowHeading.id = "desktop-now-heading";
    nowCopy.append(text("p", view.now.ownerAttention ? "WHAT NEEDS YOU" : "NOW", "desktop-label"), actor, nowHeading, text("p", nowLegalAction, "desktop-legal-action"), text("p", nowBoundary, "desktop-boundary"));
    if (view.now.compactDigest) nowCopy.append(text("code", `Candidate ${view.now.compactDigest}`, "desktop-compact-digest"));
    const owner = el("section", "desktop-owner-action"); owner.setAttribute("aria-label", "Owner action");
    if (view.ownerAction.kind === "set-intent" || view.ownerAction.kind === "revise-intent") {
      const form = el("form", "desktop-intent-form");
      const label = text("label", "Owner intent"); const input = el("textarea"); input.id = "desktop-owner-intent"; label.htmlFor = input.id;
      input.required = true; input.maxLength = 1000; input.rows = 3; if (view.ownerAction.kind === "revise-intent") input.value = view.goal.title;
      const submit = text("button", view.ownerAction.label ?? "Save intent", "desktop-action primary"); submit.type = "submit";
      const quickstart = el("section", "desktop-release-quickstart"); quickstart.setAttribute("aria-label", "Release Guardian quickstart");
      const example = text("button", "Use release-review example", "desktop-action secondary"); example.type = "button";
      example.addEventListener("click", () => prefillReleaseReviewIntent(input));
      const prompt = el("details", "desktop-agent-prompt");
      const copy = text("button", "Copy agent launch prompt", "desktop-action secondary"); copy.type = "button";
      const copyStatus = text("span", "Prompt is also shown below.", "desktop-copy-status"); copyStatus.setAttribute("role", "status"); copyStatus.setAttribute("aria-live", "polite");
      copy.addEventListener("click", async () => {
        const result = await copyAgentLaunchPrompt(navigator.clipboard);
        copyStatus.textContent = result === "copied" ? "Agent launch prompt copied." : "Clipboard unavailable. Select the prompt below.";
      });
      prompt.append(text("summary", "Show bounded agent prompt"), text("code", AGENT_LAUNCH_PROMPT), copy, copyStatus);
      quickstart.append(
        text("p", "RELEASE GUARDIAN QUICKSTART", "desktop-label"),
        text("p", "Agent contributes. System verifies. Owner accepts the exact candidate.", "desktop-quickstart-promise"),
        text("p", "Start with a concrete release-review intent, then hand the bounded prompt to a WebMCP-capable agent.", "desktop-quickstart-audience"),
        example,
        prompt,
      );
      input.addEventListener("input", () => input.setCustomValidity(""));
      form.addEventListener("submit", async (event) => { event.preventDefault(); input.setCustomValidity(""); const intent = input.value.trim(); if (!intent || intent.length > 1000) { input.setCustomValidity("Enter between 1 and 1000 non-whitespace characters."); input.reportValidity(); input.focus(); return; } submit.disabled = true; try { await actions.onSetIntent(intent); } finally { submit.disabled = false; } });
      form.append(label, input, submit); owner.append(quickstart, form);
    } else if (view.ownerAction.visible && view.ownerAction.label) {
      if (view.ownerAction.secondaryKind) {
        const secondary = text("button", view.ownerAction.secondaryLabel ?? "Request revision", "desktop-action secondary"); secondary.type = "button";
        secondary.addEventListener("click", () => actions.onOpenRevision(view.ownerAction.secondaryKind === "request-goal-revision" ? "goal" : "plan", view.ownerAction.secondaryKind === "request-goal-revision" ? (view.goal.version ?? 0) : (view.inspectors.plan.title.match(/\d+$/)?.[0] ? Number(view.inspectors.plan.title.match(/\d+$/)![0]) : 0), secondary));
        owner.append(secondary);
      }
      const primary = text("button", view.ownerAction.label, "desktop-action primary"); primary.type = "button";
      primary.addEventListener("click", async () => {
        if (view.ownerAction.kind === "accept-goal" && view.custody.candidate && view.custody.verification?.verdict === "PASS") {
          actions.onOpenAcceptance({
            candidateVersion: view.custody.candidate.version,
            digest: view.custody.candidate.digest,
            compactDigest: view.custody.candidate.compactDigest,
            ruleSet: view.custody.verification.ruleSet,
            release: view.custody.releaseCustody,
          });
          return;
        }
        primary.disabled = true;
        try { await actions.onPrimary(view.ownerAction.kind); } finally { primary.disabled = false; }
      }); owner.append(primary);
    } else {
      const waiting = text("p", view.ownerAction.kind === "terminal" ? "Goal accepted. No further governed action." : view.ownerAction.waitingText, "desktop-waiting"); waiting.setAttribute("role", "status"); owner.append(waiting);
    }
    now.append(nowCopy, owner);

    const chapter = el("nav", "desktop-chapter"); chapter.setAttribute("aria-label", "Causal Goal chapter");
    chapter.append(text("p", `CHAPTER · ${view.chapter.label}`, "desktop-label")); const rail = el("ol");
    for (const node of view.chapter.nodes) { const item = text("li", node.label); item.dataset.status = node.status; if (node.status === "current" || node.status === "failed") item.setAttribute("aria-current", "step"); rail.append(item); }
    chapter.append(rail);

    const stateBar = el("section", "desktop-state-bar");
    stateBar.setAttribute("aria-label", "Canonical room state and chapter");
    const phase = text("p", `STATE v${view.custody.stateVersion} · ${view.custody.phase.replaceAll("_", " ")}`, "desktop-state-phase");
    phase.setAttribute("role", "status");
    stateBar.append(phase, chapter);

    const custody = el("section", "desktop-custody");
    custody.setAttribute("aria-label", "Current authority custody");
    for (const lane of view.custody.lanes) {
      const laneNode = el("article", "desktop-custody-lane");
      laneNode.dataset.actor = lane.actor;
      laneNode.dataset.status = lane.status;
      if (lane.current) laneNode.setAttribute("aria-current", "true");
      laneNode.append(text("h2", lane.label), text("p", lane.qualifier, "desktop-lane-qualifier"), text("p", lane.current ? "Acts now" : lane.status, "desktop-lane-status"));
      custody.append(laneNode);
    }

    const inspector = el("aside", "desktop-inspector"); inspector.setAttribute("aria-label", "Selected context inspector");
    const tablist = el("div", "desktop-inspector-tabs"); tablist.setAttribute("role", "tablist"); tablist.setAttribute("aria-label", "Goal Room context");
    for (const tab of view.tabs) {
      const button = text("button", tab.label, "desktop-tab"); button.type = "button"; button.id = `desktop-tab-${tab.id}`;
      button.setAttribute("role", "tab"); button.setAttribute("aria-selected", String(activeTab === tab.id)); button.setAttribute("aria-controls", `desktop-panel-${tab.id}`); button.tabIndex = activeTab === tab.id ? 0 : -1;
      button.addEventListener("click", () => onSelectTab(tab.id));
      button.addEventListener("keydown", (event) => { if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return; event.preventDefault(); const index = view.tabs.findIndex((entry) => entry.id === tab.id); const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? view.tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + view.tabs.length) % view.tabs.length; onSelectTab(view.tabs[nextIndex].id); });
      tablist.append(button);
    }
    const panel = el("section", "desktop-inspector-panel"); panel.id = `desktop-panel-${activeTab}`; panel.setAttribute("role", "tabpanel"); panel.setAttribute("aria-labelledby", `desktop-tab-${activeTab}`); panel.tabIndex = 0;
    if (activeTab === "goal") panel.append(renderGoal(view));
    if (activeTab === "plan") panel.append(renderPlan(view));
    if (activeTab === "proof") panel.append(renderProof(view));
    if (activeTab === "activity") panel.append(renderActivity(view));
    inspector.append(tablist, panel);

    const workspace = el("section", "desktop-workspace");
    workspace.append(now, inspector);

    const progressive = el("section", "desktop-progressive"); progressive.setAttribute("aria-label", "Lifecycle and receipt detail");
    const lifecycle = el("details", "desktop-detail"); const lifecycleSummary = text("summary", "Lifecycle · exact governed progress"); const lifecycleList = el("ol", "desktop-lifecycle-list");
    for (const stage of view.lifecycle) { const item = text("li", stage.label); item.dataset.status = stage.status; lifecycleList.append(item); } lifecycle.append(lifecycleSummary, lifecycleList);
    const receipts = el("details", "desktop-detail"); receipts.append(text("summary", `Receipts · ${view.receipts.count} recorded attempts`)); const receiptList = el("ol", "desktop-receipt-list");
    for (const receipt of view.receipts.latest) { const item = el("li"); item.dataset.accepted = String(receipt.accepted); item.append(text("strong", receipt.label), text("span", `${receipt.source} · R${receipt.sequence}`)); receiptList.append(item); } if (!view.receipts.latest.length) receiptList.append(text("li", "No command receipts recorded")); receipts.append(receiptList);
    const tools = el("details", "desktop-detail desktop-tools");
    tools.append(text("summary", "Agent tools · static six"));
    const toolList = el("ol", "desktop-tool-list");
    for (const tool of view.toolSurface.tools) {
      const toolRow = el("li");
      toolRow.dataset.available = String(tool.available);
      toolRow.append(text("code", tool.name), text("span", tool.guidance));
      toolList.append(toolRow);
    }
    tools.append(toolList);
    progressive.append(lifecycle, tools, receipts);

    root.replaceChildren(goalHeader, stateBar, custody, workspace, progressive);
  }

  return {
    render,
    selectedTab: () => activeTab,
    setConnection(label: string, status: string) { connection = { label, status }; if (currentView) render(currentView); },
  };
}
