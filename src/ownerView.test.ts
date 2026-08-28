import { describe, expect, it } from "vitest";
import { createGoalRoom } from "./core/goalRoom";
import { createOwnerViewModel } from "./ownerView";

describe("Goal Room owner view model", () => {
  it("asks the owner for initial intent before exposing the agent frontier", () => {
    const room = createGoalRoom({ ownerIntent: null });

    expect(createOwnerViewModel(room.getState(), room.getReceipts())).toMatchObject({
      ownerIntent: null,
      goal: "",
      statusLabel: "Owner intent required — Goal not admitted",
      ownerAttention: {
        required: true,
        title: "Describe the outcome you want",
      },
      actions: {
        setIntent: { visible: true, label: "Set owner intent" },
        confirm: { visible: false },
        revise: { visible: false },
      },
      nextLegalAction: {
        label: "Owner must set initial intent",
        actor: "owner",
      },
      goalContract: {
        pendingOwnerIntent: null,
        activeGoal: null,
        confirmedGoalVersion: null,
        history: [],
      },
      plan: null,
    });
  });

  it("projects owner intent without implying an admitted Goal", () => {
    const room = createGoalRoom({ ownerIntent: "Build a governed challenge entry." });

    expect(createOwnerViewModel(room.getState(), room.getReceipts())).toMatchObject({
      ownerIntent: "Build a governed challenge entry.",
      goal: "",
      doneLooksLike: [],
      statusLabel: "Owner intent captured — Goal not admitted",
      ownerAttention: {
        required: false,
        title: "Agent must propose a Goal Contract",
      },
      actions: {
        setIntent: { visible: true, label: "Revise owner intent" },
        confirm: { visible: false },
        revise: { visible: false },
      },
      nextLegalAction: {
        label: "Agent must propose Goal Contract v1",
        actor: "agent",
      },
      plan: null,
    });
  });

  it("centers the owner Goal Contract decision before Plan admission", async () => {
    const room = createGoalRoom({ ownerIntent: "Build a governed challenge entry." });
    await room.dispatch({
      type: "PROPOSE_GOAL_CONTRACT", actor: "agent", expectedStateVersion: 0,
      idempotencyKey: "goal-v1",
      goal: "Publish a verified entry", why: "Prove governance",
      doneLooksLike: ["Owner accepts"], constraints: [], nonGoals: [],
      evidenceRequired: ["PASS"], openQuestions: [],
    });

    expect(createOwnerViewModel(room.getState(), room.getReceipts())).toMatchObject({
      statusLabel: "Waiting for your Goal decision",
      ownerAttention: {
        required: true,
        title: "Review Goal Contract v1",
      },
      actions: {
        confirm: { visible: true, label: "Confirm Goal v1" },
        revise: { visible: true, label: "Request Goal revision" },
      },
      nextLegalAction: {
        label: "Owner must confirm or request Goal revision",
        actor: "owner",
      },
      plan: null,
    });
  });

  it("projects a Goal revision request as an agent frontier", async () => {
    const room = createGoalRoom({ ownerIntent: "Build a governed challenge entry." });
    await room.dispatch({
      type: "PROPOSE_GOAL_CONTRACT", actor: "agent", expectedStateVersion: 0,
      idempotencyKey: "goal-v1", goal: "Publish a verified entry", why: "Prove governance",
      doneLooksLike: ["Owner accepts"], constraints: [], nonGoals: [],
      evidenceRequired: ["PASS"], openQuestions: [],
    });
    await room.dispatch({
      type: "REQUEST_GOAL_REVISION", actor: "owner", expectedStateVersion: 1,
      idempotencyKey: "revise-goal", goalContractVersion: 1,
      note: "Make the proof judge-observable.",
    });

    expect(createOwnerViewModel(room.getState(), room.getReceipts())).toMatchObject({
      statusLabel: "Waiting for revised Goal Contract",
      ownerAttention: {
        required: false,
        title: "Goal revision requested",
        body: "The agent must respond with Goal Contract v2 before you decide again.",
      },
      actions: { confirm: { visible: false }, revise: { visible: false } },
      nextLegalAction: { label: "Agent must propose Goal Contract v2", actor: "agent" },
      plan: null,
    });
  });

  it("projects confirmed Goal scope without implying work or acceptance", async () => {
    const room = createGoalRoom({ ownerIntent: "Build a governed challenge entry." });
    await room.dispatch({
      type: "PROPOSE_GOAL_CONTRACT", actor: "agent", expectedStateVersion: 0,
      idempotencyKey: "goal-v1", goal: "Publish a verified entry", why: "Prove governance",
      doneLooksLike: ["Owner accepts"], constraints: [], nonGoals: [],
      evidenceRequired: ["PASS"], openQuestions: [],
    });
    await room.dispatch({
      type: "CONFIRM_GOAL_CONTRACT", actor: "owner", expectedStateVersion: 1,
      idempotencyKey: "confirm-goal", goalContractVersion: 1,
    });

    expect(createOwnerViewModel(room.getState(), room.getReceipts())).toMatchObject({
      statusLabel: "Goal confirmed — Plan required",
      ownerAttention: {
        required: false,
        title: "Goal Contract v1 confirmed",
      },
      actions: { confirm: { visible: false }, revise: { visible: false } },
      nextLegalAction: { label: "Agent must propose Plan v1", actor: "agent" },
      plan: null,
    });
  });

  it("shows only Plan as active before owner confirmation", async () => {
    const room = createGoalRoom({
      goal: "Publish a verified WebMCP Challenge entry",
      doneLooksLike: ["Owner accepts"],
    });
    await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "proposal-lifecycle",
      steps: [{ id: "artifact", title: "Produce exact evidence" }],
    });

    expect(
      createOwnerViewModel(room.getState(), room.getReceipts()).lifecycle,
    ).toEqual([
      { id: "plan", label: "Plan", status: "active" },
      { id: "claim", label: "Claim", status: "pending" },
      { id: "evidence", label: "Evidence", status: "pending" },
      { id: "verify", label: "Verify", status: "pending" },
      { id: "completion", label: "Complete", status: "pending" },
      { id: "acceptance", label: "Accept", status: "pending" },
    ]);
  });

  it("shows digest-bound FAIL then PASS without implying owner acceptance", async () => {
    const room = createGoalRoom({
      goal: "Publish a verified WebMCP Challenge entry",
      doneLooksLike: ["Owner accepts"],
    });
    await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "proposal",
      steps: [{ id: "artifact", title: "Produce the release artifact" }],
    });
    await room.dispatch({
      type: "CONFIRM_PLAN",
      actor: "owner",
      expectedStateVersion: 1,
      idempotencyKey: "confirm",
      planVersion: 1,
    });
    await room.dispatch({
      type: "CLAIM_STEP",
      actor: "agent",
      expectedStateVersion: 2,
      idempotencyKey: "claim",
      planVersion: 1,
      stepId: "artifact",
    });
    expect(createOwnerViewModel(room.getState(), room.getReceipts()).lifecycle).toMatchObject([
      { id: "plan", status: "complete" },
      { id: "claim", status: "complete" },
      { id: "evidence", status: "active" },
      { id: "verify", status: "pending" },
      { id: "completion", status: "pending" },
      { id: "acceptance", status: "pending" },
    ]);
    const digest = async (content: string) => {
      const bytes = new TextEncoder().encode(content);
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(hash)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    };
    const failedContent = JSON.stringify({
      publicUrl: "http://example.test",
      demoDurationSeconds: 181,
      verificationCommand: "npm run build",
    });
    const failedSha = await digest(failedContent);
    await room.dispatch({
      type: "SUBMIT_CANDIDATE",
      actor: "agent",
      expectedStateVersion: 3,
      idempotencyKey: "candidate-v1",
      planVersion: 1,
      stepId: "artifact",
      content: failedContent,
      sha256: failedSha,
    });
    expect(createOwnerViewModel(room.getState(), room.getReceipts()).lifecycle).toMatchObject([
      { id: "plan", status: "complete" },
      { id: "claim", status: "complete" },
      { id: "evidence", status: "complete" },
      { id: "verify", status: "active" },
      { id: "completion", status: "pending" },
      { id: "acceptance", status: "pending" },
    ]);
    await room.verifyActiveCandidate("verify-v1");

    expect(createOwnerViewModel(room.getState(), room.getReceipts())).toMatchObject({
      statusLabel: "Verification failed — correction required",
      ownerAttention: {
        required: false,
        title: "Candidate v1 did not pass",
      },
      actions: {
        demo: { visible: true, label: "Submit corrected Candidate v2" },
        acceptGoal: { visible: false },
      },
      nextLegalAction: {
        label: "Agent must submit a corrected candidate",
        actor: "agent",
      },
      lifecycle: [
        { id: "plan", status: "complete" },
        { id: "claim", status: "complete" },
        { id: "evidence", status: "active" },
        { id: "verify", status: "failed" },
        { id: "completion", status: "pending" },
        { id: "acceptance", status: "pending" },
      ],
      evidence: {
        visible: true,
        candidateVersion: 1,
        digest: failedSha,
        verdict: "FAIL",
        ruleSet: "workhub_goal_room_release/v1",
        findingCodes: [
          "DEMO_DURATION_OUT_OF_RANGE",
          "PUBLIC_URL_MUST_BE_HTTPS",
          "VERIFICATION_COMMAND_MISMATCH",
        ],
      },
    });

    const passedContent = JSON.stringify({
      publicUrl: "https://example.test",
      demoDurationSeconds: 180,
      verificationCommand: "npm test",
    });
    const passedSha = await digest(passedContent);
    await room.dispatch({
      type: "SUBMIT_CANDIDATE",
      actor: "agent",
      expectedStateVersion: 5,
      idempotencyKey: "candidate-v2",
      planVersion: 1,
      stepId: "artifact",
      content: passedContent,
      sha256: passedSha,
    });
    await room.verifyActiveCandidate("verify-v2");

    expect(createOwnerViewModel(room.getState(), room.getReceipts())).toMatchObject({
      statusLabel: "Verification passed — owner has not accepted the Goal",
      ownerAttention: {
        required: false,
        title: "Candidate v2 passed deterministic verification",
      },
      actions: {
        demo: { visible: true, label: "Agent requests completion" },
        acceptGoal: { visible: false },
      },
      nextLegalAction: {
        label: "Agent may request completion for this exact candidate",
        actor: "agent",
      },
      lifecycle: [
        { id: "plan", status: "complete" },
        { id: "claim", status: "complete" },
        { id: "evidence", status: "complete" },
        { id: "verify", status: "complete" },
        { id: "completion", status: "active" },
        { id: "acceptance", status: "pending" },
      ],
      evidence: {
        candidateVersion: 2,
        digest: passedSha,
        verdict: "PASS",
        ruleSet: "workhub_goal_room_release/v1",
        findingCodes: [],
      },
    });

    await room.dispatch({
      type: "REQUEST_COMPLETION",
      actor: "agent",
      expectedStateVersion: 7,
      idempotencyKey: "request-completion",
      candidateSha256: passedSha,
    });
    expect(createOwnerViewModel(room.getState(), room.getReceipts()).lifecycle).toMatchObject([
      { id: "plan", status: "complete" },
      { id: "claim", status: "complete" },
      { id: "evidence", status: "complete" },
      { id: "verify", status: "complete" },
      { id: "completion", status: "complete" },
      { id: "acceptance", status: "active" },
    ]);
    await room.dispatch({
      type: "ACCEPT_GOAL",
      actor: "owner",
      expectedStateVersion: 8,
      idempotencyKey: "owner-acceptance",
      candidateSha256: passedSha,
    });
    expect(createOwnerViewModel(room.getState(), room.getReceipts()).lifecycle).toMatchObject([
      { id: "plan", status: "complete" },
      { id: "claim", status: "complete" },
      { id: "evidence", status: "complete" },
      { id: "verify", status: "complete" },
      { id: "completion", status: "complete" },
      { id: "acceptance", status: "complete" },
    ]);
  });

  it("centers the exact owner decision for a proposed Plan", async () => {
    const room = createGoalRoom({
      goal: "Publish a verified WebMCP Challenge entry",
      doneLooksLike: ["Public app works", "Verification passes", "Owner accepts"],
    });
    await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "proposal-v1",
      steps: [
        { id: "metadata", title: "Prepare release metadata" },
        { id: "verify", title: "Run deterministic verification" },
      ],
    });

    expect(createOwnerViewModel(room.getState(), room.getReceipts())).toMatchObject({
      statusLabel: "Waiting for your Plan decision",
      ownerAttention: {
        required: true,
        title: "Review Plan v1",
        body: "Work cannot begin until you confirm this Plan or request a revision.",
      },
      actions: {
        confirm: { visible: true, label: "Confirm Plan v1" },
        revise: { visible: true, label: "Request revision" },
      },
      nextLegalAction: {
        label: "Owner must confirm or request revision",
        actor: "owner",
      },
      plan: {
        version: 1,
        status: "PROPOSED",
        steps: [
          { id: "metadata", title: "Prepare release metadata" },
          { id: "verify", title: "Run deterministic verification" },
        ],
      },
      receiptCount: 1,
    });
  });

  it("shows confirmed scope without implying Goal acceptance", async () => {
    const room = createGoalRoom({
      goal: "Publish a verified WebMCP Challenge entry",
      doneLooksLike: ["Owner accepts"],
    });
    await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "proposal-v1",
      steps: [{ id: "verify", title: "Run verification" }],
    });
    await room.dispatch({
      type: "CONFIRM_PLAN",
      actor: "owner",
      expectedStateVersion: 1,
      idempotencyKey: "confirm-v1",
      planVersion: 1,
    });

    expect(createOwnerViewModel(room.getState(), room.getReceipts())).toMatchObject({
      statusLabel: "Plan confirmed — work may begin",
      ownerAttention: {
        required: false,
        title: "Plan v1 confirmed",
        body: "The agent may claim an admitted step. The Goal is not yet accepted.",
      },
      actions: {
        confirm: { visible: false },
        revise: { visible: false },
      },
      nextLegalAction: {
        label: "Agent may claim the next admitted step",
        actor: "agent",
      },
      lifecycle: [
        { id: "plan", status: "complete" },
        { id: "claim", status: "active" },
        { id: "evidence", status: "pending" },
        { id: "verify", status: "pending" },
        { id: "completion", status: "pending" },
        { id: "acceptance", status: "pending" },
      ],
      plan: { version: 1, status: "CONFIRMED" },
      receiptCount: 2,
    });
  });

  it("shows the owner revision note while waiting for the agent", async () => {
    const room = createGoalRoom({
      goal: "Publish a verified WebMCP Challenge entry",
      doneLooksLike: ["Owner accepts"],
    });
    await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "proposal-v1",
      steps: [{ id: "verify", title: "Run verification" }],
    });
    await room.dispatch({
      type: "REQUEST_PLAN_REVISION",
      actor: "owner",
      expectedStateVersion: 1,
      idempotencyKey: "revision-v1",
      planVersion: 1,
      note: "Add the three-minute demo limit.",
    });

    expect(createOwnerViewModel(room.getState(), room.getReceipts())).toMatchObject({
      statusLabel: "Waiting for revised Plan",
      ownerAttention: {
        required: false,
        title: "Revision requested",
        body: "The agent must respond with Plan v2 before you need to decide again.",
      },
      actions: {
        confirm: { visible: false },
        revise: { visible: false },
      },
      nextLegalAction: {
        label: "Agent must propose revised Plan v2",
        actor: "agent",
      },
      plan: {
        version: 1,
        status: "REVISION_REQUESTED",
        revisionNote: "Add the three-minute demo limit.",
      },
      receiptCount: 2,
    });
  });
});
