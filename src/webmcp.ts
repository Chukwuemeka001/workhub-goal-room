import {
  getGoalRoomFrontier,
  type Command,
  type DispatchResult,
  type GoalRoomState,
  type Receipt,
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

function isBoundedNonBlankString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}

function isBoundedUnicodeString(value: unknown, maxCodePoints: number): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  return normalized.length > 0 && Array.from(normalized).length <= maxCodePoints;
}

function isGoalList(value: unknown, allowEmpty: boolean): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 16 &&
    (allowEmpty || value.length >= 1) &&
    value.every((item) => isBoundedUnicodeString(item, 500))
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
  getReceipts?: () => Receipt[];
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
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      modelContext.registerTool(tool, controller.signal);
    }
  };
  const recordResult = (
    toolName: string,
    result: Record<string, unknown>,
  ) => {
    try {
      onInvocation({ toolName, result });
    } catch {
      // Reporting is observational and cannot obscure an authoritative result.
    }
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
      "Read a compact recovery-oriented projection of the current authority frontier without changing the room.",
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
      const frontier = getGoalRoomFrontier(state);
      const currentActor = frontier.nextLegalAction.startsWith("OWNER_")
        ? "owner"
        : frontier.nextLegalAction.startsWith("SYSTEM_")
          ? "system"
          : frontier.nextLegalAction.startsWith("AGENT_")
            ? "agent"
            : "none";
      const legalAgentActions = (() => {
        if (state.phase === "INTENT_DRAFT" && state.ownerIntent !== null) return ["propose_goal_contract"];
        if (state.phase === "GOAL_CONTRACT_REVISION_REQUESTED") return ["propose_goal_contract"];
        if (["GOAL_CONTRACT_CONFIRMED", "DRAFT", "PLAN_REVISION_REQUESTED"].includes(state.phase)) return ["propose_plan"];
        if (state.phase === "PLAN_CONFIRMED") return ["claim_step"];
        if (["STEP_CLAIMED", "VERIFICATION_FAILED"].includes(state.phase)) return ["submit_artifact"];
        if (state.phase === "VERIFICATION_PASSED") return ["request_completion"];
        return [];
      })();
      const recentRefusalReceipt = room.getReceipts?.().filter((receipt) => !receipt.accepted).at(-1);
      const goalContract = state.activeGoalContract === null
        ? null
        : structuredClone(state.activeGoalContract);
      const plan = state.activePlan === null
        ? null
        : structuredClone(state.activePlan);
      const claim = state.activeClaim === null ? null : { ...state.activeClaim };
      const candidate = state.activeCandidate === null ? null : {
        version: state.activeCandidate.version,
        digest: state.activeCandidate.sha256,
      };
      const verification = state.activeVerification === null ? null : {
        verdict: state.activeVerification.verdict,
        ruleSet: { id: state.activeVerification.ruleSetId, version: state.activeVerification.ruleSetVersion },
        findingCodes: [...state.activeVerification.findingCodes],
      };
      const completion = state.activeCompletionRequest === null ? null : { ...state.activeCompletionRequest };
      const acceptance = state.goalAcceptance === null ? null : {
        status: "ACCEPTED",
        candidateDigest: state.goalAcceptance.candidateSha256,
      };
      const result = {
        accepted: true,
        readOnly: true,
        currentStateVersion: state.stateVersion,
        phase: state.phase,
        ownerIntent: state.ownerIntent,
        goalContract,
        goalRevisionRequest: state.activeGoalContract?.revisionRequest
          ? { ...state.activeGoalContract.revisionRequest }
          : null,
        plan,
        planRevisionRequest: state.activePlan?.revisionRequest
          ? { ...state.activePlan.revisionRequest }
          : null,
        currentActor,
        legalAgentActions,
        ...frontier,
        claim,
        candidate,
        verification,
        completion,
        acceptance,
        recentRefusal: recentRefusalReceipt === undefined ? null : {
          reasonCode: recentRefusalReceipt.reasonCode,
          missingConditions: [...(recentRefusalReceipt.missingConditions ?? [])],
        },
        state: structuredClone(state),
      };
      return recordResult("get_goal_room_state", result);
    },
  };
  const proposeGoalContractTool: ToolDefinition = {
    name: "propose_goal_contract",
    title: "Propose an immutable Goal Contract",
    description:
      "Propose Goal Contract data as the agent after owner intent or an owner revision request. Bounds use trimmed Unicode code points, matching JSON Schema maxLength. This never confirms the Goal or authorizes Plan work; the owner must confirm or request revision.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        expectedStateVersion: { type: "integer", minimum: 0 },
        idempotencyKey: { type: "string", minLength: 1, maxLength: 160 },
        goal: { type: "string", minLength: 1, maxLength: 1000 },
        why: { type: "string", minLength: 1, maxLength: 1000 },
        doneLooksLike: { type: "array", minItems: 1, maxItems: 16, items: { type: "string", minLength: 1, maxLength: 500 } },
        constraints: { type: "array", minItems: 0, maxItems: 16, items: { type: "string", minLength: 1, maxLength: 500 } },
        nonGoals: { type: "array", minItems: 0, maxItems: 16, items: { type: "string", minLength: 1, maxLength: 500 } },
        evidenceRequired: { type: "array", minItems: 1, maxItems: 16, items: { type: "string", minLength: 1, maxLength: 500 } },
        openQuestions: { type: "array", minItems: 0, maxItems: 16, items: { type: "string", minLength: 1, maxLength: 500 } },
      },
      required: [
        "expectedStateVersion", "idempotencyKey", "goal", "why", "doneLooksLike",
        "constraints", "nonGoals", "evidenceRequired", "openQuestions",
      ],
    },
    annotations: { readOnlyHint: false, consequentialHint: false, untrustedContentHint: true },
    async execute(input) {
      const keys = [
        "expectedStateVersion", "idempotencyKey", "goal", "why", "doneLooksLike",
        "constraints", "nonGoals", "evidenceRequired", "openQuestions",
      ];
      if (
        !hasExactToolKeys(input, keys) ||
        !hasValidMutationEnvelope(input) ||
        !isBoundedUnicodeString(input.goal, 1000) ||
        !isBoundedUnicodeString(input.why, 1000) ||
        !isGoalList(input.doneLooksLike, false) ||
        !isGoalList(input.constraints, true) ||
        !isGoalList(input.nonGoals, true) ||
        !isGoalList(input.evidenceRequired, false) ||
        !isGoalList(input.openQuestions, true)
      ) {
        return invalidToolInput("propose_goal_contract");
      }
      return dispatchAgentCommand("propose_goal_contract", {
        type: "PROPOSE_GOAL_CONTRACT",
        actor: "agent",
        expectedStateVersion: input.expectedStateVersion,
        idempotencyKey: input.idempotencyKey,
        goal: input.goal,
        why: input.why,
        doneLooksLike: input.doneLooksLike,
        constraints: input.constraints,
        nonGoals: input.nonGoals,
        evidenceRequired: input.evidenceRequired,
        openQuestions: input.openQuestions,
      });
    },
  };
  const proposePlanTool: ToolDefinition = {
    name: "propose_plan",
    title: "Propose an immutable Goal Plan",
    description:
      "Propose a versioned Plan as the agent. In GOAL_CONTRACT_CONFIRMED, pass the exact goalContractVersion exposed by get_goal_room_state; legacy DRAFT and PLAN_REVISION_REQUESTED calls may omit it. This never confirms the Plan; the owner must confirm or request revision.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        expectedStateVersion: { type: "integer", minimum: 0 },
        idempotencyKey: { type: "string", minLength: 1, maxLength: 160 },
        goalContractVersion: { type: "integer", minimum: 1 },
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
      const exactShape =
        hasExactToolKeys(input, ["expectedStateVersion", "idempotencyKey", "steps"]) ||
        hasExactToolKeys(input, [
          "expectedStateVersion", "idempotencyKey", "goalContractVersion", "steps",
        ]);
      if (
        !exactShape ||
        !hasValidMutationEnvelope(input) ||
        (input.goalContractVersion !== undefined &&
          (!Number.isSafeInteger(input.goalContractVersion) || input.goalContractVersion < 1)) ||
        !Array.isArray(input.steps) ||
        input.steps.length < 1 ||
        input.steps.length > 8 ||
        !input.steps.every(isValidPlanStep)
      ) {
        return invalidToolInput("propose_plan");
      }
      if (
        room.getState().phase === "GOAL_CONTRACT_CONFIRMED" &&
        input.goalContractVersion === undefined
      ) {
        return invalidToolInput("propose_plan");
      }
      return dispatchAgentCommand("propose_plan", {
        type: "PROPOSE_PLAN",
        actor: "agent",
        expectedStateVersion: input.expectedStateVersion,
        idempotencyKey: input.idempotencyKey,
        ...(input.goalContractVersion === undefined
          ? {}
          : { goalContractVersion: input.goalContractVersion }),
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

  try {
    register(stateTool);
    register(proposeGoalContractTool);
    register(proposePlanTool);
    register(claimStepTool);
    register(submitArtifactTool);
    register(requestCompletionTool);
  } catch (error) {
    controller.abort();
    throw error;
  }
  return {
    status: "registered",
    dispose: () => controller.abort(),
  };
}
