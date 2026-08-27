import {
  getGoalRoomFrontier,
  type Command,
  type DispatchResult,
  type GoalRoomState,
} from "./core/goalRoom";

type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: {
    type: "object";
    additionalProperties: false;
    properties: Record<string, unknown>;
    required: string[];
  };
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint?: boolean;
    consequentialHint?: boolean;
  };
  execute: (input: any) => Promise<any>;
};

export type ModelContext = {
  registerTool: (
    tool: ToolDefinition,
    options?: { signal: AbortSignal } | AbortSignal,
  ) => unknown;
};

type ModelContextHost = {
  modelContext?: ModelContext;
};

function hasExactToolKeys(input: unknown, keys: string[]): boolean {
  if (input === null || typeof input !== "object") return false;
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actual = Object.keys(input).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isBoundedNonBlankString(value: unknown, maxLength: number): boolean {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}

function hasValidMutationEnvelope(input: Record<string, unknown>): boolean {
  return (
    Number.isSafeInteger(input.expectedStateVersion) &&
    (input.expectedStateVersion as number) >= 0 &&
    isBoundedNonBlankString(input.idempotencyKey, 160)
  );
}

function isValidPlanStep(value: unknown): boolean {
  if (!hasExactToolKeys(value, ["id", "title"])) return false;
  const step = value as Record<string, unknown>;
  return (
    isBoundedNonBlankString(step.id, 80) &&
    isBoundedNonBlankString(step.title, 160)
  );
}

export type RegistrationResult = {
  status: "registered" | "unsupported";
  dispose: () => void;
};

type GoalRoomPort = {
  getState: () => GoalRoomState;
  dispatch: (command: Command) => Promise<DispatchResult>;
};

type GovernedInstallOptions = {
  documentLike: ModelContextHost;
  navigatorLike: ModelContextHost;
  room: GoalRoomPort;
  onInvocation: (record: {
    toolName: string;
    result: Record<string, unknown>;
  }) => void;
};

export function installGoalRoomTools({
  documentLike,
  navigatorLike,
  room,
  onInvocation,
}: GovernedInstallOptions): RegistrationResult {
  const modelContext = documentLike.modelContext ?? navigatorLike.modelContext;
  if (typeof modelContext?.registerTool !== "function") {
    return { status: "unsupported", dispose: () => undefined };
  }

  const controller = new AbortController();
  const register = (tool: ToolDefinition) => {
    try {
      modelContext.registerTool(tool, { signal: controller.signal });
    } catch {
      modelContext.registerTool(tool, controller.signal);
    }
  };
  const recordResult = (
    toolName: string,
    result: Record<string, unknown>,
  ) => {
    onInvocation({ toolName, result });
    return result;
  };
  const closedToolRefusal = (toolName: string, reasonCode: string) => {
    const state = room.getState();
    return recordResult(toolName, {
      accepted: false,
      reasonCode,
      currentStateVersion: state.stateVersion,
      ...getGoalRoomFrontier(state),
    });
  };
  const invalidToolInput = (toolName: string) =>
    closedToolRefusal(toolName, "INVALID_TOOL_INPUT");
  const dispatchAgentCommand = async (
    toolName: string,
    command: Command,
  ) => {
    try {
      const { stateVersion, ...rest } = await room.dispatch(command);
      return recordResult(toolName, {
        ...rest,
        currentStateVersion: stateVersion,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_COMMAND") {
        return invalidToolInput(toolName);
      }
      if (
        error instanceof Error &&
        error.message === "IDEMPOTENCY_KEY_REUSE"
      ) {
        return closedToolRefusal(toolName, "IDEMPOTENCY_KEY_REUSE");
      }
      throw error;
    }
  };
  const stateTool: ToolDefinition = {
    name: "get_goal_room_state",
    title: "Get governed Goal Room state",
    description:
      "Read the current Goal Room state, state version, owner gate, and next legal action without changing the room.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input) {
      if (!hasExactToolKeys(input, [])) {
        return invalidToolInput("get_goal_room_state");
      }
      const state = room.getState();
      const result = {
        accepted: true,
        currentStateVersion: state.stateVersion,
        ...getGoalRoomFrontier(state),
        state,
      };
      return recordResult("get_goal_room_state", result);
    },
  };
  const proposePlanTool: ToolDefinition = {
    name: "propose_plan",
    title: "Propose an immutable Goal Plan",
    description:
      "Propose a versioned Plan as the agent. This never confirms the Plan; the owner must confirm or request revision.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        expectedStateVersion: { type: "integer", minimum: 0 },
        idempotencyKey: { type: "string", minLength: 1, maxLength: 160 },
        steps: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string", minLength: 1, maxLength: 80 },
              title: { type: "string", minLength: 1, maxLength: 160 },
            },
            required: ["id", "title"],
          },
        },
      },
      required: ["expectedStateVersion", "idempotencyKey", "steps"],
    },
    annotations: { readOnlyHint: false },
    async execute(input) {
      if (
        !hasExactToolKeys(input, [
          "expectedStateVersion",
          "idempotencyKey",
          "steps",
        ]) ||
        !hasValidMutationEnvelope(input) ||
        !Array.isArray(input.steps) ||
        input.steps.length < 1 ||
        input.steps.length > 8 ||
        !input.steps.every(isValidPlanStep)
      ) {
        return invalidToolInput("propose_plan");
      }
      return dispatchAgentCommand("propose_plan", {
        type: "PROPOSE_PLAN",
        actor: "agent",
        expectedStateVersion: input.expectedStateVersion,
        idempotencyKey: input.idempotencyKey,
        steps: input.steps,
      });
    },
  };

  const claimStepTool: ToolDefinition = {
    name: "claim_step",
    title: "Claim an admitted Plan step",
    description:
      "Claim one step from the exact owner-confirmed Plan version as the agent.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        expectedStateVersion: { type: "integer", minimum: 0 },
        idempotencyKey: { type: "string", minLength: 1, maxLength: 160 },
        planVersion: { type: "integer", minimum: 1 },
        stepId: { type: "string", minLength: 1, maxLength: 80 },
      },
      required: [
        "expectedStateVersion",
        "idempotencyKey",
        "planVersion",
        "stepId",
      ],
    },
    annotations: { readOnlyHint: false },
    async execute(input) {
      if (
        !hasExactToolKeys(input, [
          "expectedStateVersion",
          "idempotencyKey",
          "planVersion",
          "stepId",
        ]) ||
        !hasValidMutationEnvelope(input) ||
        !isBoundedNonBlankString(input.stepId, 80)
      ) {
        return invalidToolInput("claim_step");
      }
      return dispatchAgentCommand("claim_step", {
        type: "CLAIM_STEP",
        actor: "agent",
        expectedStateVersion: input.expectedStateVersion,
        idempotencyKey: input.idempotencyKey,
        planVersion: input.planVersion,
        stepId: input.stepId,
      });
    },
  };

  const submitArtifactTool: ToolDefinition = {
    name: "submit_artifact",
    title: "Submit exact candidate evidence",
    description:
      "Submit immutable candidate bytes and their declared SHA-256 for the currently claimed Plan step. WorkHub recomputes the digest.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        expectedStateVersion: { type: "integer", minimum: 0 },
        idempotencyKey: { type: "string", minLength: 1, maxLength: 160 },
        planVersion: { type: "integer", minimum: 1 },
        stepId: { type: "string", minLength: 1, maxLength: 80 },
        content: { type: "string", minLength: 1, maxLength: 4096 },
        sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
      },
      required: [
        "expectedStateVersion",
        "idempotencyKey",
        "planVersion",
        "stepId",
        "content",
        "sha256",
      ],
    },
    annotations: { readOnlyHint: false },
    async execute(input) {
      if (
        !hasExactToolKeys(input, [
          "expectedStateVersion",
          "idempotencyKey",
          "planVersion",
          "stepId",
          "content",
          "sha256",
        ]) ||
        !hasValidMutationEnvelope(input) ||
        !isBoundedNonBlankString(input.stepId, 80) ||
        !isBoundedNonBlankString(input.content, 4096)
      ) {
        return invalidToolInput("submit_artifact");
      }
      return dispatchAgentCommand("submit_artifact", {
        type: "SUBMIT_CANDIDATE",
        actor: "agent",
        expectedStateVersion: input.expectedStateVersion,
        idempotencyKey: input.idempotencyKey,
        planVersion: input.planVersion,
        stepId: input.stepId,
        content: input.content,
        sha256: input.sha256,
      });
    },
  };

  const requestCompletionTool: ToolDefinition = {
    name: "request_completion",
    title: "Request final owner acceptance",
    description:
      "Request completion for the exact active candidate after deterministic PASS. This does not accept the Goal.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        expectedStateVersion: { type: "integer", minimum: 0 },
        idempotencyKey: { type: "string", minLength: 1, maxLength: 160 },
        candidateSha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
      },
      required: [
        "expectedStateVersion",
        "idempotencyKey",
        "candidateSha256",
      ],
    },
    annotations: { readOnlyHint: false },
    async execute(input) {
      if (
        !hasExactToolKeys(input, [
          "expectedStateVersion",
          "idempotencyKey",
          "candidateSha256",
        ]) ||
        !hasValidMutationEnvelope(input)
      ) {
        return invalidToolInput("request_completion");
      }
      return dispatchAgentCommand("request_completion", {
        type: "REQUEST_COMPLETION",
        actor: "agent",
        expectedStateVersion: input.expectedStateVersion,
        idempotencyKey: input.idempotencyKey,
        candidateSha256: input.candidateSha256,
      });
    },
  };

  register(stateTool);
  register(proposePlanTool);
  register(claimStepTool);
  register(submitArtifactTool);
  register(requestCompletionTool);
  return {
    status: "registered",
    dispose: () => controller.abort(),
  };
}
