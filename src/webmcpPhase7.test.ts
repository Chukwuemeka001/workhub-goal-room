import { describe, expect, it, vi } from "vitest";
import { createGoalRoom } from "./core/goalRoom";
import { installGoalRoomTools } from "./webmcp";

const goal = {
  goal: "Publish a governed WebMCP entry",
  why: "Make the authority boundary observable.",
  doneLooksLike: ["The exact verified result is owner-accepted"],
  constraints: ["No external effects"],
  nonGoals: ["Accounts"],
  evidenceRequired: ["Deterministic PASS"],
  openQuestions: ["Which public URL?"],
};

function installed(
  room = createGoalRoom({ ownerIntent: "Build a governed entry." }),
  reporter: (record: { toolName: string; result: Record<string, unknown> }) => void = vi.fn(),
) {
  const registerTool = vi.fn();
  installGoalRoomTools({
    documentLike: { modelContext: { registerTool } }, navigatorLike: {}, room,
    onInvocation: reporter,
  });
  return {
    room,
    definitions: registerTool.mock.calls.map(([definition]) => definition),
    tools: new Map(registerTool.mock.calls.map(([definition]) => [definition.name, definition])),
  };
}

describe("Phase 7 safe WebMCP surface", () => {
  it("registers exactly six static, ordered, non-privileged descriptors", () => {
    const { definitions } = installed();
    expect(definitions.map(({ name }) => name)).toEqual([
      "get_goal_room_state", "propose_goal_contract", "propose_plan",
      "claim_step", "submit_artifact", "request_completion",
    ]);
    expect(definitions.map(({ name }) => name)).not.toEqual(expect.arrayContaining([
      "set_owner_intent", "confirm_goal_contract", "request_goal_revision",
      "confirm_plan", "record_verification", "accept_goal",
    ]));
    expect(definitions[1]).toMatchObject({
      name: "propose_goal_contract",
      annotations: { readOnlyHint: false, consequentialHint: false, untrustedContentHint: true },
      inputSchema: {
        type: "object", additionalProperties: false,
        required: ["expectedStateVersion", "idempotencyKey", "goal", "why", "doneLooksLike", "constraints", "nonGoals", "evidenceRequired", "openQuestions"],
      },
    });
    for (const definition of definitions) {
      expect(definition.inputSchema.additionalProperties).toBe(false);
    }
  });

  it("proposes immutable Goal v1 and revised v2 with exact retry/key/stale/illegal semantics", async () => {
    const { room, tools } = installed();
    const tool: any = tools.get("propose_goal_contract");
    const input = { expectedStateVersion: 0, idempotencyKey: "goal-v1", ...goal };
    const first = await tool.execute(input);
    expect(first).toMatchObject({ accepted: true, currentStateVersion: 1, ownerRequired: true });
    expect(await tool.execute(structuredClone(input))).toEqual(first);
    expect(room.getReceipts()).toHaveLength(1);
    expect(await tool.execute({ ...input, why: "Changed under one key" })).toMatchObject({
      accepted: false, reasonCode: "IDEMPOTENCY_KEY_REUSE", currentStateVersion: 1,
    });
    const illegal = await tool.execute({ ...input, expectedStateVersion: 1, idempotencyKey: "unrequested-v2" });
    expect(illegal).toMatchObject({ accepted: false, reasonCode: "GOAL_PROPOSAL_NOT_ALLOWED" });
    expect(room.getReceipts()).toHaveLength(2);
    await room.dispatch({ type: "REQUEST_GOAL_REVISION", actor: "owner", expectedStateVersion: 1,
      idempotencyKey: "revise-goal-v1", goalContractVersion: 1, note: "Resolve the URL question." });
    const stale = await tool.execute({ ...input, idempotencyKey: "stale-v2" });
    expect(stale).toMatchObject({ accepted: false, reasonCode: "STALE_STATE", currentStateVersion: 2 });
    const revised = { ...input, expectedStateVersion: 2, idempotencyKey: "goal-v2", openQuestions: [] };
    expect(await tool.execute(revised)).toMatchObject({ accepted: true, currentStateVersion: 3 });
    expect(room.getState().goalContractHistory).toMatchObject([
      { version: 1, status: "REVISION_REQUESTED", openQuestions: goal.openQuestions },
      { version: 2, status: "PROPOSED", openQuestions: [] },
    ]);
  });

  it("rejects malformed Goal callback values before dispatch with no state or receipt", async () => {
    const invalid: unknown[] = [
      null, [], "goal", Object.create({ expectedStateVersion: 0 }), new Date(),
      { expectedStateVersion: 0, idempotencyKey: "k", ...goal, actor: "owner" },
      { expectedStateVersion: 0, idempotencyKey: "k", ...goal, type: "PROPOSE_GOAL_CONTRACT" },
      { expectedStateVersion: Number.MAX_SAFE_INTEGER + 1, idempotencyKey: "k", ...goal },
      { expectedStateVersion: 0, idempotencyKey: " ", ...goal },
      { expectedStateVersion: 0, idempotencyKey: "k".repeat(161), ...goal },
      { expectedStateVersion: 0, idempotencyKey: "k", ...goal, goal: " " },
      { expectedStateVersion: 0, idempotencyKey: "k", ...goal, goal: "🙂".repeat(251) },
      { expectedStateVersion: 0, idempotencyKey: "k", ...goal, doneLooksLike: [] },
      { expectedStateVersion: 0, idempotencyKey: "k", ...goal, constraints: Array(17).fill("x") },
      { expectedStateVersion: 0, idempotencyKey: "k", ...goal, openQuestions: [" "] },
      { expectedStateVersion: 0, idempotencyKey: "k", ...goal, evidenceRequired: [42] },
    ];
    for (const value of invalid) {
      const { room, tools } = installed();
      const before = room.getState();
      expect(await (tools.get("propose_goal_contract") as any).execute(value)).toMatchObject({
        accepted: false, reasonCode: "INVALID_TOOL_INPUT", currentStateVersion: 0,
      });
      expect(room.getState()).toEqual(before);
      expect(room.getReceipts()).toEqual([]);
    }
  });

  it("returns a compact defensive recovery projection across Goal phases and recent refusals", async () => {
    const { room, tools } = installed();
    const goalTool: any = tools.get("propose_goal_contract");
    const stateTool: any = tools.get("get_goal_room_state");
    const initial = await stateTool.execute({});
    expect(initial).toMatchObject({
      accepted: true, readOnly: true, phase: "INTENT_DRAFT", currentStateVersion: 0,
      ownerIntent: "Build a governed entry.", currentActor: "agent",
      legalAgentActions: ["propose_goal_contract"], nextLegalAction: "AGENT_PROPOSE_GOAL_CONTRACT",
      ownerRequired: false, goalContract: null, plan: null, claim: null, candidate: null,
      verification: null, completion: null, acceptance: null, recentRefusal: null,
      state: { phase: "INTENT_DRAFT", stateVersion: 0 },
    });
    await goalTool.execute({ expectedStateVersion: 0, idempotencyKey: "goal-v1", ...goal });
    const proposed = await stateTool.execute({});
    expect(proposed).toMatchObject({
      phase: "GOAL_CONTRACT_PROPOSED", currentActor: "owner", legalAgentActions: [],
      goalContract: { version: 1, status: "PROPOSED", openQuestions: goal.openQuestions },
      goalRevisionRequest: null,
    });
    await goalTool.execute({ expectedStateVersion: 1, idempotencyKey: "illegal-v2", ...goal });
    const refused = await stateTool.execute({});
    expect(refused.recentRefusal).toMatchObject({ reasonCode: "GOAL_PROPOSAL_NOT_ALLOWED", missingConditions: [] });
    refused.goalContract.openQuestions[0] = "tampered";
    refused.state.phase = "tampered";
    expect(room.getState().activeGoalContract?.openQuestions).toEqual(goal.openQuestions);
    expect(room.getState().phase).toBe("GOAL_CONTRACT_PROPOSED");
  });

  it("reporter failure cannot rewrite read-only, accepted, refused, or exact-retry results", async () => {
    const { room, tools } = installed(undefined, () => { throw new Error("REPORT_FAILED"); });
    const stateTool: any = tools.get("get_goal_room_state");
    const goalTool: any = tools.get("propose_goal_contract");
    await expect(stateTool.execute({})).resolves.toMatchObject({ accepted: true, readOnly: true });
    const input = { expectedStateVersion: 0, idempotencyKey: "goal-v1", ...goal };
    const accepted = await goalTool.execute(input);
    await expect(goalTool.execute(structuredClone(input))).resolves.toEqual(accepted);
    await expect(goalTool.execute({ ...input, expectedStateVersion: 1, idempotencyKey: "illegal" }))
      .resolves.toMatchObject({ accepted: false, reasonCode: "GOAL_PROPOSAL_NOT_ALLOWED" });
    expect(room.getReceipts()).toHaveLength(2);
  });
});
