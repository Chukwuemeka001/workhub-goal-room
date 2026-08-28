import "../src/style.css";
import { createMobileSurface } from "../src/mobileUi";
import type { MobileView } from "../src/mobileView";

const hostile = "<img src=x onerror=alert(1)>";
const digest = "7bb959aebadc1b0d557990440771bda517f53dfeca69b78f651650c941ffdf27";
const base: MobileView = {
  chapter: "Intent",
  status: "Owner intent captured — Goal not admitted",
  goal: { title: `Publish governed release ${hostile}`, version: null, status: "NOT_ADMITTED", origin: "Owner intent · context only", doneLooksLike: [], constraints: [], nonGoals: [] },
  frontier: { actor: "agent", text: "Agent must propose Goal Contract v1", liveText: "agent: Agent must propose Goal Contract v1", boundary: "Intent is context only. Planning remains blocked until you confirm an exact Goal Contract." },
  ownerAttention: false,
  actionDock: { kind: "revise-intent", primaryLabel: "Revise owner intent", secondaryKind: null, secondaryLabel: null, waitingText: "No owner action is required right now." },
  tabs: [
    { id: "now", label: "Now", panelHeading: "Current frontier" },
    { id: "plan", label: "Plan", panelHeading: "Goal and Plan" },
    { id: "proof", label: "Proof", panelHeading: "Evidence and verification" },
    { id: "activity", label: "Activity", panelHeading: "Origin, decisions, and receipts" },
  ],
  plan: { version: null, goalContractVersion: null, status: "NOT PROPOSED", steps: [] },
  proof: { candidateVersion: null, digest: null, checks: [], findings: [], verdict: "WAITING", passIsNotAcceptance: false, completionCandidateDigest: null, acceptedCandidateDigest: null },
  activity: { origin: [{ kind: "OWNER_INTENT", actor: "owner", authority: "CONTEXT_ONLY", label: "Owner captured intent", text: `literal ${hostile}` }], receipts: [{ sequence: 1, accepted: true, label: "Owner captured intent", source: "Owner" }] },
};
const empty: MobileView = {
  ...structuredClone(base), status: "Owner intent required — Goal not admitted", ownerAttention: true,
  goal: { ...structuredClone(base.goal), title: "Goal not yet admitted" },
  frontier: { actor: "owner", text: "Owner must set initial intent", liveText: "owner: Owner must set initial intent", boundary: "Intent is context only. It cannot admit a Goal, Plan, or work." },
  actionDock: { kind: "set-intent", primaryLabel: "Set owner intent", secondaryKind: null, secondaryLabel: null, waitingText: "Owner intent required" },
};

const goal: MobileView = {
  ...structuredClone(base), chapter: "Goal", status: "Waiting for your Goal decision", ownerAttention: true,
  goal: { title: `Publish verified release ${hostile}`, version: 1, status: "PROPOSED", origin: "Agent proposal awaiting Owner", doneLooksLike: ["Owner accepts exact verified evidence"], constraints: ["Demo under 180 seconds"], nonGoals: ["No hidden shortcuts"] },
  frontier: { actor: "owner", text: "Owner must confirm or request Goal revision", liveText: "owner: Owner must confirm or request Goal revision", boundary: "Planning remains blocked until you confirm this exact Goal or request a revision." },
  actionDock: { kind: "confirm-goal", primaryLabel: "Confirm Goal v1", secondaryKind: "request-goal-revision", secondaryLabel: "Request Goal revision", waitingText: "Owner decision required" },
};
const fail: MobileView = {
  ...structuredClone(goal), chapter: "Proof", status: "Verification failed — correction required", ownerAttention: false,
  goal: { ...structuredClone(goal.goal), status: "CONFIRMED", origin: "Agent proposal confirmed by Owner" },
  frontier: { actor: "agent", text: "Agent must submit a corrected candidate", liveText: "agent: Agent must submit a corrected candidate", boundary: "The failed candidate and verdict remain immutable. The agent may submit a corrected version." },
  actionDock: { kind: "waiting", primaryLabel: null, secondaryKind: null, secondaryLabel: null, waitingText: "No owner action is required. Agent correction is required." },
  plan: { version: 2, goalContractVersion: 1, status: "CONFIRMED", steps: [{ id: "release", title: `Ship ${hostile} exact release` }], revisionDelta: `Keep ${hostile} literal revision note` },
  proof: { candidateVersion: 1, digest, checks: [], findings: ["PUBLIC_URL_MUST_BE_HTTPS", "VERIFICATION_COMMAND_MISMATCH"], verdict: "FAIL", passIsNotAcceptance: false, completionCandidateDigest: null, acceptedCandidateDigest: null },
};
const plan: MobileView = {
  ...structuredClone(goal), chapter: "Plan", status: "Waiting for your Plan decision", ownerAttention: true,
  goal: { ...structuredClone(goal.goal), status: "CONFIRMED", origin: "Agent proposal confirmed by Owner" },
  frontier: { actor: "owner", text: "Owner must confirm or request revision", liveText: "owner: Owner must confirm or request revision", boundary: "Work cannot begin until you confirm this exact Plan or request a revision." },
  actionDock: { kind: "confirm-plan", primaryLabel: "Confirm Plan v1", secondaryKind: "request-plan-revision", secondaryLabel: "Request revision", waitingText: "Owner decision required" },
  plan: { version: 1, goalContractVersion: 1, status: "PROPOSED", steps: [{ id: "release", title: `Ship ${hostile} exact release` }] },
};
const pass: MobileView = {
  ...structuredClone(fail), status: "Verification passed — owner has not accepted the Goal",
  frontier: { actor: "agent", text: "Agent may request completion for this exact candidate", liveText: "agent: Agent may request completion for this exact candidate", boundary: "PASS proves the explicit checks succeeded. It does not grant final acceptance authority." },
  actionDock: { kind: "waiting", primaryLabel: null, secondaryKind: null, secondaryLabel: null, waitingText: "No owner action is required. Agent completion request is required." },
  proof: { candidateVersion: 2, digest, checks: ["HTTPS public URL passed", "Demo duration is within 180 seconds", "Verification command is exactly npm test"], findings: [], verdict: "PASS", passIsNotAcceptance: true, completionCandidateDigest: null, acceptedCandidateDigest: null },
};
const completion: MobileView = {
  ...structuredClone(fail), chapter: "Acceptance", status: "Verified result — awaiting owner acceptance", ownerAttention: true,
  frontier: { actor: "owner", text: "Owner may accept this exact verified candidate", liveText: "owner: Owner may accept this exact verified candidate", boundary: "The candidate passed deterministic checks. Only you can accept the Goal." },
  actionDock: { kind: "accept-goal", primaryLabel: "Accept Goal", secondaryKind: null, secondaryLabel: null, waitingText: "Owner decision required" },
  proof: { candidateVersion: 2, digest, checks: ["HTTPS public URL passed", "Demo duration is within 180 seconds", "Verification command is exactly npm test"], findings: [], verdict: "PASS", passIsNotAcceptance: true, completionCandidateDigest: digest, acceptedCandidateDigest: null },
};
const terminal: MobileView = {
  ...structuredClone(completion), chapter: "Accepted", status: "Goal accepted by owner", ownerAttention: false,
  frontier: { actor: "owner", text: "No further governed action", liveText: "owner: No further governed action", boundary: "The owner accepted the exact candidate that passed deterministic verification." },
  actionDock: { kind: "terminal", primaryLabel: null, secondaryKind: null, secondaryLabel: null, waitingText: "Goal accepted" },
  proof: { ...structuredClone(completion.proof), passIsNotAcceptance: false, acceptedCandidateDigest: digest },
};
const max: MobileView = structuredClone(goal);
max.goal.title = "I".repeat(1000);
max.plan.steps = [{ id: "x", title: "P".repeat(400) }];
max.plan.revisionDelta = "R".repeat(500);
max.proof.digest = "d".repeat(1000);
max.activity.receipts = [{ sequence: 1, accepted: false, label: `REFUSED_${"L".repeat(500)}_${hostile}`, source: "Internal verifier" }];

const name = new URLSearchParams(location.search).get("state") ?? "captured";
const views: Record<string, MobileView> = { empty, captured: base, goal, plan, fail, pass, completion, terminal, max };
const view = views[name] ?? base;
const root = document.querySelector<HTMLElement>("#mobile-room")!;
const dialog = document.querySelector<HTMLDialogElement>("#revision-dialog")!;
const dialogTitle = document.querySelector<HTMLElement>("#revision-dialog-title")!;
const dialogCopy = document.querySelector<HTMLElement>("#revision-dialog-copy")!;
const input = document.querySelector<HTMLTextAreaElement>("#revision-input")!;
const intentCalls: string[] = [];
const surface = createMobileSurface(root, {
  onSetIntent: async (intent) => { intentCalls.push(intent); }, onPrimary: async () => {},
  onOpenRevision: (kind, version) => {
    const subject = kind === "goal" ? "Goal Contract" : "Plan";
    dialogTitle.textContent = `Request changes to ${subject} v${version}`;
    dialogCopy.textContent = `This prose is a ${subject} revision request bound to exact ${subject} v${version}. The prior version remains immutable. This does not confirm the ${subject}, admit a Plan, or authorize work. The agent must propose a new immutable version.`;
    dialog.showModal(); input.focus();
  },
});
surface.render(view);
document.querySelector("#cancel-revision")?.addEventListener("click", () => dialog.close());
if (new URLSearchParams(location.search).get("sheet") === "1") {
  (document.querySelector<HTMLButtonElement>(".mobile-button.secondary"))?.click();
}

function measurements() {
  const controls = [...document.querySelectorAll<HTMLElement>("button, textarea")].filter((node) => {
    const style = getComputedStyle(node); return style.display !== "none" && style.visibility !== "hidden" && node.getClientRects().length > 0;
  });
  const rects = controls.map((node) => ({ label: node.getAttribute("aria-label") || node.textContent?.trim() || node.tagName, ...node.getBoundingClientRect().toJSON() }));
  const dock = document.querySelector<HTMLElement>(".mobile-action-dock")?.getBoundingClientRect();
  const tabs = document.querySelector<HTMLElement>(".mobile-tab-bar")?.getBoundingClientRect();
  const dialogRect = dialog.open ? dialog.getBoundingClientRect() : null;
  return {
    state: name, viewport: { width: innerWidth, height: innerHeight },
    documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
    rootOverflow: root.scrollWidth - root.clientWidth,
    minControlHeight: Math.min(...rects.map((rect) => rect.height)),
    controlsWithinViewport: rects.every((rect) => rect.left >= 0 && rect.right <= innerWidth && rect.top < innerHeight && rect.bottom > 0),
    dockTabCollision: dock && tabs ? Math.max(0, dock.bottom - tabs.top) : null,
    dockInsideViewport: dock ? dock.left >= 0 && dock.right <= innerWidth && dock.bottom <= innerHeight : false,
    tabInsideViewport: tabs ? tabs.left >= 0 && tabs.right <= innerWidth && tabs.bottom <= innerHeight : false,
    dialog: dialogRect ? { top: dialogRect.top, bottom: dialogRect.bottom, inside: dialogRect.top >= 0 && dialogRect.bottom <= innerHeight, focused: document.activeElement === input } : null,
    hostileLiteral: document.body.textContent?.includes(hostile) === true,
    injectedElements: document.querySelectorAll("img, script:not([type=module])").length,
  };
}
(Object.assign(window, { __mobileQa: { measurements, view, selectedTab: () => surface.selectedTab(), intentCalls: () => [...intentCalls] } }));
