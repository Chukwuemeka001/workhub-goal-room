import type { MobileView, MobileTabId } from "./mobileView";
import type { AcceptanceBinding } from "./acceptanceDialog";

export type MobileSurfaceActions = {
  onSetIntent(intent: string): Promise<void>;
  onPrimary(kind: MobileView["actionDock"]["kind"]): Promise<void>;
  onOpenAcceptance(binding: AcceptanceBinding): void;
  onOpenRevision(kind: "goal" | "plan", version: number): void;
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

function list(title: string, values: string[]) {
  const section = el("section", "mobile-detail-group");
  section.append(text("h3", title));
  const ul = el("ul");
  for (const value of values.length ? values : ["None recorded"]) ul.append(text("li", value));
  section.append(ul);
  return section;
}

function renderPlan(view: MobileView) {
  const fragment = document.createDocumentFragment();
  fragment.append(
    text("p", view.goal.origin, "mobile-origin"),
    text("p", `Goal Contract ${view.goal.version ? `v${view.goal.version}` : "not admitted"} · ${view.goal.status.replaceAll("_", " ")}`),
    list("Done Looks Like", view.goal.doneLooksLike),
    list("Constraints", view.goal.constraints),
    list("Non-goals", view.goal.nonGoals),
  );
  const plan = el("section", "mobile-detail-group");
  plan.append(text("h3", `Plan ${view.plan.version ? `v${view.plan.version}` : "not proposed"}`));
  plan.append(text("p", `Bound to Goal Contract ${view.plan.goalContractVersion ? `v${view.plan.goalContractVersion}` : "not bound"} · ${view.plan.status.replaceAll("_", " ")}`));
  const steps = el("ol");
  for (const step of view.plan.steps) steps.append(text("li", step.title));
  if (view.plan.steps.length === 0) steps.append(text("li", "No Plan steps admitted"));
  plan.append(steps);
  if (view.plan.revisionDelta) plan.append(text("blockquote", `Revision request: ${view.plan.revisionDelta}`, "mobile-revision-delta"));
  fragment.append(plan);
  return fragment;
}

function renderProof(view: MobileView) {
  const fragment = document.createDocumentFragment();
  const candidate = view.proof.candidateVersion ? `Candidate v${view.proof.candidateVersion}` : "No candidate submitted";
  fragment.append(text("h3", `${candidate} · ${view.proof.verdict}`, "mobile-proof-status"));
  if (view.proof.digest) fragment.append(text("code", view.proof.digest, "mobile-digest"));
  fragment.append(list("Deterministic checks", [...view.proof.checks, ...view.proof.findings]));
  if (view.proof.verdict === "FAIL") fragment.append(text("p", "FAIL is immutable. The agent must submit corrected evidence.", "mobile-proof-boundary fail"));
  if (view.proof.passIsNotAcceptance) fragment.append(text("p", "PASS means the explicit checks succeeded. PASS does not accept the Goal.", "mobile-proof-boundary pass"));
  if (view.proof.completionCandidateDigest) fragment.append(text("p", `Completion request bound to ${view.proof.completionCandidateDigest}`));
  if (view.proof.acceptedCandidateDigest) fragment.append(text("p", `Owner acceptance bound to ${view.proof.acceptedCandidateDigest}`));
  if (view.proof.history.length) {
    const history = el("ol", "mobile-candidate-history");
    for (const entry of view.proof.history) {
      const item = el("li"); item.dataset.verdict = entry.verdict;
      item.append(text("strong", `Candidate v${entry.version} ${entry.verdict}`), text("code", entry.digest));
      history.append(item);
    }
    fragment.append(text("h3", "Candidate history"), history);
  }
  return fragment;
}

function renderActivity(view: MobileView) {
  const fragment = document.createDocumentFragment();
  const origin = el("ol", "mobile-activity-list");
  for (const event of view.activity.origin) {
    const item = el("li");
    item.append(text("strong", event.label), text("span", event.actor === "owner" ? "Owner" : "WebMCP agent", "mobile-source"));
    if (event.text) item.append(text("p", event.text));
    origin.append(item);
  }
  fragment.append(text("h3", "Origin & decisions"), origin, text("h3", "Accepted and refused receipts"));
  const receipts = el("ol", "mobile-activity-list");
  for (const receipt of view.activity.receipts) {
    const item = el("li");
    item.dataset.accepted = String(receipt.accepted);
    item.append(text("strong", receipt.label), text("span", receipt.source, "mobile-source"), text("code", `R${receipt.sequence}`));
    receipts.append(item);
  }
  if (view.activity.receipts.length === 0) receipts.append(text("li", "No command receipts recorded"));
  fragment.append(receipts);
  return fragment;
}

export function createMobileSurface(
  root: HTMLElement,
  actions: MobileSurfaceActions,
): { render(view: MobileView): void; selectedTab(): MobileTabId } {
  let activeTab: MobileTabId = "goal";
  let currentView: MobileView | null = null;
  const onSelectTab = (id: MobileTabId) => {
    activeTab = id;
    if (currentView) render(currentView);
    root.querySelector<HTMLElement>(`#mobile-tab-${id}`)?.focus();
  };

  function render(view: MobileView) {
    currentView = view;
    const header = el("header", "mobile-goal-header");
    header.setAttribute("aria-label", "Goal status");
    const goalTitle = text("h1", view.goal.title, "mobile-goal-title");
    const goalMeta = text("p", `${view.goal.version ? `Goal v${view.goal.version}` : "Pending intent"} · ${view.goal.status.replaceAll("_", " ")}`, "mobile-goal-meta");
    header.append(text("p", "WORKHUB · GOAL ROOM", "mobile-brand"), goalTitle, goalMeta);

    const chapter = el("section", "mobile-chapter");
    chapter.setAttribute("aria-labelledby", "mobile-chapter-heading");
    const chapterHeading = text("h2", `Chapter · ${view.chapter}`, "mobile-chapter-title");
    chapterHeading.id = "mobile-chapter-heading";
    chapter.append(chapterHeading, text("p", view.status, "mobile-status"));

    const frontier = el("article", "mobile-frontier");
    frontier.dataset.actor = view.frontier.actor;
    frontier.dataset.attention = String(view.ownerAttention);
    const frontierHeading = text("h2", view.frontier.text, "mobile-frontier-title");
    frontierHeading.id = "mobile-frontier-heading";
    const live = text("p", view.frontier.liveText, "mobile-frontier-live");
    live.setAttribute("role", "status");
    live.setAttribute("aria-live", "polite");
    live.setAttribute("aria-atomic", "true");
    const authorityLabel = view.frontier.actor === "none"
      ? "ROOM SEALED · NO CURRENT AUTHORITY"
      : `Authority now · ${view.frontier.actor.toUpperCase()}`;
    frontier.append(text("p", authorityLabel, "mobile-actor"), frontierHeading, live, text("p", view.frontier.boundary, "mobile-boundary"));

    const actionDock = el("section", "mobile-action-dock");
    actionDock.setAttribute("aria-label", "Owner action");
    if (view.actionDock.kind === "set-intent" || view.actionDock.kind === "revise-intent") {
      const form = el("form", "mobile-intent-form");
      const label = text("label", "Owner intent");
      const input = el("textarea");
      input.id = "mobile-owner-intent";
      label.htmlFor = input.id;
      input.required = true;
      input.maxLength = 1000;
      input.rows = 2;
      if (view.actionDock.kind === "revise-intent") input.value = view.goal.title;
      const submit = text("button", view.actionDock.primaryLabel ?? "Save intent", "mobile-button primary");
      submit.type = "submit";
      input.addEventListener("input", () => input.setCustomValidity(""));
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        input.setCustomValidity("");
        const intent = input.value.trim();
        if (!intent || intent.length > 1000) { input.setCustomValidity("Enter between 1 and 1000 non-whitespace characters."); input.reportValidity(); return; }
        submit.disabled = true;
        try { await actions.onSetIntent(intent); } finally { submit.disabled = false; }
      });
      form.append(label, input, submit);
      actionDock.append(form);
    } else if (view.actionDock.primaryLabel) {
      if (view.actionDock.secondaryKind) {
        const secondary = text("button", view.actionDock.secondaryLabel ?? "Request revision", "mobile-button secondary");
        secondary.type = "button";
        secondary.addEventListener("click", () => actions.onOpenRevision(view.actionDock.secondaryKind === "request-goal-revision" ? "goal" : "plan", view.actionDock.secondaryKind === "request-goal-revision" ? (view.goal.version ?? 0) : (view.plan.version ?? 0)));
        actionDock.append(secondary);
      }
      const primary = text("button", view.actionDock.primaryLabel, "mobile-button primary");
      primary.type = "button";
      primary.addEventListener("click", async () => {
        if (view.actionDock.kind === "accept-goal" && view.custody.candidate && view.custody.verification?.verdict === "PASS") {
          actions.onOpenAcceptance({ candidateVersion: view.custody.candidate.version, digest: view.custody.candidate.digest, compactDigest: view.custody.candidate.compactDigest, ruleSet: view.custody.verification.ruleSet });
          return;
        }
        primary.disabled = true;
        try { await actions.onPrimary(view.actionDock.kind); } finally { primary.disabled = false; }
      });
      actionDock.append(primary);
    } else {
      const waiting = text("p", view.actionDock.kind === "terminal" ? "Goal accepted. No further governed action." : view.actionDock.waitingText, "mobile-waiting");
      waiting.setAttribute("role", "status");
      actionDock.append(waiting);
    }

    const details = el("section", "mobile-details");
    const tablist = el("div", "mobile-tab-bar");
    tablist.setAttribute("role", "tablist");
    tablist.setAttribute("aria-label", "Goal Room details");
    for (const tab of view.tabs) {
      const button = text("button", tab.label, "mobile-tab");
      button.type = "button";
      button.id = `mobile-tab-${tab.id}`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(activeTab === tab.id));
      button.setAttribute("aria-controls", `mobile-panel-${tab.id}`);
      button.tabIndex = activeTab === tab.id ? 0 : -1;
      button.addEventListener("click", () => onSelectTab(tab.id));
      button.addEventListener("keydown", (event) => {
        if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const index = view.tabs.findIndex((entry) => entry.id === tab.id);
        const nextIndex = event.key === "Home" ? 0
          : event.key === "End" ? view.tabs.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + view.tabs.length) % view.tabs.length;
        onSelectTab(view.tabs[nextIndex].id);
      });
      tablist.append(button);
    }
    const panel = el("section", "mobile-tab-panel");
    panel.id = `mobile-panel-${activeTab}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `mobile-tab-${activeTab}`);
    panel.tabIndex = 0;
    const tab = view.tabs.find((entry) => entry.id === activeTab)!;
    panel.append(text("h2", tab.panelHeading, "mobile-panel-heading"));
    if (activeTab === "goal") panel.append(text("p", view.goal.origin, "mobile-origin"), text("p", `Goal Contract ${view.goal.version ? `v${view.goal.version}` : "not admitted"} · ${view.goal.status.replaceAll("_", " ")}`), list("Done looks like", view.goal.doneLooksLike), list("Constraints", view.goal.constraints), list("Non-goals", view.goal.nonGoals));
    if (activeTab === "plan") panel.append(renderPlan(view));
    if (activeTab === "proof") panel.append(renderProof(view));
    if (activeTab === "activity") panel.append(renderActivity(view));
    details.append(actionDock, tablist, panel);

    root.replaceChildren(header, chapter, frontier, details);
  }

  return { render, selectedTab: () => activeTab };
}
