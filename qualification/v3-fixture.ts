import "../src/style.css";
import "../src/desktop.css";
import { createDesktopSurface } from "../src/desktopUi";
import { createDesktopView } from "../src/desktopView";
import { createMobileSurface } from "../src/mobileUi";
import { createMobileView } from "../src/mobileView";
import { createOwnerViewModel } from "../src/ownerView";
import { createAcceptanceDialog, type AcceptanceDialogNodes } from "../src/acceptanceDialog";
import {
  V3_HOSTILE_MARKERS,
  V3_STORY_CATALOG,
  getV3QualificationStory,
  type V3StoryId,
} from "./v3-replay";

const query = new URLSearchParams(location.search);
const requestedId = query.get("story") ?? "S14";
if (!V3_STORY_CATALOG.some(({ id }) => id === requestedId)) throw new Error(`UNKNOWN_V3_STORY:${requestedId}`);
const hostileQualification = query.get("hostile") === "1";
const { replay, story } = await getV3QualificationStory(requestedId as V3StoryId, { hostile: hostileQualification });
const state = story.state;
const receipts = story.receipts;
const ownerView = createOwnerViewModel(state, receipts);
const ownerCalls: string[] = [];
const acceptanceDialog = createAcceptanceDialog({
  dialog: document.querySelector<HTMLDialogElement>("#acceptance-dialog")!,
  form: document.querySelector<HTMLFormElement>("#acceptance-form")!,
  cancel: document.querySelector<HTMLButtonElement>("#cancel-acceptance")!,
  confirm: document.querySelector<HTMLButtonElement>("#confirm-acceptance")!,
  title: document.querySelector<HTMLElement>("#acceptance-dialog-title")!,
  candidate: document.querySelector<HTMLElement>("#acceptance-candidate-version")!,
  digest: document.querySelector<HTMLElement>("#acceptance-candidate-digest")!,
  ruleSet: document.querySelector<HTMLElement>("#acceptance-rule-set")!,
  consequence: document.querySelector<HTMLElement>("#acceptance-dialog-consequence")!,
} as unknown as AcceptanceDialogNodes, async () => { ownerCalls.push("confirm-acceptance"); });
const actions = {
  onSetIntent: async () => { ownerCalls.push("set-intent"); },
  onPrimary: async (kind: string) => { ownerCalls.push(`primary:${kind}`); },
  onOpenAcceptance: (binding: Parameters<typeof acceptanceDialog.open>[0]) => {
    ownerCalls.push("open-acceptance");
    acceptanceDialog.open(binding);
  },
  onOpenRevision: (kind: string, version: number) => { ownerCalls.push(`revision:${kind}:v${version}`); },
};

const mobileRoot = document.querySelector<HTMLElement>("#mobile-room")!;
const desktopRoot = document.querySelector<HTMLElement>("#desktop-room")!;
const mobile = createMobileSurface(mobileRoot, actions);
const desktop = createDesktopSurface(desktopRoot, actions);
mobile.render(createMobileView(state, ownerView, receipts));
desktop.setConnection("Qualification fixture: real kernel replay", "registered");
desktop.render(createDesktopView(state, ownerView, receipts));
const requestedTab = query.get("tab");
if (requestedTab && ["goal", "plan", "proof", "activity"].includes(requestedTab)) {
  mobileRoot.querySelector<HTMLButtonElement>(`#mobile-tab-${requestedTab}`)?.click();
  desktopRoot.querySelector<HTMLButtonElement>(`#desktop-tab-${requestedTab}`)?.click();
}

if (story.presentation === "synthetic-test-only-transient") {
  for (const root of [mobileRoot, desktopRoot]) {
    const note = document.createElement("p");
    note.className = "qualification-transient";
    note.textContent = "S09 TEST-ONLY TRANSIENT: verification in progress. Canonical kernel phase remains CANDIDATE_SUBMITTED.";
    root.prepend(note);
  }
}

const isVisible = (node: Element) => {
  const style = getComputedStyle(node);
  return style.display !== "none" && style.visibility !== "hidden" && node.getClientRects().length > 0;
};
const box = (node: Element) => {
  const value = node.getBoundingClientRect();
  return {
    id: (node as HTMLElement).id || null,
    x: value.x,
    y: value.y,
    top: value.top,
    right: value.right,
    bottom: value.bottom,
    left: value.left,
    width: value.width,
    height: value.height,
  };
};

function measurements() {
  const desktopSurface = document.querySelector<HTMLElement>(".desktop-surface")!;
  const mobileDisplay = getComputedStyle(mobileRoot).display;
  const desktopDisplay = getComputedStyle(desktopSurface).display;
  const activeRoot = mobileDisplay === "none" ? desktopRoot : mobileRoot;
  const oppositeRoot = activeRoot === mobileRoot ? desktopSurface : mobileRoot;
  const controls = [...activeRoot.querySelectorAll<HTMLElement>("button,textarea,input,summary")].filter(isVisible);
  const controlBoxes = controls.map(box);
  const selectedTab = activeRoot.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  const panel = activeRoot.querySelector<HTMLElement>('[role="tabpanel"]');
  const dock = activeRoot.querySelector<HTMLElement>(".mobile-action-dock");
  const tabBar = activeRoot.querySelector<HTMLElement>(".mobile-tab-bar");
  const dockBox = dock && isVisible(dock) ? box(dock) : null;
  const tabBox = tabBar && isVisible(tabBar) ? box(tabBar) : null;
  const injectedSelector = "svg,img,[onload],[onerror],[onclick],[autofocus]";
  const toolDisclosure = activeRoot.querySelector<HTMLDetailsElement>(".desktop-tools");
  return {
    story: {
      id: story.id,
      label: story.label,
      kernelPhase: story.kernelPhase,
      presentation: story.presentation,
      stateVersion: state.stateVersion,
      stateDigest: story.stateDigest,
      receiptCount: receipts.length,
      receiptHash: receipts.at(-1)?.hash ?? "GENESIS",
    },
    viewport: {
      width: innerWidth,
      height: innerHeight,
      visualWidth: visualViewport?.width ?? innerWidth,
      visualHeight: visualViewport?.height ?? innerHeight,
      scale: visualViewport?.scale ?? 1,
    },
    roots: {
      active: activeRoot.id,
      activeDisplay: getComputedStyle(activeRoot).display,
      activeRects: activeRoot.getClientRects().length,
      oppositeDisplay: getComputedStyle(oppositeRoot).display,
      oppositeRects: oppositeRoot.getClientRects().length,
      mobileDisplay,
      desktopDisplay,
    },
    overflow: {
      documentX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyX: document.body.scrollWidth - document.body.clientWidth,
      activeX: activeRoot.scrollWidth - activeRoot.clientWidth,
    },
    semantics: {
      mainCount: [...document.querySelectorAll("main")].filter(isVisible).length,
      tablistCount: activeRoot.querySelectorAll('[role="tablist"]').length,
      tabCount: activeRoot.querySelectorAll('[role="tab"]').length,
      selectedTabCount: activeRoot.querySelectorAll('[role="tab"][aria-selected="true"]').length,
      selectedTabId: selectedTab?.id ?? null,
      panelCount: activeRoot.querySelectorAll('[role="tabpanel"]').length,
      panelLabelledBy: panel?.getAttribute("aria-labelledby") ?? null,
    },
    controls: {
      count: controls.length,
      minimumHeight: controlBoxes.length ? Math.min(...controlBoxes.map(({ height }) => height)) : null,
      allHorizontallyReachable: controlBoxes.every(({ left, right }) => left >= -0.5 && right <= innerWidth + 0.5),
      boxes: controlBoxes,
    },
    safeDock: dockBox && tabBox ? {
      dock: dockBox,
      tabs: tabBox,
      overlap: Math.max(0, dockBox.bottom - tabBox.top),
      dockInside: dockBox.left >= -0.5 && dockBox.right <= innerWidth + 0.5 && dockBox.bottom <= innerHeight + 0.5,
      tabsInside: tabBox.left >= -0.5 && tabBox.right <= innerWidth + 0.5 && tabBox.bottom <= innerHeight + 0.5,
    } : null,
    staticTools: toolDisclosure ? {
      open: toolDisclosure.open,
      toolCount: toolDisclosure.querySelectorAll(".desktop-tool-list > li").length,
      interactiveDescendants: toolDisclosure.querySelectorAll("button,input,textarea,select").length,
    } : null,
    focus: selectedTab ? (() => {
      selectedTab.focus();
      const focusStyle = getComputedStyle(selectedTab);
      return {
        activeId: document.activeElement?.id ?? null,
        activeElementMatches: document.activeElement === selectedTab,
        documentHasFocus: document.hasFocus(),
        focusMatches: selectedTab.matches(":focus"),
        focusVisibleMatches: selectedTab.matches(":focus-visible"),
        outlineStyle: focusStyle.outlineStyle,
        outlineWidth: focusStyle.outlineWidth,
        outlineColor: focusStyle.outlineColor,
        boxShadow: focusStyle.boxShadow,
      };
    })() : null,
    hostile: {
      markers: V3_HOSTILE_MARKERS.map((marker) => ({ marker, renderedLiterally: document.body.textContent?.includes(marker) === true })),
      injectedNodeCount: activeRoot.querySelectorAll(injectedSelector).length,
      longestTextWidth: Math.max(0, ...[...activeRoot.querySelectorAll<HTMLElement>("p,li,code,blockquote,h1,h2,h3")].filter(isVisible).map((node) => node.scrollWidth - node.clientWidth)),
    },
    passBoundary: {
      verdict: state.activeVerification?.verdict ?? null,
      completionRequested: state.activeCompletionRequest !== null,
      accepted: state.goalAcceptance !== null,
      failedHistoryRetained: state.verificationHistory.some(({ verdict }) => verdict === "FAIL"),
    },
  };
}

Object.assign(window, {
  __v3Qualification: {
    ready: true,
    measurements,
    story,
    catalog: V3_STORY_CATALOG,
    registrationOrder: replay.registrationOrder,
    finalReceiptHash: replay.finalReceiptHash,
    ownerCalls: () => [...ownerCalls],
    acceptanceBinding: () => acceptanceDialog.binding(),
    selectedTabs: () => ({ desktop: desktop.selectedTab(), mobile: mobile.selectedTab() }),
  },
});
