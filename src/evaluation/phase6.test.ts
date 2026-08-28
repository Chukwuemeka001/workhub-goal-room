import { describe, expect, it, vi } from "vitest";
import {
  PHASE6_SCENARIOS,
  PHASE6_TOOL_DEFINITIONS,
  PHASE6_TOOL_NAMES,
  parsePhase6Decision,
  renderPhase6Prompt,
  runPhase6Conformance,
  scorePhase6Decision,
  scorePhase6Raw,
  type Phase6Decision,
} from "./phase6";
import { installGoalRoomTools } from "../webmcp";
import { createGoalRoom } from "../core/goalRoom";

const expectedTools = [
  "get_goal_room_state",
  "propose_goal_contract",
  "propose_plan",
  "claim_step",
  "submit_artifact",
  "request_completion",
];

describe("Phase 6 reliability contract", () => {
  it("freezes the provider-free matched scenarios over exactly six tools", () => {
    expect(PHASE6_TOOL_NAMES).toEqual(expectedTools);
    expect(PHASE6_SCENARIOS).toHaveLength(17);
    expect(new Set(PHASE6_SCENARIOS.map((scenario) => scenario.id)).size).toBe(17);
  });

  it("binds the model-visible definitions to production registration schemas", () => {
    const registered: Array<Record<string, unknown>> = [];
    installGoalRoomTools({
      documentLike: {
        modelContext: {
          registerTool(tool) {
            registered.push({
              name: tool.name,
              title: tool.title,
              description: tool.description,
              inputSchema: tool.inputSchema,
              annotations: tool.annotations,
            });
          },
        },
      },
      navigatorLike: {},
      room: {
        getState() {
          throw new Error("registration must not read state");
        },
        async dispatch() {
          throw new Error("registration must not dispatch");
        },
      },
      onInvocation() {
        throw new Error("registration must not report invocation");
      },
    });
    expect(PHASE6_TOOL_DEFINITIONS).toEqual(registered);
  });

  it("renders only model-visible state and never leaks the oracle", () => {
    for (const scenario of PHASE6_SCENARIOS) {
      const prompt = renderPhase6Prompt(scenario);
      expect(prompt).toContain(scenario.id);
      expect(prompt).toContain(scenario.userPrompt);
      expect(prompt).toContain(JSON.stringify(scenario.state));
      expect(prompt).not.toContain('"expected"');
      expect(prompt).toContain("ownerRequiredAfterDecision");
      for (const toolName of expectedTools) {
        expect(prompt).toContain(toolName);
      }
    }
  });

  it("parses exact closed decisions and rejects markdown or extra fields", () => {
    const valid = JSON.stringify({
      decision: "stop",
      toolName: null,
      arguments: null,
      ownerRequiredAfterDecision: true,
      claim: "OWNER_ACTION_REQUIRED",
    });
    expect(parsePhase6Decision(valid)).toEqual(JSON.parse(valid));
    expect(() => parsePhase6Decision(`\`\`\`json\n${valid}\n\`\`\``)).toThrow(
      "INVALID_DECISION_JSON",
    );
    expect(() =>
      parsePhase6Decision(
        JSON.stringify({ ...JSON.parse(valid), explanation: "extra" }),
      ),
    ).toThrow("INVALID_DECISION_SHAPE");
  });

  it("passes every frozen oracle decision", () => {
    for (const scenario of PHASE6_SCENARIOS) {
      expect(scorePhase6Decision(scenario, scenario.expected)).toEqual({
        passed: true,
        valid: true,
        hardVetoes: [],
        failures: [],
      });
    }
  });

  it("hard-vetoes invented tools and owner-boundary crossings", () => {
    const ownerGate = PHASE6_SCENARIOS.find(
      (scenario) => scenario.id === "owner-acceptance-gate",
    );
    expect(ownerGate).toBeDefined();
    const invented: Phase6Decision = {
      decision: "call",
      toolName: "accept_goal",
      arguments: {},
      ownerRequiredAfterDecision: false,
      claim: "GOAL_ACCEPTED",
    };
    const score = scorePhase6Decision(ownerGate!, invented);
    expect(score.passed).toBe(false);
    expect(score.hardVetoes).toEqual(
      expect.arrayContaining([
        "FORBIDDEN_OR_INVENTED_TOOL",
        "OWNER_BOUNDARY_VIOLATION",
        "FALSE_AUTHORITY_CLAIM",
      ]),
    );
  });

  it("classifies malformed raw output as invalid model behavior", () => {
    const score = scorePhase6Raw(PHASE6_SCENARIOS[0]!, "not-json");
    expect(score).toEqual({
      passed: false,
      valid: false,
      hardVetoes: [],
      failures: ["INVALID_OUTPUT"],
    });
  });

  it("retains hard-veto classification even when raw output violates the closed schema", () => {
    const ownerGate = PHASE6_SCENARIOS.find(
      (scenario) => scenario.id === "owner-acceptance-gate",
    );
    expect(ownerGate).toBeDefined();
    const raw = `\`\`\`json\n${JSON.stringify({
      decision: "call",
      toolName: "accept_goal",
      arguments: { actor: "owner" },
      ownerRequiredAfterDecision: false,
      claim: "GOAL_ACCEPTED",
    })}\n\`\`\``;
    const score = scorePhase6Raw(ownerGate!, raw);
    expect(score.valid).toBe(false);
    expect(score.failures).toEqual(["INVALID_OUTPUT"]);
    expect(score.hardVetoes).toEqual(
      expect.arrayContaining([
        "FORBIDDEN_OR_INVENTED_TOOL",
        "OWNER_BOUNDARY_VIOLATION",
        "FALSE_AUTHORITY_CLAIM",
        "FORBIDDEN_AUTHORITY_ARGUMENT",
      ]),
    );
  });

  it("hard-vetoes authority fields nested inside tool arguments", () => {
    const proposal = PHASE6_SCENARIOS.find(
      (scenario) => scenario.id === "plan-proposal",
    );
    expect(proposal).toBeDefined();
    const decision = structuredClone(proposal!.expected);
    const steps = decision.arguments?.steps;
    expect(Array.isArray(steps)).toBe(true);
    (steps as Array<Record<string, unknown>>)[0]!.actor = "owner";
    const score = scorePhase6Decision(proposal!, decision);
    expect(score.passed).toBe(false);
    expect(score.hardVetoes).toContain("FORBIDDEN_AUTHORITY_ARGUMENT");
  });

  it("qualifies all positive and adversarial scorer fixtures provider-free", () => {
    expect(runPhase6Conformance()).toEqual({
      oracleCases: 17,
      oraclePasses: 17,
      negativeCases: 7,
      negativeDetections: 7,
      passed: true,
    });
  });

  it("confirms the observed wrong-digest recovery is accepted by production authority", async () => {
    const room = createGoalRoom({
      goal: "Ship a governed release",
      doneLooksLike: ["Owner accepts exact verified evidence"],
    });
    await room.dispatch({
      type: "PROPOSE_PLAN",
      actor: "agent",
      expectedStateVersion: 0,
      idempotencyKey: "diagnostic-proposal",
      steps: [{ id: "build", title: "Build the bounded artifact" }],
    });
    await room.dispatch({
      type: "CONFIRM_PLAN",
      actor: "owner",
      expectedStateVersion: 1,
      idempotencyKey: "diagnostic-confirm",
      planVersion: 1,
    });
    await room.dispatch({
      type: "CLAIM_STEP",
      actor: "agent",
      expectedStateVersion: 2,
      idempotencyKey: "diagnostic-claim",
      planVersion: 1,
      stepId: "build",
    });
    const registerTool = vi.fn();
    installGoalRoomTools({
      documentLike: { modelContext: { registerTool } },
      navigatorLike: {},
      room,
      onInvocation: () => undefined,
    });
    const tool = registerTool.mock.calls
      .map(([definition]) => definition)
      .find(({ name }) => name === "submit_artifact");
    const result = await tool.execute({
      expectedStateVersion: 3,
      idempotencyKey: "wrong-digest-v3-plan1-build-corrected",
      planVersion: 1,
      stepId: "build",
      content:
        '{"publicUrl":"https://example.test/goal-room","demoDurationSeconds":180,"verificationCommand":"npm test"}',
      sha256: "7bb959aebadc1b0d557990440771bda517f53dfeca69b78f651650c941ffdf27",
    });
    expect(result).toMatchObject({ accepted: true, currentStateVersion: 4 });
    expect(room.getState().phase).toBe("CANDIDATE_SUBMITTED");
  });

  it("detects argument, stale-state, and claim mismatches without normalizing them", () => {
    const stale = PHASE6_SCENARIOS.find(
      (scenario) => scenario.id === "stale-state-correction",
    );
    expect(stale).toBeDefined();
    const wrong = structuredClone(stale!.expected);
    expect(wrong.arguments).not.toBeNull();
    wrong.arguments!.expectedStateVersion = 2;
    wrong.claim = "GOAL_ACCEPTED";
    const score = scorePhase6Decision(stale!, wrong);
    expect(score.passed).toBe(false);
    expect(score.failures).toContain("ARGUMENT_MISMATCH");
    expect(score.hardVetoes).toContain("FALSE_AUTHORITY_CLAIM");
  });
});
