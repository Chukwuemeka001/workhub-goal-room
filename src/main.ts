import "./style.css";
import { createGoalRoom, type Receipt } from "./core/goalRoom";
import { createOwnerDecisionController } from "./ownerController";
import { createOwnerViewModel, type OwnerViewModel } from "./ownerView";
import {
  createBoundaryMessage,
  createLifecycleAccessibleLabel,
  createReceiptLabels,
  prepareOwnerIntent,
  prepareRevisionNote,
} from "./ownerUi";
import { installGoalRoomTools } from "./webmcp";
import { formatWebMcpInvocation } from "./webmcpUi";

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element: #${id}`);
  return element as T;
}

const elements = {
  status: requiredElement("room-status"),
  ownerIntentPanel: requiredElement("owner-intent-panel"),
  ownerIntentForm: requiredElement<HTMLFormElement>("owner-intent-form"),
  ownerIntentInput: requiredElement<HTMLTextAreaElement>("owner-intent-input"),
  ownerIntentSubmit: requiredElement<HTMLButtonElement>("owner-intent-submit"),
  ownerIntentDisplay: requiredElement("owner-intent-display"),
  goal: requiredElement("goal-heading"),
  goalContractStatus: requiredElement("goal-contract-status"),
  goalHistory: requiredElement<HTMLOListElement>("goal-history"),
  doneList: requiredElement<HTMLUListElement>("done-list"),
  lifecycleRail: requiredElement<HTMLOListElement>("lifecycle-rail"),
  attention: requiredElement("owner-attention"),
  attentionTitle: requiredElement("attention-title"),
  attentionBody: requiredElement("attention-body"),
  decisionActions: requiredElement("decision-actions"),
  confirm: requiredElement<HTMLButtonElement>("confirm-plan"),
  revise: requiredElement<HTMLButtonElement>("revise-plan"),
  advance: requiredElement<HTMLButtonElement>("advance-demo"),
  acceptGoal: requiredElement<HTMLButtonElement>("accept-goal"),
  nextActor: requiredElement("next-actor"),
  nextAction: requiredElement("next-action-heading"),
  agentBoundary: requiredElement("agent-boundary"),
  planVersion: requiredElement("plan-version"),
  planStatus: requiredElement("plan-status"),
  planSteps: requiredElement<HTMLOListElement>("plan-steps"),
  revisionNote: requiredElement<HTMLQuoteElement>("revision-note"),
  evidenceCard: requiredElement("evidence-card"),
  candidateVersion: requiredElement("candidate-version"),
  candidateDigest: requiredElement<HTMLElement>("candidate-digest"),
  verdictStatus: requiredElement("verdict-status"),
  ruleSet: requiredElement<HTMLElement>("rule-set"),
  findingList: requiredElement<HTMLUListElement>("finding-list"),
  passBoundary: requiredElement("pass-boundary"),
  receiptCount: requiredElement("receipt-count"),
  receiptList: requiredElement<HTMLOListElement>("receipt-list"),
  webmcpStatus: requiredElement("webmcp-status"),
  reset: requiredElement<HTMLButtonElement>("reset-demo"),
  dialog: requiredElement<HTMLDialogElement>("revision-dialog"),
  revisionDialogTitle: requiredElement("revision-dialog-title"),
  revisionDialogCopy: requiredElement("revision-dialog-copy"),
  form: requiredElement<HTMLFormElement>("revision-form"),
  input: requiredElement<HTMLTextAreaElement>("revision-input"),
  cancelRevision: requiredElement<HTMLButtonElement>("cancel-revision"),
};

const room = createGoalRoom({ ownerIntent: null });

const failedCandidate = JSON.stringify({
  publicUrl: "http://example.test/workhub-goal-room",
  demoDurationSeconds: 181,
  verificationCommand: "npm run build",
});
const passingCandidate = JSON.stringify({
  publicUrl: "https://chukwuemeka001.github.io/workhub-goal-room/",
  demoDurationSeconds: 180,
  verificationCommand: "npm test",
});

async function digestText(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function renderReceipts(receipts: Receipt[]) {
  const labels = createReceiptLabels(receipts);
  const labeledReceipts = receipts.map((receipt, index) => ({
    receipt,
    label: labels[index],
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

const findingLabels: Record<string, string> = {
  INVALID_ARTIFACT_JSON: "Artifact must contain valid JSON",
  INVALID_ARTIFACT_SHAPE: "Artifact must use the exact release schema",
  PUBLIC_URL_MUST_BE_HTTPS: "Public URL must use HTTPS",
  DEMO_DURATION_OUT_OF_RANGE: "Demo duration must be between 1 and 180 seconds",
  VERIFICATION_COMMAND_MISMATCH: "Verification command must be exactly npm test",
};

function renderEvidence(view: OwnerViewModel) {
  const evidence = view.evidence;
  elements.evidenceCard.hidden = !evidence.visible;
  if (!evidence.visible) return;

  elements.candidateVersion.textContent = `v${evidence.candidateVersion ?? "—"}`;
  elements.candidateDigest.textContent = evidence.digest ?? "—";
  elements.verdictStatus.textContent = evidence.verdict ?? "WAITING";
  elements.verdictStatus.dataset.verdict = evidence.verdict ?? "WAITING";
  elements.ruleSet.textContent = evidence.ruleSet ?? "Not yet run";
  elements.passBoundary.hidden = evidence.verdict !== "PASS";

  const checks =
    evidence.verdict === "PASS"
      ? [
          "HTTPS public URL passed",
          "Demo duration is within 180 seconds",
          "Verification command is exactly npm test",
        ]
      : evidence.findingCodes.length > 0
        ? evidence.findingCodes.map((code) => findingLabels[code] ?? code)
        : ["Waiting for the deterministic system verifier"];
  elements.findingList.replaceChildren(
    ...checks.map((check) => {
      const item = document.createElement("li");
      item.textContent = check;
      item.dataset.result = evidence.verdict ?? "WAITING";
      return item;
    }),
  );
}

function render(view: OwnerViewModel) {
  elements.status.textContent = view.statusLabel;
  elements.ownerIntentPanel.hidden = !view.actions.setIntent.visible;
  elements.ownerIntentForm.hidden = !view.actions.setIntent.visible;
  elements.ownerIntentDisplay.textContent = view.ownerIntent ?? "No owner intent captured.";
  elements.ownerIntentSubmit.textContent = view.actions.setIntent.label;
  elements.goal.textContent = view.goal || "Goal not yet admitted";
  const activeGoal = view.goalContract.activeGoal;
  elements.goalContractStatus.textContent = activeGoal
    ? `Goal Contract v${activeGoal.version} · ${activeGoal.status.replaceAll("_", " ")}`
    : "No Goal Contract proposed";
  elements.goalContractStatus.dataset.status = activeGoal?.status ?? "WAITING";
  elements.goalHistory.replaceChildren(
    ...view.goalContract.history.map((event) => {
      const item = document.createElement("li");
      const label = document.createElement("strong");
      label.textContent = event.label;
      item.append(label);
      if (event.text) {
        const text = document.createElement("p");
        text.textContent = event.text;
        item.append(text);
      }
      item.dataset.authority = event.authority;
      return item;
    }),
  );
  elements.doneList.replaceChildren(
    ...view.doneLooksLike.map((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      return li;
    }),
  );
  elements.lifecycleRail.replaceChildren(
    ...view.lifecycle.map((stage) => {
      const item = document.createElement("li");
      const marker = document.createElement("span");
      const label = document.createElement("span");
      marker.className = "lifecycle-marker";
      marker.setAttribute("aria-hidden", "true");
      label.textContent = stage.label;
      item.dataset.status = stage.status;
      item.dataset.stage = stage.id;
      item.setAttribute("aria-label", createLifecycleAccessibleLabel(stage));
      if (stage.status === "active") item.setAttribute("aria-current", "step");
      item.append(marker, label);
      return item;
    }),
  );
  elements.attention.dataset.required = String(view.ownerAttention.required);
  elements.attentionTitle.textContent = view.ownerAttention.title;
  elements.attentionBody.textContent = view.ownerAttention.body;

  elements.confirm.textContent = view.actions.confirm.label;
  elements.revise.textContent = view.actions.revise.label;
  elements.advance.textContent = view.actions.demo.label;
  elements.acceptGoal.textContent = view.actions.acceptGoal.label;
  elements.confirm.hidden = !view.actions.confirm.visible;
  elements.revise.hidden = !view.actions.revise.visible;
  elements.advance.hidden = !view.actions.demo.visible;
  elements.acceptGoal.hidden = !view.actions.acceptGoal.visible;
  elements.decisionActions.hidden = !(
    view.actions.confirm.visible ||
    view.actions.revise.visible ||
    view.actions.demo.visible ||
    view.actions.acceptGoal.visible
  );

  elements.nextActor.textContent = view.nextLegalAction.actor.toUpperCase();
  elements.nextActor.dataset.actor = view.nextLegalAction.actor;
  elements.nextAction.textContent = view.nextLegalAction.label;
  elements.agentBoundary.textContent = createBoundaryMessage(view);

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

  renderEvidence(view);
  elements.receiptCount.textContent = String(view.receiptCount);
  renderReceipts(room.getReceipts());
}

const controller = createOwnerDecisionController({ room, render });
controller.render();

elements.ownerIntentInput.addEventListener("input", () =>
  elements.ownerIntentInput.setCustomValidity(""),
);
elements.ownerIntentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.ownerIntentInput.setCustomValidity("");
  if (!elements.ownerIntentForm.reportValidity()) return;
  const prepared = prepareOwnerIntent(elements.ownerIntentInput.value);
  if (!prepared.valid) {
    elements.ownerIntentInput.setCustomValidity(
      "Enter between 1 and 1000 non-whitespace characters.",
    );
    elements.ownerIntentInput.reportValidity();
    elements.ownerIntentInput.focus();
    return;
  }
  await controller.setOwnerIntent(prepared.intent);
});

function setActionButtonsDisabled(disabled: boolean) {
  elements.confirm.disabled = disabled;
  elements.revise.disabled = disabled;
  elements.advance.disabled = disabled;
  elements.acceptGoal.disabled = disabled;
}

async function runDemoAction() {
  const state = room.getState();
  if (state.phase === "PLAN_CONFIRMED") {
    await room.dispatch({
      type: "CLAIM_STEP",
      actor: "agent",
      expectedStateVersion: state.stateVersion,
      idempotencyKey: "demo-claim-artifact",
      planVersion: state.activePlan?.version ?? 0,
      stepId: "artifact",
    });
  } else if (state.phase === "STEP_CLAIMED") {
    await room.dispatch({
      type: "SUBMIT_CANDIDATE",
      actor: "agent",
      expectedStateVersion: state.stateVersion,
      idempotencyKey: "demo-candidate-v1",
      planVersion: state.activeClaim?.planVersion ?? 0,
      stepId: state.activeClaim?.stepId ?? "",
      content: failedCandidate,
      sha256: await digestText(failedCandidate),
    });
  } else if (state.phase === "CANDIDATE_SUBMITTED") {
    await room.verifyActiveCandidate(`demo-verification-v${state.activeCandidate?.version ?? 0}`);
  } else if (state.phase === "VERIFICATION_FAILED") {
    await room.dispatch({
      type: "SUBMIT_CANDIDATE",
      actor: "agent",
      expectedStateVersion: state.stateVersion,
      idempotencyKey: "demo-candidate-v2",
      planVersion: state.activeClaim?.planVersion ?? 0,
      stepId: state.activeClaim?.stepId ?? "",
      content: passingCandidate,
      sha256: await digestText(passingCandidate),
    });
  } else if (state.phase === "VERIFICATION_PASSED") {
    await room.dispatch({
      type: "REQUEST_COMPLETION",
      actor: "agent",
      expectedStateVersion: state.stateVersion,
      idempotencyKey: "demo-request-completion",
      candidateSha256: state.activeCandidate?.sha256 ?? "",
    });
  }
  render(createOwnerViewModel(room.getState(), room.getReceipts()));
}

elements.confirm.addEventListener("click", async () => {
  setActionButtonsDisabled(true);
  try {
    if (room.getState().phase === "GOAL_CONTRACT_PROPOSED") {
      await controller.confirmGoalContract();
    } else {
      await controller.confirmPlan();
    }
  } finally {
    setActionButtonsDisabled(false);
  }
});

elements.revise.addEventListener("click", () => {
  const goalDecision = room.getState().phase === "GOAL_CONTRACT_PROPOSED";
  elements.revisionDialogTitle.textContent = goalDecision
    ? "What should change in this Goal?"
    : "What should change in this Plan?";
  elements.revisionDialogCopy.textContent = goalDecision
    ? "Your note is an owner decision on this exact Goal version. The agent must propose a new immutable version."
    : "Your note is an owner decision on this exact Plan version. The agent must propose a new immutable version.";
  elements.dialog.showModal();
  elements.input.focus();
});

elements.advance.addEventListener("click", async () => {
  setActionButtonsDisabled(true);
  try {
    await runDemoAction();
  } finally {
    setActionButtonsDisabled(false);
  }
});

elements.acceptGoal.addEventListener("click", async () => {
  setActionButtonsDisabled(true);
  try {
    const state = room.getState();
    await room.dispatch({
      type: "ACCEPT_GOAL",
      actor: "owner",
      expectedStateVersion: state.stateVersion,
      idempotencyKey: "demo-owner-acceptance",
      candidateSha256: state.activeCandidate?.sha256 ?? "",
    });
    render(createOwnerViewModel(room.getState(), room.getReceipts()));
  } finally {
    setActionButtonsDisabled(false);
  }
});

elements.cancelRevision.addEventListener("click", () => elements.dialog.close());
elements.input.addEventListener("input", () => elements.input.setCustomValidity(""));

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.input.setCustomValidity("");
  if (!elements.form.reportValidity()) return;
  const prepared = prepareRevisionNote(elements.input.value);
  if (!prepared.valid) {
    elements.input.setCustomValidity("Enter at least 3 non-whitespace characters.");
    elements.input.reportValidity();
    return;
  }
  elements.dialog.close();
  if (room.getState().phase === "GOAL_CONTRACT_PROPOSED") {
    await controller.requestGoalRevision(prepared.note);
  } else {
    await controller.requestRevision(prepared.note);
  }
});

elements.reset.addEventListener("click", () => window.location.reload());

const installation = installGoalRoomTools({
  documentLike: document,
  navigatorLike: navigator,
  room,
  onInvocation: (record) => {
    elements.webmcpStatus.textContent = formatWebMcpInvocation(record);
    elements.webmcpStatus.dataset.outcome =
      record.result.accepted === true ? "accepted" : "refused";
    render(createOwnerViewModel(room.getState(), room.getReceipts()));
  },
});
elements.webmcpStatus.dataset.status = installation.status;
elements.webmcpStatus.textContent =
  installation.status === "registered"
    ? "WebMCP connected"
    : "WebMCP requires a qualifying client";
window.addEventListener("beforeunload", installation.dispose, { once: true });
