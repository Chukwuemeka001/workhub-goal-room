export const RELEASE_REVIEW_INTENT =
  "Govern this agent-generated web release. Require an immutable Goal and Plan, deterministic evidence for the exact candidate, and my explicit acceptance before the room seals.";

export const AGENT_LAUNCH_PROMPT =
  "Use the WebMCP tools on this page to help govern an agent-generated web release. First read the current Goal Room state. Take only the next legal Agent action returned by the room. Never act as Owner or System, never treat PASS as acceptance, and stop whenever Owner action is required.";

type IntentInput = { value: string; focus(): void; setCustomValidity(message: string): void };
type ClipboardWriter = { writeText(value: string): Promise<void> };

export function prefillReleaseReviewIntent(input: IntentInput): void {
  input.value = RELEASE_REVIEW_INTENT;
  input.setCustomValidity("");
  input.focus();
}

export async function copyAgentLaunchPrompt(clipboard: ClipboardWriter | undefined): Promise<"copied" | "unavailable"> {
  if (!clipboard) return "unavailable";
  try {
    await clipboard.writeText(AGENT_LAUNCH_PROMPT);
    return "copied";
  } catch {
    return "unavailable";
  }
}
