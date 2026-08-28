import "./style.css";
import "./desktop.css";
import { createGoalRoom } from "./core/goalRoom";
import { createOwnerDecisionController } from "./ownerController";
import { createOwnerViewModel, type OwnerViewModel } from "./ownerView";
import { prepareRevisionNote } from "./ownerUi";
import { installGoalRoomTools } from "./webmcp";
import { formatWebMcpInvocation } from "./webmcpUi";
import { createMobileView } from "./mobileView";
import { createMobileSurface } from "./mobileUi";
import { createDesktopView } from "./desktopView";
import { createDesktopSurface } from "./desktopUi";

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
const room = createGoalRoom({ ownerIntent: null });
let controller: ReturnType<typeof createOwnerDecisionController>;
let revisionBinding: { kind: "goal" | "plan"; version: number } | null = null;

function openRevision(kind: "goal" | "plan", version: number) {
  revisionBinding = { kind, version };
  const subject = kind === "goal" ? "Goal Contract" : "Plan";
  revisionDialogTitle.textContent = `Request changes to ${subject} v${version}`;
  revisionDialogCopy.textContent = `This prose is a ${subject} revision request bound to exact ${subject} v${version}. The prior version remains immutable. This does not confirm the ${subject}, admit a Plan, or authorize work. The agent must propose a new immutable version.`;
  dialog.showModal();
  revisionInput.focus();
}

const mobileSurface = createMobileSurface(requiredElement("mobile-room"), {
  onSetIntent: (intent) => controller.setOwnerIntent(intent),
  onPrimary: async (kind) => {
    if (kind === "confirm-goal") await controller.confirmGoalContract();
    else if (kind === "confirm-plan") await controller.confirmPlan();
    else if (kind === "accept-goal") await controller.acceptGoal();
  },
  onOpenRevision: openRevision,
});
const desktopSurface = createDesktopSurface(requiredElement("desktop-room"), {
  onSetIntent: (intent) => controller.setOwnerIntent(intent),
  onPrimary: async (kind) => {
    if (kind === "confirm-goal") await controller.confirmGoalContract();
    else if (kind === "confirm-plan") await controller.confirmPlan();
    else if (kind === "accept-goal") await controller.acceptGoal();
  },
  onOpenRevision: openRevision,
});

function render(view: OwnerViewModel) {
  const state = room.getState();
  const receipts = room.getReceipts();
  mobileSurface.render(createMobileView(state, view, receipts));
  desktopSurface.render(createDesktopView(state, view, receipts));
}
controller = createOwnerDecisionController({ room, render });
controller.render();

cancelRevision.addEventListener("click", () => dialog.close());
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
  revisionInput.value = "";
  revisionBinding = null;
});

const installation = installGoalRoomTools({
  documentLike: document,
  navigatorLike: navigator,
  room,
  onInvocation: (record) => {
    desktopSurface.setConnection(formatWebMcpInvocation(record), record.result.accepted === true ? "accepted" : "refused");
    render(createOwnerViewModel(room.getState(), room.getReceipts()));
  },
});
desktopSurface.setConnection(
  installation.status === "registered" ? "WebMCP connected" : "WebMCP requires a qualifying client",
  installation.status,
);
window.addEventListener("beforeunload", installation.dispose, { once: true });
