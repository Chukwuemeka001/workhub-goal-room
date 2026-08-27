import { describe, expect, it, vi } from "vitest";
import { createGoalRoom } from "./core/goalRoom";
import { installGoalRoomTools } from "./webmcp";

async function digestText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("governed Goal Room WebMCP tools", () => {
  it("returns authoritative accepted results when reporting throws", async () => {
    const registerTool = vi.fn();
    const room = createGoalRoom({
      goal: "Ship a governed release",
      doneLooksLike: ["Owner accepts exact verified evidence"],
    });
    installGoalRoomTools({
      documentLike: { modelContext: { registerTool } },
      navigatorLike: {},
      room,
      onInvocation: () => {
        throw new Error("RENDER_FAILED");
      },
    });
    const tool = registerTool.mock.calls
      .map(([definition]) => definition)
      .find(({ name }) => name === "propose_plan");
    const input = {
      expectedStateVersion: 0,
      idempotencyKey: "reporting-failure-plan",
      steps: [{ id: "artifact", title: "Produce exact evidence" }],
    };

    await expect(tool.execute(input)).resolves.toMatchObject({
      accepted: true,
      currentStateVersion: 1,
      nextLegalAction: "OWNER_CONFIRM_OR_REVISE_PLAN",
      ownerRequired: true,
    });
    await expect(tool.execute(structuredClone(input))).resolves.toMatchObject({
      accepted: true,
      currentStateVersion: 1,
    });
    expect(room.getState().phase).toBe("PLAN_PROPOSED");
    expect(room.getReceipts()).toHaveLength(1);
  });

  it("enforces every declared maximum before command admission", async () => {
    const cases = [
      [
        "propose_plan",
        {
          expectedStateVersion: 0,
          idempotencyKey: "k".repeat(161),
          steps: [{ id: "artifact", title: "Evidence" }],
        },
      ],
      [
        "propose_plan",
        {
          expectedStateVersion: 0,
          idempotencyKey: "plan",
          steps: [{ id: "i".repeat(81), title: "Evidence" }],
        },
      ],
      [
        "propose_plan",
        {
          expectedStateVersion: 0,
          idempotencyKey: "plan",
          steps: [{ id: "artifact", title: "t".repeat(161) }],
        },
      ],
      [
        "claim_step",
        {
          expectedStateVersion: 0,
          idempotencyKey: "k".repeat(161),
          planVersion: 1,
          stepId: "artifact",
        },
      ],
      [
        "claim_step",
        {
          expectedStateVersion: 0,
          idempotencyKey: "claim",
          planVersion: 1,
          stepId: "s".repeat(81),
        },
      ],
      [
        "submit_artifact",
        {
          expectedStateVersion: 0,
          idempotencyKey: "candidate",
          planVersion: 1,
          stepId: "artifact",
          content: "a".repeat(4097),
          sha256: "0".repeat(64),
        },
      ],
      [
        "request_completion",
        {
          expectedStateVersion: 0,
          idempotencyKey: "k".repeat(161),
          candidateSha256: "0".repeat(64),
        },
      ],
    ] as const;

    for (const [toolName, input] of cases) {
      const registerTool = vi.fn();
      const room = createGoalRoom({
        goal: "Ship a governed release",
        doneLooksLike: ["Owner accepts exact verified evidence"],
      });
      installGoalRoomTools({
        documentLike: { modelContext: { registerTool } },
        navigatorLike: {},
        room,
        onInvocation: vi.fn(),
      });
      const tool = registerTool.mock.calls
        .map(([definition]) => definition)
        .find(({ name }) => name === toolName);

      const result = await tool.execute(input);
      expect(result, toolName).toMatchObject({
        accepted: false,
        reasonCode: "INVALID_TOOL_INPUT",
        currentStateVersion: 0,
        nextLegalAction: "AGENT_PROPOSE_PLAN",
      });
      expect(room.getReceipts(), toolName).toHaveLength(0);
    }
  });

  it("enforces the declared Plan step-count bound at runtime", async () => {
    const registerTool = vi.fn();
    const room = createGoalRoom({
      goal: "Ship a governed release",
      doneLooksLike: ["Owner accepts exact verified evidence"],
    });
    installGoalRoomTools({
      documentLike: { modelContext: { registerTool } },
      navigatorLike: {},
      room,
      onInvocation: vi.fn(),
    });
    const tool = registerTool.mock.calls
      .map(([definition]) => definition)
      .find(({ name }) => name === "propose_plan");

    const result = await tool.execute({
      expectedStateVersion: 0,
      idempotencyKey: "plan-too-large",
      steps: Array.from({ length: 9 }, (_, index) => ({
        id: `step-${index}`,
        title: `Step ${index}`,
      })),
    });

    expect(result).toMatchObject({
      accepted: false,
      reasonCode: "INVALID_TOOL_INPUT",
      currentStateVersion: 0,
      nextLegalAction: "AGENT_PROPOSE_PLAN",
    });
    expect(room.getReceipts()).toHaveLength(0);
  });

  it("preserves exact retry and closes changed idempotency-key reuse", async () => {
    const registerTool = vi.fn();
    const room = createGoalRoom({
      goal: "Ship a governed release",
      doneLooksLike: ["Owner accepts exact verified evidence"],
    });
    installGoalRoomTools({
      documentLike: { modelContext: { registerTool } },
      navigatorLike: {},
      room,
      onInvocation: vi.fn(),
    });
    const tool = registerTool.mock.calls
      .map(([definition]) => definition)
      .find(({ name }) => name === "propose_plan");
    const input = {
      expectedStateVersion: 0,
      idempotencyKey: "plan-v1",
      steps: [{ id: "artifact", title: "Produce exact evidence" }],
    };

    const first = await tool.execute(input);
    const retry = await tool.execute(structuredClone(input));
    expect(retry).toEqual(first);
    expect(room.getReceipts()).toHaveLength(1);

    const conflict = await tool.execute({
      ...input,
      steps: [{ id: "artifact", title: "Changed under the same key" }],
    });
    expect(conflict).toMatchObject({
      accepted: false,
      reasonCode: "IDEMPOTENCY_KEY_REUSE",
      currentStateVersion: 1,
      nextLegalAction: "OWNER_CONFIRM_OR_REVISE_PLAN",
      ownerRequired: true,
    });
    expect(room.getReceipts()).toHaveLength(1);
  });

  it("turns malformed exact-shape values into a structured closed refusal", async () => {
    const registerTool = vi.fn();
    const room = createGoalRoom({
      goal: "Ship a governed release",
      doneLooksLike: ["Owner accepts exact verified evidence"],
    });
    installGoalRoomTools({
      documentLike: { modelContext: { registerTool } },
      navigatorLike: {},
      room,
      onInvocation: vi.fn(),
    });
    const tool = registerTool.mock.calls
      .map(([definition]) => definition)
      .find(({ name }) => name === "propose_plan");

    const result = await tool.execute({
      expectedStateVersion: false,
      idempotencyKey: "plan-v1",
      steps: [{ id: "artifact", title: "Produce exact evidence" }],
    });

    expect(result).toMatchObject({
      accepted: false,
      reasonCode: "INVALID_TOOL_INPUT",
      currentStateVersion: 0,
      nextLegalAction: "AGENT_PROPOSE_PLAN",
      ownerRequired: false,
    });
    expect(room.getReceipts()).toHaveLength(0);
  });

  it("enforces exact runtime input shapes across the complete tool surface", async () => {
    const registerTool = vi.fn();
    const room = createGoalRoom({
      goal: "Ship a governed release",
      doneLooksLike: ["Owner accepts exact verified evidence"],
    });
    installGoalRoomTools({
      documentLike: { modelContext: { registerTool } },
      navigatorLike: {},
      room,
      onInvocation: vi.fn(),
    });
    const tools = new Map(
      registerTool.mock.calls.map(([definition]) => [definition.name, definition]),
    );
    const invalidCalls = [
      ["get_goal_room_state", { unexpected: true }],
      [
        "propose_plan",
        {
          expectedStateVersion: 0,
          idempotencyKey: "plan-v1",
          steps: [{ id: "artifact", title: "Produce exact evidence" }],
          actor: "owner",
        },
      ],
      [
        "claim_step",
        {
          expectedStateVersion: 0,
          idempotencyKey: "claim",
          planVersion: 1,
          stepId: "artifact",
          actor: "owner",
        },
      ],
      [
        "submit_artifact",
        {
          expectedStateVersion: 0,
          idempotencyKey: "candidate",
          planVersion: 1,
          stepId: "artifact",
          content: "{}",
          sha256: "0".repeat(64),
          actor: "system",
        },
      ],
      [
        "request_completion",
        {
          expectedStateVersion: 0,
          idempotencyKey: "completion",
          candidateSha256: "0".repeat(64),
          actor: "owner",
        },
      ],
    ] as const;

    for (const [name, input] of invalidCalls) {
      const result = await tools.get(name).execute(input);
      expect(result, name).toMatchObject({
        accepted: false,
        reasonCode: "INVALID_TOOL_INPUT",
        currentStateVersion: 0,
        nextLegalAction: "AGENT_PROPOSE_PLAN",
        ownerRequired: false,
      });
    }
    expect(room.getState().phase).toBe("DRAFT");
    expect(room.getReceipts()).toHaveLength(0);
  });

  it("fails closed on unknown tool input without a receipt or state mutation", async () => {
    const registerTool = vi.fn();
    const room = createGoalRoom({
      goal: "Ship a governed release",
      doneLooksLike: ["Owner accepts exact verified evidence"],
    });
    await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "plan-v1",
      steps: [{ id: "artifact", title: "Produce exact evidence" }],
    });
    await room.dispatch({
      type: "CONFIRM_PLAN",
      actor: "owner",
      expectedStateVersion: 1,
      idempotencyKey: "owner-confirms-v1",
      planVersion: 1,
    });
    installGoalRoomTools({
      documentLike: { modelContext: { registerTool } },
      navigatorLike: {},
      room,
      onInvocation: vi.fn(),
    });
    const tool = registerTool.mock.calls
      .map(([definition]) => definition)
      .find(({ name }) => name === "claim_step");
    const before = room.getState();
    const receiptCount = room.getReceipts().length;

    const result = await tool.execute({
      expectedStateVersion: 2,
      idempotencyKey: "claim-artifact",
      planVersion: 1,
      stepId: "artifact",
      actor: "owner",
    });

    expect(result).toMatchObject({
      accepted: false,
      reasonCode: "INVALID_TOOL_INPUT",
      currentStateVersion: 2,
      nextLegalAction: "AGENT_CLAIM_OPEN_STEP",
      ownerRequired: false,
    });
    expect(room.getState()).toEqual(before);
    expect(room.getReceipts()).toHaveLength(receiptCount);
  });

  it("refuses premature completion then admits it only after exact PASS", async () => {
    const registerTool = vi.fn();
    const room = createGoalRoom({
      goal: "Ship a governed release",
      doneLooksLike: ["Owner accepts exact verified evidence"],
    });
    await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "plan-v1",
      steps: [{ id: "artifact", title: "Produce exact evidence" }],
    });
    await room.dispatch({
      type: "CONFIRM_PLAN",
      actor: "owner",
      expectedStateVersion: 1,
      idempotencyKey: "owner-confirms-v1",
      planVersion: 1,
    });
    await room.dispatch({
      type: "CLAIM_STEP",
      actor: "agent",
      expectedStateVersion: 2,
      idempotencyKey: "claim-artifact",
      planVersion: 1,
      stepId: "artifact",
    });
    const content = JSON.stringify({
      publicUrl: "https://example.test/release",
      demoDurationSeconds: 90,
      verificationCommand: "npm test",
    });
    const sha256 = await digestText(content);
    await room.dispatch({
      type: "SUBMIT_CANDIDATE",
      actor: "agent",
      expectedStateVersion: 3,
      idempotencyKey: "candidate-v1",
      planVersion: 1,
      stepId: "artifact",
      content,
      sha256,
    });
    installGoalRoomTools({
      documentLike: { modelContext: { registerTool } },
      navigatorLike: {},
      room,
      onInvocation: vi.fn(),
    });
    const tool = registerTool.mock.calls
      .map(([definition]) => definition)
      .find(({ name }) => name === "request_completion");

    const premature = await tool.execute({
      expectedStateVersion: 4,
      idempotencyKey: "completion-too-early",
      candidateSha256: sha256,
    });
    expect(premature).toMatchObject({
      accepted: false,
      reasonCode: "VERIFICATION_REQUIRED",
      missingConditions: ["ACTIVE_CANDIDATE_MUST_PASS_RELEASE_RULES"],
      currentStateVersion: 4,
      nextLegalAction: "SYSTEM_VERIFY_CANDIDATE",
      ownerRequired: false,
    });
    expect(room.getState().phase).toBe("CANDIDATE_SUBMITTED");

    await room.verifyActiveCandidate("system-verifies-v1");
    const accepted = await tool.execute({
      expectedStateVersion: 5,
      idempotencyKey: "completion-after-pass",
      candidateSha256: sha256,
    });
    expect(accepted).toMatchObject({
      accepted: true,
      currentStateVersion: 6,
      nextLegalAction: "OWNER_ACCEPT_OR_REQUEST_WORK",
      ownerRequired: true,
    });
    expect(room.getState()).toMatchObject({
      phase: "COMPLETION_REQUESTED",
      activeCompletionRequest: { candidateSha256: sha256, requestedBy: "agent" },
      goalAcceptance: null,
    });
  });

  it("submits exact digest-bound artifact content after the admitted claim", async () => {
    const registerTool = vi.fn();
    const room = createGoalRoom({
      goal: "Ship a governed release",
      doneLooksLike: ["Owner accepts exact verified evidence"],
    });
    await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "plan-v1",
      steps: [{ id: "artifact", title: "Produce exact evidence" }],
    });
    await room.dispatch({
      type: "CONFIRM_PLAN",
      actor: "owner",
      expectedStateVersion: 1,
      idempotencyKey: "owner-confirms-v1",
      planVersion: 1,
    });
    await room.dispatch({
      type: "CLAIM_STEP",
      actor: "agent",
      expectedStateVersion: 2,
      idempotencyKey: "claim-artifact",
      planVersion: 1,
      stepId: "artifact",
    });
    installGoalRoomTools({
      documentLike: { modelContext: { registerTool } },
      navigatorLike: {},
      room,
      onInvocation: vi.fn(),
    });
    const tool = registerTool.mock.calls
      .map(([definition]) => definition)
      .find(({ name }) => name === "submit_artifact");
    const content = JSON.stringify({
      publicUrl: "https://example.test/release",
      demoDurationSeconds: 90,
      verificationCommand: "npm test",
    });
    const sha256 = await digestText(content);

    expect(tool.inputSchema).toMatchObject({
      additionalProperties: false,
      required: [
        "expectedStateVersion",
        "idempotencyKey",
        "planVersion",
        "stepId",
        "content",
        "sha256",
      ],
    });
    const result = await tool.execute({
      expectedStateVersion: 3,
      idempotencyKey: "candidate-v1",
      planVersion: 1,
      stepId: "artifact",
      content,
      sha256,
    });

    expect(result).toMatchObject({
      accepted: true,
      currentStateVersion: 4,
      nextLegalAction: "SYSTEM_VERIFY_CANDIDATE",
      ownerRequired: false,
    });
    expect(room.getState()).toMatchObject({
      phase: "CANDIDATE_SUBMITTED",
      activeCandidate: {
        version: 1,
        content,
        sha256,
        submittedBy: "agent",
      },
    });
  });

  it("claims only an admitted step through the agent authority path", async () => {
    const registerTool = vi.fn();
    const room = createGoalRoom({
      goal: "Ship a governed release",
      doneLooksLike: ["Owner accepts exact verified evidence"],
    });
    await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "plan-v1",
      steps: [{ id: "artifact", title: "Produce exact evidence" }],
    });
    await room.dispatch({
      type: "CONFIRM_PLAN",
      actor: "owner",
      expectedStateVersion: 1,
      idempotencyKey: "owner-confirms-v1",
      planVersion: 1,
    });
    installGoalRoomTools({
      documentLike: { modelContext: { registerTool } },
      navigatorLike: {},
      room,
      onInvocation: vi.fn(),
    });
    const tool = registerTool.mock.calls
      .map(([definition]) => definition)
      .find(({ name }) => name === "claim_step");

    expect(tool.inputSchema).toMatchObject({
      additionalProperties: false,
      required: [
        "expectedStateVersion",
        "idempotencyKey",
        "planVersion",
        "stepId",
      ],
    });
    const stale = await tool.execute({
      expectedStateVersion: 1,
      idempotencyKey: "stale-claim",
      planVersion: 1,
      stepId: "artifact",
    });
    expect(stale).toMatchObject({
      accepted: false,
      reasonCode: "STALE_STATE",
      currentStateVersion: 2,
      nextLegalAction: "AGENT_CLAIM_OPEN_STEP",
      ownerRequired: false,
    });
    expect(room.getReceipts().at(-1)).toMatchObject({
      accepted: false,
      reasonCode: "STALE_STATE",
      stateVersion: 2,
    });

    const result = await tool.execute({
      expectedStateVersion: 2,
      idempotencyKey: "claim-artifact",
      planVersion: 1,
      stepId: "artifact",
    });

    expect(result).toMatchObject({
      accepted: true,
      currentStateVersion: 3,
      nextLegalAction: "AGENT_SUBMIT_CANDIDATE",
      ownerRequired: false,
    });
    expect(room.getState()).toMatchObject({
      phase: "STEP_CLAIMED",
      activeClaim: {
        planVersion: 1,
        stepId: "artifact",
        claimedBy: "agent",
      },
    });
  });

  it("proposes a Plan through the kernel and stops at the owner gate", async () => {
    const registerTool = vi.fn();
    const room = createGoalRoom({
      goal: "Ship a governed release",
      doneLooksLike: ["Owner accepts exact verified evidence"],
    });
    installGoalRoomTools({
      documentLike: { modelContext: { registerTool } },
      navigatorLike: {},
      room,
      onInvocation: vi.fn(),
    });
    const tool = registerTool.mock.calls
      .map(([definition]) => definition)
      .find(({ name }) => name === "propose_plan");

    expect(tool).toMatchObject({
      name: "propose_plan",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["expectedStateVersion", "idempotencyKey", "steps"],
      },
      annotations: { readOnlyHint: false },
    });

    const result = await tool.execute({
      expectedStateVersion: 0,
      idempotencyKey: "plan-v1",
      steps: [{ id: "artifact", title: "Produce exact evidence" }],
    });

    expect(result).toMatchObject({
      accepted: true,
      currentStateVersion: 1,
      nextLegalAction: "OWNER_CONFIRM_OR_REVISE_PLAN",
      ownerRequired: true,
    });
    expect(room.getState()).toMatchObject({
      phase: "PLAN_PROPOSED",
      stateVersion: 1,
      activePlan: { version: 1, proposedBy: "agent" },
    });
    expect(room.getReceipts()).toHaveLength(1);
  });

  it("registers a read-only state tool with the current legal frontier", async () => {
    const registerTool = vi.fn();
    const room = createGoalRoom({
      goal: "Ship a governed release",
      doneLooksLike: ["Owner accepts exact verified evidence"],
    });

    const installed = installGoalRoomTools({
      documentLike: { modelContext: { registerTool } },
      navigatorLike: {},
      room,
      onInvocation: vi.fn(),
    });

    expect(installed.status).toBe("registered");
    expect(
      registerTool.mock.calls.map(([definition]) => definition.name).sort(),
    ).toEqual([
      "claim_step",
      "get_goal_room_state",
      "propose_plan",
      "request_completion",
      "submit_artifact",
    ]);
    const tool = registerTool.mock.calls
      .map(([definition]) => definition)
      .find(({ name }) => name === "get_goal_room_state");
    expect(tool).toMatchObject({
      name: "get_goal_room_state",
      title: "Get governed Goal Room state",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
        required: [],
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
    });

    const result = await tool.execute({});

    expect(result).toMatchObject({
      accepted: true,
      currentStateVersion: 0,
      nextLegalAction: "AGENT_PROPOSE_PLAN",
      ownerRequired: false,
      state: {
        goal: "Ship a governed release",
        phase: "DRAFT",
        stateVersion: 0,
      },
    });
    result.state.goal = "tampered";
    expect(room.getState().goal).toBe("Ship a governed release");
    expect(room.getReceipts()).toHaveLength(0);
  });
});
