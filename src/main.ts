import "./style.css";
import { createGoalRoom, type Receipt } from "./core/goalRoom";
import { createOwnerDecisionController } from "./ownerController";
import type { OwnerViewModel } from "./ownerView";
import { installGoalRoomPing } from "./webmcp";

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element: #${id}`);
  return element as T;
}

const elements = {
  status: requiredElement("room-status"),
  goal: requiredElement("goal-heading"),
  doneList: requiredElement<HTMLUListElement>("done-list"),
  attention: requiredElement("owner-attention"),
  attentionTitle: requiredElement("attention-title"),
  attentionBody: requiredElement("attention-body"),
  decisionActions: requiredElement("decision-actions"),
  confirm: requiredElement<HTMLButtonElement>("confirm-plan"),
  revise: requiredElement<HTMLButtonElement>("revise-plan"),
  nextActor: requiredElement("next-actor"),
  nextAction: requiredElement("next-action-heading"),
  agentBoundary: requiredElement("agent-boundary"),
  planVersion: requiredElement("plan-version"),
  planStatus: requiredElement("plan-status"),
  planSteps: requiredElement<HTMLOListElement>("plan-steps"),
  revisionNote: requiredElement<HTMLQuoteElement>("revision-note"),
  receiptCount: requiredElement("receipt-count"),
  receiptList: requiredElement<HTMLOListElement>("receipt-list"),
  webmcpStatus: requiredElement("webmcp-status"),
  reset: requiredElement<HTMLButtonElement>("reset-demo"),
  dialog: requiredElement<HTMLDialogElement>("revision-dialog"),
  form: requiredElement<HTMLFormElement>("revision-form"),
  input: requiredElement<HTMLTextAreaElement>("revision-input"),
  cancelRevision: requiredElement<HTMLButtonElement>("cancel-revision"),
};

const room = createGoalRoom({
  goal: "Publish a verified WebMCP Challenge entry",
  doneLooksLike: [
    "The public Goal Room works",
    "Deterministic verification passes",
    "The owner explicitly accepts the final result",
  ],
});

await room.dispatch({
  type: "PROPOSE_PLAN",
  actor: "agent",
  expectedStateVersion: 0,
  idempotencyKey: "demo-proposal-v1",
  steps: [
    { id: "metadata", title: "Prepare the release metadata" },
    { id: "artifact", title: "Produce the deterministic demo artifact" },
    { id: "verify", title: "Run the required verification checks" },
    { id: "acceptance", title: "Present the verified result for owner acceptance" },
  ],
});

function commandLabel(receipt: Receipt, proposedPlanVersion?: number): string {
  if (receipt.command.type === "PROPOSE_PLAN") {
    return `Agent proposed Plan v${proposedPlanVersion ?? "?"}`;
  }
  if (receipt.command.type === "CONFIRM_PLAN") {
    return receipt.accepted
      ? `Owner confirmed Plan v${receipt.command.planVersion}`
      : `Plan confirmation refused · ${receipt.reasonCode ?? "unknown"}`;
  }
  return receipt.accepted
    ? `Owner requested revision to Plan v${receipt.command.planVersion}`
    : `Revision request refused · ${receipt.reasonCode ?? "unknown"}`;
}

function renderReceipts(receipts: Receipt[]) {
  let proposedPlanVersion = 0;
  const labeledReceipts = receipts.map((receipt) => ({
    receipt,
    label: commandLabel(
      receipt,
      receipt.command.type === "PROPOSE_PLAN" ? ++proposedPlanVersion : undefined,
    ),
  }));
  elements.receiptList.replaceChildren(
    ...labeledReceipts
      .reverse()
      .map(({ receipt, label: receiptLabel }) => {
        const item = document.createElement("li");
        const label = document.createElement("span");
        const metadata = document.createElement("code");
        label.textContent = receiptLabel;
        metadata.textContent = `R${String(receipt.sequence).padStart(2, "0")} · S${receipt.stateVersion}`;
        item.append(label, metadata);
        item.dataset.accepted = String(receipt.accepted);
        return item;
      }),
  );
}

function render(view: OwnerViewModel) {
  elements.status.textContent = view.statusLabel;
  elements.goal.textContent = view.goal;
  elements.doneList.replaceChildren(
    ...view.doneLooksLike.map((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      return li;
    }),
  );
  elements.attention.dataset.required = String(view.ownerAttention.required);
  elements.attentionTitle.textContent = view.ownerAttention.title;
  elements.attentionBody.textContent = view.ownerAttention.body;
  elements.confirm.textContent = view.actions.confirm.label;
  elements.revise.textContent = view.actions.revise.label;
  elements.decisionActions.hidden =
    !view.actions.confirm.visible && !view.actions.revise.visible;
  elements.confirm.hidden = !view.actions.confirm.visible;
  elements.revise.hidden = !view.actions.revise.visible;
  elements.nextActor.textContent = view.nextLegalAction.actor.toUpperCase();
  elements.nextActor.dataset.actor = view.nextLegalAction.actor;
  elements.nextAction.textContent = view.nextLegalAction.label;
  elements.agentBoundary.textContent =
    view.nextLegalAction.actor === "owner"
      ? "The agent is blocked until you decide."
      : "No owner action is required right now.";
  elements.planVersion.textContent = view.plan ? `v${view.plan.version}` : "";
  elements.planStatus.textContent = view.plan?.status.replaceAll("_", " ") ?? "WAITING";
  elements.planStatus.dataset.status = view.plan?.status ?? "WAITING";
  elements.planSteps.replaceChildren(
    ...(view.plan?.steps ?? []).map((step, index) => {
      const li = document.createElement("li");
      const number = document.createElement("span");
      const title = document.createElement("span");
      number.className = "step-number";
      number.textContent = String(index + 1).padStart(2, "0");
      title.textContent = step.title;
      li.append(number, title);
      return li;
    }),
  );
  elements.revisionNote.hidden = !view.plan?.revisionNote;
  elements.revisionNote.textContent = view.plan?.revisionNote
    ? `Owner note: “${view.plan.revisionNote}”`
    : "";
  elements.receiptCount.textContent = String(view.receiptCount);
  renderReceipts(room.getReceipts());
}

const controller = createOwnerDecisionController({ room, render });
controller.render();

elements.confirm.addEventListener("click", async () => {
  elements.confirm.disabled = true;
  elements.revise.disabled = true;
  try {
    await controller.confirmPlan();
  } finally {
    elements.confirm.disabled = false;
    elements.revise.disabled = false;
  }
});

elements.revise.addEventListener("click", () => {
  elements.dialog.showModal();
  elements.input.focus();
});

elements.cancelRevision.addEventListener("click", () => elements.dialog.close());

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!elements.form.reportValidity()) return;
  const note = elements.input.value.trim();
  elements.dialog.close();
  await controller.requestRevision(note);
});

elements.reset.addEventListener("click", () => window.location.reload());

const installation = installGoalRoomPing({
  documentLike: document,
  navigatorLike: navigator,
  onPing: () => undefined,
});
elements.webmcpStatus.dataset.status = installation.status;
elements.webmcpStatus.textContent =
  installation.status === "registered"
    ? "WebMCP connected"
    : "WebMCP requires a qualifying client";
window.addEventListener("beforeunload", installation.dispose, { once: true });
