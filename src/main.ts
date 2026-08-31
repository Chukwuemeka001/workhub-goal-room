import "./style.css";
import "./desktop.css";
import { createGoalRoom } from "./core/goalRoom";
import { createOwnerDecisionController } from "./ownerController";
import { createOwnerViewModel, type OwnerViewModel } from "./ownerView";
import { prepareRevisionNote } from "./ownerUi";
import { installGoalRoomTools } from "./webmcp";
import { formatWebMcpInvocation } from "./webmcpUi";
import { createSystemVerifierAdapter } from "./systemVerifierAdapter";
import { createMobileView } from "./mobileView";
import { createMobileSurface } from "./mobileUi";
import { createDesktopView } from "./desktopView";
import { createDesktopSurface } from "./desktopUi";
import { createAcceptanceDialog, type AcceptanceDialogNodes } from "./acceptanceDialog";
import { containRevisionDialogFocus, createRevisionDialogFocusReturn } from "./revisionDialog";

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element: #${id}`);
  return element as T;
}

const dialog = requiredElement<HTMLDialogElement>("revision-dialog");
const revisionDialogTitle = requiredElement("revision-dialog-title");
const revisionDialogCopy = requiredElement("revision-dialog-copy");
const revisionForm = requiredElement<HTMLFormElement>("revision-form");
const revisionInput = requiredElement<HTMLTextAreaElement>("revision-input");
const cancelRevision = requiredElement<HTMLButtonElement>("cancel-revision");
const submitRevision = requiredElement<HTMLButtonElement>("submit-revision");
containRevisionDialogFocus(dialog, revisionInput, submitRevision);
const revisionFocusReturn = createRevisionDialogFocusReturn(dialog);
const acceptanceDialog = createAcceptanceDialog({
  dialog: requiredElement<HTMLDialogElement>("acceptance-dialog"),
  form: requiredElement<HTMLFormElement>("acceptance-form"),
  cancel: requiredElement<HTMLButtonElement>("cancel-acceptance"),
  confirm: requiredElement<HTMLButtonElement>("confirm-acceptance"),
  title: requiredElement("acceptance-dialog-title"),
  candidate: requiredElement("acceptance-candidate-version"),
  digest: requiredElement("acceptance-candidate-digest"),
  ruleSet: requiredElement("acceptance-rule-set"),
  consequence: requiredElement("acceptance-dialog-consequence"),
  releaseGroup: requiredElement("acceptance-release-binding"),
  releaseProfile: requiredElement("acceptance-release-profile"),
  releaseSourceBaseCommit: requiredElement("acceptance-release-source-base"),
  releaseCandidateManifest: requiredElement("acceptance-release-candidate-manifest"),
  releaseProofManifest: requiredElement("acceptance-release-proof-manifest"),
  releaseRollbackPatch: requiredElement("acceptance-release-rollback-patch"),
  releaseConsequence: requiredElement("acceptance-release-consequence"),
} as unknown as AcceptanceDialogNodes, async () => controller.acceptGoal());
const room = createGoalRoom({ ownerIntent: null });
let controller: ReturnType<typeof createOwnerDecisionController>;
let revisionBinding: { kind: "goal" | "plan"; version: number } | null = null;

function openRevision(kind: "goal" | "plan", version: number, trigger: HTMLElement) {
  revisionFocusReturn.capture(trigger);
  revisionBinding = { kind, version };
  const subject = kind === "goal" ? "Goal Contract" : "Plan";
  revisionDialogTitle.textContent = `Request changes to ${subject} v${version}`;
  revisionDialogCopy.textContent = `This prose is a ${subject} revision request bound to exact ${subject} v${version}. The prior version remains immutable. This does not confirm the ${subject}, admit a Plan, or authorize work. The agent must propose a new immutable version.`;
  dialog.showModal();
  revisionInput.focus();
}

function resetRevisionDialog() {
  revisionInput.value = "";
  revisionInput.setCustomValidity("");
  revisionBinding = null;
}

const mobileSurface = createMobileSurface(requiredElement("mobile-room"), {
  onSetIntent: (intent) => controller.setOwnerIntent(intent),
  onPrimary: async (kind) => {
    if (kind === "confirm-goal") await controller.confirmGoalContract();
    else if (kind === "confirm-plan") await controller.confirmPlan();
    else if (kind === "accept-goal") return;
  },
  onOpenAcceptance: (binding) => acceptanceDialog.open(binding),
  onOpenRevision: openRevision,
});
const desktopSurface = createDesktopSurface(requiredElement("desktop-room"), {
  onSetIntent: (intent) => controller.setOwnerIntent(intent),
  onPrimary: async (kind) => {
    if (kind === "confirm-goal") await controller.confirmGoalContract();
    else if (kind === "confirm-plan") await controller.confirmPlan();
    else if (kind === "accept-goal") return;
  },
  onOpenAcceptance: (binding) => acceptanceDialog.open(binding),
  onOpenRevision: openRevision,
});

function render(view: OwnerViewModel) {
  acceptanceDialog.close();
  const state = room.getState();
  const receipts = room.getReceipts();
  mobileSurface.render(createMobileView(state, view, receipts));
  desktopSurface.render(createDesktopView(state, view, receipts));
}
controller = createOwnerDecisionController({ room, render });
controller.render();
const systemVerifier = createSystemVerifierAdapter({
  room,
  onSettled: () => render(createOwnerViewModel(room.getState(), room.getReceipts())),
  onError: () => {
    desktopSurface.setConnection(
      "System verification failed; Candidate remains pending deterministic verification",
      "refused",
    );
    render(createOwnerViewModel(room.getState(), room.getReceipts()));
  },
});

function closeRevisionWithoutMutation(event?: Event) {
  event?.preventDefault();
  dialog.close();
  resetRevisionDialog();
  setTimeout(() => revisionFocusReturn.restore(), 0);
}

cancelRevision.addEventListener("click", closeRevisionWithoutMutation);
dialog.addEventListener("cancel", closeRevisionWithoutMutation);
dialog.addEventListener("close", resetRevisionDialog);
revisionInput.addEventListener("input", () => revisionInput.setCustomValidity(""));
revisionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  revisionInput.setCustomValidity("");
  if (!revisionForm.reportValidity()) return;
  const prepared = prepareRevisionNote(revisionInput.value);
  if (!prepared.valid) {
    revisionInput.setCustomValidity("Enter at least 3 non-whitespace characters.");
    revisionInput.reportValidity();
    revisionInput.focus();
    return;
  }
  if (revisionBinding?.kind === "goal") await controller.requestGoalRevision(prepared.note);
  else if (revisionBinding?.kind === "plan") await controller.requestRevision(prepared.note);
  else throw new Error("OWNER_DECISION_NOT_AVAILABLE");
  dialog.close();
});

const installation = installGoalRoomTools({
  documentLike: document,
  navigatorLike: navigator,
  room,
  onInvocation: (record) => {
    desktopSurface.setConnection(formatWebMcpInvocation(record), record.result.accepted === true ? "accepted" : "refused");
    render(createOwnerViewModel(room.getState(), room.getReceipts()));
    systemVerifier.observe(record);
  },
});
desktopSurface.setConnection(
  installation.status === "registered" ? "WebMCP connected" : "WebMCP requires a qualifying client",
  installation.status,
);
window.addEventListener("beforeunload", installation.dispose, { once: true });
