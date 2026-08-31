import { describe, expect, it, vi } from "vitest";
import {
  AGENT_LAUNCH_PROMPT,
  RELEASE_REVIEW_INTENT,
  copyAgentLaunchPrompt,
  prefillReleaseReviewIntent,
} from "./releaseQuickstart";

describe("Release Guardian quickstart", () => {
  it("prefills the concrete release-review intent without submitting or dispatching authority", () => {
    const input = { value: "", focus: vi.fn(), setCustomValidity: vi.fn() };
    const dispatch = vi.fn();

    prefillReleaseReviewIntent(input);

    expect(input.value).toBe(RELEASE_REVIEW_INTENT);
    expect(input.setCustomValidity).toHaveBeenCalledExactlyOnceWith("");
    expect(input.focus).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
    expect(RELEASE_REVIEW_INTENT).toContain("agent-generated web release");
    expect(RELEASE_REVIEW_INTENT).toContain("explicit acceptance");
  });

  it("copies the bounded agent prompt and reports success without a room mutation seam", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    const result = await copyAgentLaunchPrompt({ writeText });

    expect(result).toBe("copied");
    expect(writeText).toHaveBeenCalledExactlyOnceWith(AGENT_LAUNCH_PROMPT);
    expect(AGENT_LAUNCH_PROMPT).toContain("First read the current Goal Room state");
    expect(AGENT_LAUNCH_PROMPT).toContain("stop whenever Owner action is required");
    expect(AGENT_LAUNCH_PROMPT).toContain("never treat PASS as acceptance");
  });

  it("fails truthfully when clipboard access is unavailable", async () => {
    await expect(copyAgentLaunchPrompt(undefined)).resolves.toBe("unavailable");
    await expect(copyAgentLaunchPrompt({ writeText: vi.fn().mockRejectedValue(new Error("denied")) })).resolves.toBe("unavailable");
  });
});
