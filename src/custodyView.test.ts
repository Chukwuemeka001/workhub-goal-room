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
    expect(passed.verification).toMatchObject({ verdict: "PASS", ruleSet: "workhub_goal_room_release/v2" });
    expect(passed.releaseCustody).toBeNull();

    const completion = createCustodyView(all.get("completion")!.state, all.get("completion")!.receipts);
    expect(completion.currentActor).toBe("owner");
    expect(completion.ownerAttention).toBe(true);
    expect(completion.candidate).toMatchObject({ version: 2, completionBound: true });
    expect(completion.releaseCustody).toMatchObject({
      profile: "release_guardian/v2",
      sourceBaseCommit: "089745dd595934147dcad71ece28097346b709c5",
      candidateManifestSha256: "96d1dc3f7678fcb3159c7d8eb963f199633145579e14adfa51fee64e9b0989c2",
      proofManifestSha256: "a9a9aac7896a3583a0db78ec5e801e906f0872659e1bf6d36922d091b4294c66",
      rollbackPatchSha256: "c78bacab6f06855426deea32ce900323aaba25761ae8133cb99d1e3b738770d4",
    });
    expect(completion.lanes.find((lane) => lane.actor === "owner")).toMatchObject({ current: true, status: "active" });
  });

  it("preserves failed-candidate custody evidence and seals the terminal room", async () => {
    const all = await createDesktopCheckpoints();
    const failed = createCustodyView(all.get("fail")!.state, all.get("fail")!.receipts);
    expect(failed.currentActor).toBe("agent");
    expect(failed.verification).toMatchObject({ verdict: "FAIL" });
    expect(failed.lanes.find((lane) => lane.actor === "system")).toMatchObject({ current: false, status: "failed" });
    expect(failed.releaseCustody).toBeNull();

    const accepted = createCustodyView(all.get("accepted")!.state, all.get("accepted")!.receipts);
    expect(accepted).toMatchObject({ terminal: true, sealed: true, ownerAttention: false, currentActor: null });
    expect(accepted.candidate).toMatchObject({ completionBound: true, acceptanceBound: true });
    expect(accepted.releaseCustody).not.toBeNull();
    expect(accepted.lanes.every((lane) => lane.current === false)).toBe(true);
  });

  it("omits authoritative release identities for stale, v1, malformed, or forged bindings", async () => {
    const all = await createDesktopCheckpoints();
    const canonical = all.get("completion")!;
    const variants = [
      { ...canonical.state, phase: "VERIFICATION_PASSED" as const, activeCompletionRequest: null },
      {
        ...canonical.state,
        activeVerification: { ...canonical.state.activeVerification!, verdict: "FAIL" as const },
      },
      {
        ...canonical.state,
        activeVerification: { ...canonical.state.activeVerification!, ruleSetVersion: 1 as never },
      },
      {
        ...canonical.state,
        activeCompletionRequest: { candidateSha256: "f".repeat(64), requestedBy: "agent" as const },
      },
      {
        ...canonical.state,
        activeCandidate: { ...canonical.state.activeCandidate!, content: `${canonical.state.activeCandidate!.content}\n` },
      },
      {
        ...canonical.state,
        activeCandidate: { ...canonical.state.activeCandidate!, sha256: "f".repeat(64) },
        activeVerification: { ...canonical.state.activeVerification!, candidateSha256: "f".repeat(64) },
        activeCompletionRequest: { candidateSha256: "f".repeat(64), requestedBy: "agent" as const },
      },
    ];

    for (const state of variants) {
      expect(createCustodyView(state, canonical.receipts).releaseCustody).toBeNull();
    }
    expect(createCustodyView(canonical.state, []).releaseCustody).toBeNull();
  });
});
