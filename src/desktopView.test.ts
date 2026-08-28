/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { createDesktopCheckpoints, digest, passContent } from "../qa/desktop-checkpoints";
import { createDesktopView } from "./desktopView";
import { createOwnerViewModel } from "./ownerView";

const project = (snapshot: Awaited<ReturnType<typeof createDesktopCheckpoints>> extends Map<string, infer S> ? S : never) =>
  createDesktopView(snapshot.state, createOwnerViewModel(snapshot.state, snapshot.receipts), snapshot.receipts);

describe("pure desktop Mission Room projection", () => {
  it("exhaustively derives chapter, current node, exact actor/frontier, owner attention, and sole legal owner action", async () => {
    const all = await createDesktopCheckpoints();
    const expected = {
      empty: ["Define", "intent", "owner", "Owner must set initial intent", true, "set-intent"],
      captured: ["Define", "goal", "agent", "Agent must propose Goal Contract v1", false, "revise-intent"],
      goal: ["Define", "goal", "owner", "Owner must confirm or request Goal revision", true, "confirm-goal"],
      "goal-revision": ["Define", "goal", "agent", "Agent must propose Goal Contract v2", false, "waiting"],
      "goal-confirmed": ["Plan", "plan", "agent", "Agent must propose Plan v1", false, "waiting"],
      plan: ["Plan", "plan", "owner", "Owner must confirm or request revision", true, "confirm-plan"],
      "plan-revision": ["Plan", "plan", "agent", "Agent must propose revised Plan v2", false, "waiting"],
      "plan-confirmed": ["Work", "work", "agent", "Agent may claim the next admitted step", false, "waiting"],
      claimed: ["Work", "work", "agent", "Agent must submit exact candidate evidence", false, "waiting"],
      candidate: ["Verify", "verify", "system", "System must verify this exact candidate", false, "waiting"],
      fail: ["Verify", "work", "agent", "Agent must submit a corrected candidate", false, "waiting"],
      pass: ["Verify", "accept", "agent", "Agent may request completion for this exact candidate", false, "waiting"],
      completion: ["Accept", "accept", "owner", "Owner may accept this exact verified candidate", true, "accept-goal"],
      accepted: ["Accept", "accepted", "owner", "No further governed action", false, "terminal"],
    } as const;
    for (const [name, tuple] of Object.entries(expected)) {
      const view = project(all.get(name)!);
      expect([view.chapter.label, view.chapter.currentNode, view.now.actor, view.now.legalAction, view.now.ownerAttention, view.ownerAction.kind], name).toEqual(tuple);
      expect(view.ownerAction.visible).toBe(["set-intent", "revise-intent", "confirm-goal", "confirm-plan", "accept-goal"].includes(tuple[5]));
    }
    expect(project(all.get("accepted")!).chapter.nodes.every((node) => node.status === "complete")).toBe(true);
  });

  it("derives compact Goal identity, inspector documents, digest, lifecycle, and receipt summaries without conversation", async () => {
    const all = await createDesktopCheckpoints();
    const goal = project(all.get("goal")!);
    expect(goal.goal).toMatchObject({ title: expect.stringContaining("<img"), version: 1, status: "PROPOSED", origin: "Agent proposal awaiting Owner" });
    expect(goal.tabs.map((tab) => [tab.id, tab.label])).toEqual([["goal", "Goal"], ["plan", "Plan"], ["proof", "Proof"], ["activity", "Activity"]]);
    expect(goal.inspectors.goal.groups.map((group) => group.heading)).toEqual(["Why", "Done looks like", "Constraints", "Non-goals", "Evidence required", "Open questions"]);
    expect(goal.inspectors).not.toHaveProperty("discussion");
    const completion = project(all.get("completion")!);
    expect(completion.goal).toMatchObject({ title: "Publish the corrected verified entry", version: 2, status: "CONFIRMED", origin: "Agent proposal confirmed by Owner" });
    expect(completion.inspectors.plan).toMatchObject({ title: "Plan v2", status: "CONFIRMED", binding: "Goal Contract v2" });
    expect(completion.inspectors.proof).toMatchObject({ title: "Candidate v2", verdict: "PASS", digest: digest(passContent), passIsNotAcceptance: true });
    expect(completion.now.compactDigest).toBe(`${digest(passContent).slice(0, 10)}…${digest(passContent).slice(-8)}`);
    expect(completion.lifecycle.filter((node) => node.status === "complete")).toHaveLength(5);
    expect(completion.receipts).toMatchObject({ count: all.get("completion")!.receipts.length, latest: expect.arrayContaining([expect.objectContaining({ source: "WebMCP agent" })]) });
    expect(JSON.stringify(completion)).not.toContain('"conversation"');
    expect(completion.custody).toMatchObject({ phase: "COMPLETION_REQUESTED", currentActor: "owner", ownerAttention: true });
    expect(completion.toolSurface.tools.map((tool) => tool.name)).toEqual([
      "get_goal_room_state", "propose_goal_contract", "propose_plan", "claim_step", "submit_artifact", "request_completion",
    ]);
    expect(completion.toolSurface).toMatchObject({ interactive: false, expandedByDefault: false });
  });

  it("keeps failed candidate history append-only after a later PASS", async () => {
    const all = await createDesktopCheckpoints();
    const passed = project(all.get("pass")!);
    expect(passed.inspectors.proof.history).toEqual([
      expect.objectContaining({ version: 1, verdict: "FAIL" }),
      expect.objectContaining({ version: 2, verdict: "PASS" }),
    ]);
  });
});
