/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { createDesktopCheckpoints } from "../qa/desktop-checkpoints";
import { createCustodyView } from "./custodyView";

describe("pure canonical custody projection", () => {
  it("maps every canonical phase to one actor and chapter, with one current lane until terminal sealing", async () => {
    const all = await createDesktopCheckpoints();
    const expected = {
      empty: ["INTENT_DRAFT", "Define", "owner", "OWNER_SET_INTENT"],
      captured: ["INTENT_DRAFT", "Define", "agent", "AGENT_PROPOSE_GOAL_CONTRACT"],
      goal: ["GOAL_CONTRACT_PROPOSED", "Define", "owner", "OWNER_CONFIRM_OR_REVISE_GOAL"],
      "goal-revision": ["GOAL_CONTRACT_REVISION_REQUESTED", "Define", "agent", "AGENT_PROPOSE_REVISED_GOAL_CONTRACT"],
      "goal-confirmed": ["GOAL_CONTRACT_CONFIRMED", "Plan", "agent", "AGENT_PROPOSE_PLAN"],
      plan: ["PLAN_PROPOSED", "Plan", "owner", "OWNER_CONFIRM_OR_REVISE_PLAN"],
      "plan-revision": ["PLAN_REVISION_REQUESTED", "Plan", "agent", "AGENT_PROPOSE_REVISED_PLAN"],
      "plan-confirmed": ["PLAN_CONFIRMED", "Work", "agent", "AGENT_CLAIM_OPEN_STEP"],
      claimed: ["STEP_CLAIMED", "Work", "agent", "AGENT_SUBMIT_CANDIDATE"],
      candidate: ["CANDIDATE_SUBMITTED", "Verify", "system", "SYSTEM_VERIFY_CANDIDATE"],
      fail: ["VERIFICATION_FAILED", "Verify", "agent", "AGENT_SUBMIT_CORRECTED_CANDIDATE"],
      pass: ["VERIFICATION_PASSED", "Verify", "agent", "AGENT_REQUEST_COMPLETION"],
      completion: ["COMPLETION_REQUESTED", "Accept", "owner", "OWNER_ACCEPT_OR_REQUEST_WORK"],
      accepted: ["GOAL_ACCEPTED", "Accept", null, "GOAL_ACCEPTED_NO_FURTHER_ACTION"],
    } as const;

    for (const [name, snapshot] of all) {
      const projection = createCustodyView(snapshot.state, snapshot.receipts);
      expect([
        projection.phase,
        projection.chapter,
        projection.currentActor,
        projection.legalNextAction,
      ], name).toEqual(expected[name as keyof typeof expected]);
      expect(projection.lanes.filter((lane) => lane.current), name).toHaveLength(name === "accepted" ? 0 : 1);
    }
  });

  it("keeps PASS in Agent custody and activates Owner only for an exact completion request", async () => {
    const all = await createDesktopCheckpoints();
    const passed = createCustodyView(all.get("pass")!.state, all.get("pass")!.receipts);
    expect(passed.currentActor).toBe("agent");
    expect(passed.ownerAttention).toBe(false);
    expect(passed.lanes.find((lane) => lane.actor === "owner")).toMatchObject({ current: false, status: "idle" });
    expect(passed.verification).toMatchObject({ verdict: "PASS", ruleSet: "workhub_goal_room_release/v1" });

    const completion = createCustodyView(all.get("completion")!.state, all.get("completion")!.receipts);
    expect(completion.currentActor).toBe("owner");
    expect(completion.ownerAttention).toBe(true);
    expect(completion.candidate).toMatchObject({ version: 2, completionBound: true });
    expect(completion.lanes.find((lane) => lane.actor === "owner")).toMatchObject({ current: true, status: "active" });
  });

  it("preserves failed-candidate custody evidence and seals the terminal room", async () => {
    const all = await createDesktopCheckpoints();
    const failed = createCustodyView(all.get("fail")!.state, all.get("fail")!.receipts);
    expect(failed.currentActor).toBe("agent");
    expect(failed.verification).toMatchObject({ verdict: "FAIL" });
    expect(failed.lanes.find((lane) => lane.actor === "system")).toMatchObject({ current: false, status: "failed" });

    const accepted = createCustodyView(all.get("accepted")!.state, all.get("accepted")!.receipts);
    expect(accepted).toMatchObject({ terminal: true, sealed: true, ownerAttention: false, currentActor: null });
    expect(accepted.candidate).toMatchObject({ completionBound: true, acceptanceBound: true });
    expect(accepted.lanes.every((lane) => lane.current === false)).toBe(true);
  });
});
