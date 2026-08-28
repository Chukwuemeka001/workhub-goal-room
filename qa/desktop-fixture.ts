import "../src/style.css";
import "../src/desktop.css";
import { createOwnerViewModel } from "../src/ownerView";
import { createDesktopView } from "../src/desktopView";
import { createDesktopSurface } from "../src/desktopUi";
import { createDesktopCheckpoints } from "./desktop-checkpoints";

const params = new URLSearchParams(location.search);
const name = params.get("state") ?? "goal";
const all = await createDesktopCheckpoints(name === "max" ? "I".repeat(1000) : undefined);
const names: Record<string, string> = { goal: "goal", plan: "plan", fail: "fail", pass: "pass", completion: "completion", accepted: "accepted", max: "captured" };
const snapshot = all.get(names[name] ?? "goal")!;
const view = createDesktopView(snapshot.state, createOwnerViewModel(snapshot.state, snapshot.receipts), snapshot.receipts);
const ownerCalls: string[] = [];
const keyboardEvents: Array<{ key: string; trusted: boolean; defaultPrevented: boolean; targetId: string }> = [];
const root = document.querySelector<HTMLElement>("#desktop-room")!;
const surface = createDesktopSurface(root, {
  onSetIntent: async (intent) => { ownerCalls.push(`intent:${intent}`); },
  onPrimary: async (kind) => { ownerCalls.push(`primary:${kind}`); },
  onOpenRevision: (kind, version) => { ownerCalls.push(`revision:${kind}:${version}`); },
});
surface.setConnection("WebMCP requires a qualifying client", "unsupported");
surface.render(view);
window.addEventListener("keydown", (event) => {
  if (!(event.target instanceof HTMLElement) || event.target.getAttribute("role") !== "tab") return;
  keyboardEvents.push({ key: event.key, trusted: event.isTrusted, defaultPrevented: event.defaultPrevented, targetId: event.target.id });
});

function measurements() {
  const controls = [...document.querySelectorAll<HTMLElement>("button, textarea, summary")].filter((node) => {
    const style = getComputedStyle(node); return style.display !== "none" && style.visibility !== "hidden" && node.getClientRects().length > 0;
  });
  const rects = controls.map((node) => ({ label: node.textContent?.trim() || node.tagName, ...node.getBoundingClientRect().toJSON() }));
  const now = document.querySelector<HTMLElement>(".desktop-now")!.getBoundingClientRect();
  const inspector = document.querySelector<HTMLElement>(".desktop-inspector")!.getBoundingClientRect();
  const progressive = document.querySelector<HTMLElement>(".desktop-progressive")!.getBoundingClientRect();
  const authoritative = [...document.querySelectorAll<HTMLElement>(".desktop-goal-identity,.desktop-now,.desktop-inspector-panel")];
  return {
    state: name,
    viewport: { width: innerWidth, height: innerHeight },
    documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
    rootOverflow: root.scrollWidth - root.clientWidth,
    controlsWithinHorizontalBounds: rects.every((rect) => rect.left >= 0 && rect.right <= innerWidth),
    minControlHeight: Math.min(...rects.map((rect) => rect.height)),
    controlCollisions: rects.filter((rect) => rect.width <= 0 || rect.height <= 0).length,
    frontier: { x: now.x, y: now.y, width: now.width, height: now.height, area: now.width * now.height, aboveFold: now.top >= 0 && now.bottom <= innerHeight },
    inspector: { x: inspector.x, y: inspector.y, width: inspector.width, height: inspector.height, area: inspector.width * inspector.height, visible: inspector.top < innerHeight && inspector.bottom > 0 },
    lifecycleVisible: getComputedStyle(document.querySelector<HTMLElement>(".desktop-progressive")!).display !== "none",
    lifecycleAboveFold: progressive.top < innerHeight,
    frontierDominant: now.width > inspector.width * 1.8 && now.width * now.height > inspector.width * inspector.height,
    desktopVisible: getComputedStyle(document.querySelector<HTMLElement>(".desktop-surface")!).display !== "none",
    mobileHidden: getComputedStyle(document.querySelector<HTMLElement>(".mobile-room")!).display === "none",
    authoritativeWraps: authoritative.every((node) => node.scrollWidth <= node.clientWidth),
    hostileLiteral: document.body.textContent?.includes("<img src=x onerror=alert(1)>") === true || name === "max",
    injectedElements: document.querySelectorAll("img,script:not([type=module])").length,
  };
}
Object.assign(window, { __desktopQa: { measurements, view, selectedTab: () => surface.selectedTab(), ownerCalls: () => [...ownerCalls], keyboardEvents: () => [...keyboardEvents] } });
