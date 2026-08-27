import "./style.css";
import { createPhase0View } from "./phase0View";
import { installGoalRoomPing } from "./webmcp";

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: #${id}`);
  }
  return element;
}

const view = createPhase0View({
  support: requiredElement("webmcp-status"),
  message: requiredElement("last-message"),
  count: requiredElement("invocation-count"),
});

const installation = installGoalRoomPing({
  documentLike: document,
  navigatorLike: navigator,
  onPing: view.recordPing,
});

view.showRegistration(installation.status);
window.addEventListener("beforeunload", installation.dispose, { once: true });
