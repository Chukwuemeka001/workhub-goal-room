import "../src/style.css";
import "../src/desktop.css";
import { createOwnerViewModel } from "../src/ownerView";
import { createDesktopView } from "../src/desktopView";
import { createMobileView } from "../src/mobileView";
import { createDesktopSurface } from "../src/desktopUi";
import { createMobileSurface } from "../src/mobileUi";
import {
  PHASE8_HOSTILE_MARKERS,
  buildPhase8Authority,
  codePointLength,
  type Phase8Checkpoint,
} from "./phase8-authoritative";

const checkpoint = (new URLSearchParams(location.search).get("state") ?? "goal") as Phase8Checkpoint;
const result = await buildPhase8Authority(checkpoint);
const state = result.room.getState();
const receipts = result.room.getReceipts();
const ownerView = createOwnerViewModel(state, receipts);
const ownerCalls: string[] = [];
const keyboardEvents: Array<{ key: string; trusted: boolean; defaultPrevented: boolean; targetId: string }> = [];

const ownerCallbacks = {
  onSetIntent: async (intent: string) => { ownerCalls.push("set-intent"); await result.owner.setOwnerIntent(intent); },
  onPrimary: async (kind: "confirm-goal" | "confirm-plan" | "accept-goal") => {
    ownerCalls.push(`primary:${kind}`);
    if (kind === "confirm-goal") await result.owner.confirmGoalContract();
    else if (kind === "confirm-plan") await result.owner.confirmPlan();
    else await result.owner.acceptGoal();
  },
  onOpenRevision: (kind: "goal" | "plan", version: number) => {
    ownerCalls.push(`revision:${kind}:${version}`);
    const note = `QA-only real-controller revision for exact ${kind} v${version}`;
    void (kind === "goal" ? result.owner.requestGoalRevision(note) : result.owner.requestRevision(note));
  },
};
const mobileRoot = document.querySelector<HTMLElement>("#mobile-room")!;
const desktopRoot = document.querySelector<HTMLElement>("#desktop-room")!;
const mobile = createMobileSurface(mobileRoot, ownerCallbacks);
const desktop = createDesktopSurface(desktopRoot, ownerCallbacks);
mobile.render(createMobileView(state, ownerView, receipts));
desktop.setConnection("QA-only projection · real kernel/WebMCP/owner controller", "registered");
desktop.render(createDesktopView(state, ownerView, receipts));

window.addEventListener("keydown", (event) => {
  if (!(event.target instanceof HTMLElement) || event.target.getAttribute("role") !== "tab") return;
  keyboardEvents.push({ key: event.key, trusted: event.isTrusted, defaultPrevented: event.defaultPrevented, targetId: event.target.id });
});

const rect = (node: Element) => {
  const value = (node as HTMLElement).getBoundingClientRect();
  return { id: (node as HTMLElement).id || null, label: node.getAttribute("aria-label") || node.textContent?.trim().slice(0, 100) || node.tagName, x: value.x, y: value.y, width: value.width, height: value.height, top: value.top, right: value.right, bottom: value.bottom, left: value.left };
};
const visible = (node: Element) => {
  const style = getComputedStyle(node);
  return style.display !== "none" && style.visibility !== "hidden" && node.getClientRects().length > 0;
};
function sourceLedger() {
  const goal = state.activeGoalContract!;
  const plan = state.activePlan;
  return {
    stateVersion: state.stateVersion,
    phase: state.phase,
    goalContractVersion: goal.version,
    goal: { rawCodePoints: codePointLength(goal.goal), rawUtf16Units: goal.goal.length },
    why: { rawCodePoints: codePointLength(goal.why), rawUtf16Units: goal.why.length },
    lists: Object.fromEntries((["doneLooksLike", "constraints", "nonGoals", "evidenceRequired", "openQuestions"] as const).map((field) => [field, { count: goal[field].length, itemRawCodePoints: goal[field].map(codePointLength), itemRawUtf16Units: goal[field].map((item) => item.length) }])),
    plan: plan ? { version: plan.version, goalContractVersion: plan.goalContractVersion, stepCount: plan.steps.length, idRawCodePoints: plan.steps.map(({ id }) => codePointLength(id)), titleRawCodePoints: plan.steps.map(({ title }) => codePointLength(title)) } : null,
    goalRevision: state.goalContractHistory[0]?.revisionRequest ? { rawCodePoints: codePointLength(state.goalContractHistory[0].revisionRequest.note), boundaryClaim: result.revisionProbe.claim } : null,
    planRevision: state.planHistory[0]?.revisionRequest ? { rawCodePoints: codePointLength(state.planHistory[0].revisionRequest.note), boundaryClaim: result.revisionProbe.claim } : null,
    receipts: receipts.length,
    toolInvocationCount: result.toolInvocations.length,
  };
}
function measurements() {
  const mobileDisplay = getComputedStyle(mobileRoot).display;
  const desktopSurface = document.querySelector<HTMLElement>(".desktop-surface")!;
  const desktopDisplay = getComputedStyle(desktopSurface).display;
  const activeRoot = mobileDisplay !== "none" ? mobileRoot : desktopRoot;
  const oppositeRoot = activeRoot === mobileRoot ? desktopSurface : mobileRoot;
  const controls = [...activeRoot.querySelectorAll<HTMLElement>("button,textarea,input,summary")].filter(visible);
  const controlRects = controls.map(rect);
  const collisions: Array<{ a: string | null; b: string | null }> = [];
  for (let a = 0; a < controlRects.length; a += 1) for (let b = a + 1; b < controlRects.length; b += 1) {
    const first = controlRects[a]; const second = controlRects[b];
    if (Math.min(first.right, second.right) - Math.max(first.left, second.left) > 1 && Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > 1) collisions.push({ a: first.id, b: second.id });
  }
  const scrollContainers = [...activeRoot.querySelectorAll<HTMLElement>("*")].filter((node) => visible(node) && (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1)).map((node) => ({ id: node.id || null, className: node.className, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, maxScrollY: node.scrollHeight - node.clientHeight, maxScrollX: node.scrollWidth - node.clientWidth }));
  const dock = activeRoot.querySelector<HTMLElement>(".mobile-action-dock")?.getBoundingClientRect();
  const tabs = activeRoot.querySelector<HTMLElement>("[role=tablist]")?.getBoundingClientRect();
  const selectedTabs = activeRoot.querySelectorAll('[role="tab"][aria-selected="true"]');
  const panels = activeRoot.querySelectorAll('[role="tabpanel"]');
  const allNodes = document.querySelectorAll("*").length;
  const injectedSelector = "script:not([type=module]),svg,img,[onload],[onerror],[onclick]";
  return {
    qaOnlyProjection: true,
    checkpoint,
    viewport: { width: innerWidth, height: innerHeight },
    document: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight, maxScrollY: document.documentElement.scrollHeight - document.documentElement.clientHeight },
    body: { scrollWidth: document.body.scrollWidth, clientWidth: document.body.clientWidth, overflowX: document.body.scrollWidth - document.body.clientWidth, scrollHeight: document.body.scrollHeight, clientHeight: document.body.clientHeight, maxScrollY: document.body.scrollHeight - document.body.clientHeight },
    roots: { active: activeRoot.id, activeDisplay: getComputedStyle(activeRoot).display, activeRects: activeRoot.getClientRects().length, opposite: oppositeRoot.id, oppositeDisplay: getComputedStyle(oppositeRoot).display, oppositeRects: oppositeRoot.getClientRects().length, mobileDisplay, desktopDisplay },
    semantics: { tablistCount: activeRoot.querySelectorAll('[role="tablist"]').length, tabCount: activeRoot.querySelectorAll('[role="tab"]').length, selectedTabCount: selectedTabs.length, selectedTabId: (selectedTabs[0] as HTMLElement | undefined)?.id ?? null, panelCount: panels.length, panelLabelledBy: panels[0]?.getAttribute("aria-labelledby") ?? null },
    controls: controlRects,
    controlCollisions: collisions,
    controlsHorizontallyReachable: controlRects.every((item) => item.left >= 0 && item.right <= innerWidth),
    minControlHeight: controlRects.length ? Math.min(...controlRects.map(({ height }) => height)) : null,
    scrollContainers,
    maximumContainerScrollY: Math.max(0, ...scrollContainers.map(({ maxScrollY }) => maxScrollY)),
    safeDock: dock && tabs ? { dock: rect(activeRoot.querySelector(".mobile-action-dock")!), tabs: rect(activeRoot.querySelector("[role=tablist]")!), overlap: Math.max(0, dock.bottom - tabs.top), dockInside: dock.left >= 0 && dock.right <= innerWidth && dock.bottom <= innerHeight, tabsInside: tabs.left >= 0 && tabs.right <= innerWidth && tabs.bottom <= innerHeight } : null,
    hostile: { markers: PHASE8_HOSTILE_MARKERS.map((marker) => ({ marker, renderedLiterally: document.body.textContent?.includes(marker) === true })), injectedNodes: document.querySelectorAll(injectedSelector).length, totalDomNodes: allNodes },
    source: sourceLedger(),
  };
}
Object.assign(window, { __phase8Qa: { measurements, sourceLedger, authorityJson: () => JSON.stringify(state), state, ownerCalls: () => [...ownerCalls], keyboardEvents: () => [...keyboardEvents], selectedTabs: () => ({ desktop: desktop.selectedTab(), mobile: mobile.selectedTab() }) } });
