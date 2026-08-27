export type Actor = "agent" | "owner" | "system";

export type PlanStep = {
  id: string;
  title: string;
};

export type PlanVersion = {
  version: number;
  status: "PROPOSED" | "REVISION_REQUESTED" | "CONFIRMED";
  proposedBy: Actor;
  steps: PlanStep[];
  revisionRequest?: {
    requestedBy: "owner";
    note: string;
  };
};

export type GoalRoomInput = {
  goal: string;
  doneLooksLike: string[];
};

export type GoalRoomState = {
  goal: string;
  doneLooksLike: string[];
  phase:
    | "DRAFT"
    | "PLAN_PROPOSED"
    | "PLAN_REVISION_REQUESTED"
    | "PLAN_CONFIRMED";
  stateVersion: number;
  activePlan: PlanVersion | null;
  planHistory: PlanVersion[];
};

export type ProposePlanCommand = {
  type: "PROPOSE_PLAN";
  actor: Actor;
  expectedStateVersion: number;
  idempotencyKey: string;
  steps: PlanStep[];
};

export type ConfirmPlanCommand = {
  type: "CONFIRM_PLAN";
  actor: Actor;
  expectedStateVersion: number;
  idempotencyKey: string;
  planVersion: number;
};

export type RequestPlanRevisionCommand = {
  type: "REQUEST_PLAN_REVISION";
  actor: Actor;
  expectedStateVersion: number;
  idempotencyKey: string;
  planVersion: number;
  note: string;
};

export type Command =
  | ProposePlanCommand
  | ConfirmPlanCommand
  | RequestPlanRevisionCommand;
export type ReasonCode =
  | "OWNER_ONLY"
  | "PLAN_VERSION_MISMATCH"
  | "PLAN_PROPOSAL_NOT_ALLOWED"
  | "STALE_STATE";

export type DispatchResult = {
  accepted: boolean;
  reasonCode?: ReasonCode;
  stateVersion: number;
  nextLegalAction: string;
  ownerRequired: boolean;
};

export type Receipt = {
  sequence: number;
  previousHash: string;
  hash: string;
  command: Command;
  accepted: boolean;
  reasonCode?: ReasonCode;
  stateVersion: number;
};

function initialState(input: GoalRoomInput): GoalRoomState {
  return {
    goal: input.goal,
    doneLooksLike: [...input.doneLooksLike],
    phase: "DRAFT",
    stateVersion: 0,
    activePlan: null,
    planHistory: [],
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(record: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validateCommand(value: unknown): asserts value is Command {
  if (!isPlainRecord(value)) throw new Error("INVALID_COMMAND");
  const commonValid =
    Number.isSafeInteger(value.expectedStateVersion) &&
    (value.expectedStateVersion as number) >= 0 &&
    typeof value.idempotencyKey === "string" &&
    value.idempotencyKey.trim().length > 0 &&
    (value.actor === "agent" || value.actor === "owner" || value.actor === "system");
  if (!commonValid) throw new Error("INVALID_COMMAND");

  if (value.type === "PROPOSE_PLAN") {
    if (
      !hasExactKeys(value, ["type", "actor", "expectedStateVersion", "idempotencyKey", "steps"]) ||
      value.actor !== "agent" ||
      !Array.isArray(value.steps) ||
      value.steps.length === 0
    ) {
      throw new Error("INVALID_COMMAND");
    }
    const ids = new Set<string>();
    for (const step of value.steps) {
      if (
        !isPlainRecord(step) ||
        !hasExactKeys(step, ["id", "title"]) ||
        typeof step.id !== "string" ||
        step.id.trim().length === 0 ||
        typeof step.title !== "string" ||
        step.title.trim().length === 0 ||
        ids.has(step.id)
      ) {
        throw new Error("INVALID_COMMAND");
      }
      ids.add(step.id);
    }
    return;
  }

  if (value.type === "REQUEST_PLAN_REVISION") {
    if (
      !hasExactKeys(value, [
        "type",
        "actor",
        "expectedStateVersion",
        "idempotencyKey",
        "planVersion",
        "note",
      ]) ||
      !Number.isSafeInteger(value.planVersion) ||
      (value.planVersion as number) < 1 ||
      typeof value.note !== "string" ||
      value.note.trim().length === 0
    ) {
      throw new Error("INVALID_COMMAND");
    }
    return;
  }

  if (
    value.type !== "CONFIRM_PLAN" ||
    !hasExactKeys(value, ["type", "actor", "expectedStateVersion", "idempotencyKey", "planVersion"]) ||
    !Number.isSafeInteger(value.planVersion) ||
    (value.planVersion as number) < 1
  ) {
    throw new Error("INVALID_COMMAND");
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function applyAcceptedCommand(
  state: GoalRoomState,
  command: Command,
): GoalRoomState {
  if (command.type === "PROPOSE_PLAN") {
    const plan: PlanVersion = {
      version: state.planHistory.length + 1,
      status: "PROPOSED",
      proposedBy: command.actor,
      steps: command.steps.map((step) => ({ ...step })),
    };
    return {
      ...state,
      phase: "PLAN_PROPOSED",
      stateVersion: state.stateVersion + 1,
      activePlan: plan,
      planHistory: [...state.planHistory, plan],
    };
  }

  if (command.type === "REQUEST_PLAN_REVISION") {
    if (
      command.actor !== "owner" ||
      state.activePlan?.status !== "PROPOSED" ||
      state.activePlan.version !== command.planVersion
    ) {
      throw new Error("REPLAY_AUTHORITY_MISMATCH");
    }
    const revisedPlan: PlanVersion = {
      ...state.activePlan,
      status: "REVISION_REQUESTED",
      revisionRequest: {
        requestedBy: "owner",
        note: command.note.trim(),
      },
    };
    return {
      ...state,
      phase: "PLAN_REVISION_REQUESTED",
      stateVersion: state.stateVersion + 1,
      activePlan: revisedPlan,
      planHistory: state.planHistory.map((plan) =>
        plan.version === revisedPlan.version ? revisedPlan : plan,
      ),
    };
  }

  if (
    command.actor !== "owner" ||
    state.activePlan?.status !== "PROPOSED" ||
    state.activePlan.version !== command.planVersion
  ) {
    throw new Error("REPLAY_AUTHORITY_MISMATCH");
  }

  const confirmedPlan: PlanVersion = {
    ...state.activePlan,
    status: "CONFIRMED",
  };
  return {
    ...state,
    phase: "PLAN_CONFIRMED",
    stateVersion: state.stateVersion + 1,
    activePlan: confirmedPlan,
    planHistory: state.planHistory.map((plan) =>
      plan.version === confirmedPlan.version ? confirmedPlan : plan,
    ),
  };
}

function nextLegalAction(state: GoalRoomState): string {
  if (state.phase === "DRAFT") return "AGENT_PROPOSE_PLAN";
  if (state.phase === "PLAN_PROPOSED") return "OWNER_CONFIRM_OR_REVISE_PLAN";
  if (state.phase === "PLAN_REVISION_REQUESTED") return "AGENT_PROPOSE_REVISED_PLAN";
  return "AGENT_CLAIM_OPEN_STEP";
}

function evaluate(state: GoalRoomState, command: Command): DispatchResult {
  if (command.expectedStateVersion !== state.stateVersion) {
    return {
      accepted: false,
      reasonCode: "STALE_STATE",
      stateVersion: state.stateVersion,
      nextLegalAction: nextLegalAction(state),
      ownerRequired: state.phase === "PLAN_PROPOSED",
    };
  }

  if (command.type === "REQUEST_PLAN_REVISION") {
    if (command.actor !== "owner") {
      return {
        accepted: false,
        reasonCode: "OWNER_ONLY",
        stateVersion: state.stateVersion,
        nextLegalAction: "OWNER_CONFIRM_OR_REVISE_PLAN",
        ownerRequired: true,
      };
    }
    if (
      state.activePlan?.status !== "PROPOSED" ||
      state.activePlan.version !== command.planVersion
    ) {
      return {
        accepted: false,
        reasonCode: "PLAN_VERSION_MISMATCH",
        stateVersion: state.stateVersion,
        nextLegalAction: nextLegalAction(state),
        ownerRequired: state.phase === "PLAN_PROPOSED",
      };
    }
    return {
      accepted: true,
      stateVersion: state.stateVersion + 1,
      nextLegalAction: "AGENT_PROPOSE_REVISED_PLAN",
      ownerRequired: false,
    };
  }

  if (command.type === "CONFIRM_PLAN") {
    if (command.actor !== "owner") {
      return {
        accepted: false,
        reasonCode: "OWNER_ONLY",
        stateVersion: state.stateVersion,
        nextLegalAction: "OWNER_CONFIRM_OR_REVISE_PLAN",
        ownerRequired: true,
      };
    }
    if (
      state.activePlan?.status !== "PROPOSED" ||
      state.activePlan.version !== command.planVersion
    ) {
      return {
        accepted: false,
        reasonCode: "PLAN_VERSION_MISMATCH",
        stateVersion: state.stateVersion,
        nextLegalAction: "OWNER_CONFIRM_OR_REVISE_PLAN",
        ownerRequired: true,
      };
    }
    return {
      accepted: true,
      stateVersion: state.stateVersion + 1,
      nextLegalAction: "AGENT_CLAIM_OPEN_STEP",
      ownerRequired: false,
    };
  }

  if (command.type === "PROPOSE_PLAN") {
    if (
      state.phase !== "DRAFT" &&
      state.phase !== "PLAN_REVISION_REQUESTED"
    ) {
      return {
        accepted: false,
        reasonCode: "PLAN_PROPOSAL_NOT_ALLOWED",
        stateVersion: state.stateVersion,
        nextLegalAction: nextLegalAction(state),
        ownerRequired: state.phase === "PLAN_PROPOSED",
      };
    }
    return {
      accepted: true,
      stateVersion: state.stateVersion + 1,
      nextLegalAction: "OWNER_CONFIRM_OR_REVISE_PLAN",
      ownerRequired: true,
    };
  }

  throw new Error("INVALID_COMMAND");
}

async function makeReceipt(
  receipts: Receipt[],
  command: Command,
  result: DispatchResult,
): Promise<Receipt> {
  const body = {
    sequence: receipts.length + 1,
    previousHash: receipts.at(-1)?.hash ?? "GENESIS",
    command: structuredClone(command),
    accepted: result.accepted,
    ...(result.reasonCode ? { reasonCode: result.reasonCode } : {}),
    stateVersion: result.stateVersion,
  };
  return { ...body, hash: await sha256(body) };
}

export function createGoalRoom(input: GoalRoomInput) {
  let state = initialState(input);
  const receipts: Receipt[] = [];
  const idempotency = new Map<
    string,
    { command: string; result: DispatchResult }
  >();

  let dispatchTail: Promise<void> = Promise.resolve();

  async function dispatchOnce(command: Command): Promise<DispatchResult> {
    validateCommand(command);
    const commandValue = canonical(command);
    const prior = idempotency.get(command.idempotencyKey);
    if (prior) {
      if (prior.command !== commandValue) {
        throw new Error("IDEMPOTENCY_KEY_REUSE");
      }
      return structuredClone(prior.result);
    }

    const result = evaluate(state, command);
    if (result.accepted) {
      state = applyAcceptedCommand(state, command);
    }
    receipts.push(await makeReceipt(receipts, command, result));
    idempotency.set(command.idempotencyKey, {
      command: commandValue,
      result: structuredClone(result),
    });
    return structuredClone(result);
  }

  return {
    dispatch(command: Command): Promise<DispatchResult> {
      let snapshot: Command;
      try {
        snapshot = structuredClone(command);
      } catch {
        return Promise.reject(new Error("INVALID_COMMAND"));
      }
      const operation = dispatchTail.then(() => dispatchOnce(snapshot));
      dispatchTail = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
    getState(): GoalRoomState {
      return structuredClone(state);
    },
    getReceipts(): Receipt[] {
      return structuredClone(receipts);
    },
  };
}

export async function replayGoalRoom(
  input: GoalRoomInput,
  receipts: Receipt[],
): Promise<GoalRoomState> {
  let state = initialState(input);
  let previousHash = "GENESIS";
  const idempotency = new Map<string, string>();

  for (const [index, receipt] of receipts.entries()) {
    const { hash, ...body } = receipt;
    if (
      receipt.sequence !== index + 1 ||
      !Number.isSafeInteger(receipt.sequence)
    ) {
      throw new Error("RECEIPT_SEQUENCE_MISMATCH");
    }
    if (
      receipt.previousHash !== previousHash ||
      (await sha256(body)) !== hash
    ) {
      throw new Error("RECEIPT_HASH_MISMATCH");
    }

    validateCommand(receipt.command);
    const commandValue = canonical(receipt.command);
    const priorCommand = idempotency.get(receipt.command.idempotencyKey);
    if (priorCommand !== undefined) {
      if (priorCommand !== commandValue) {
        throw new Error("IDEMPOTENCY_KEY_REUSE");
      }
      throw new Error("REPLAY_DUPLICATE_IDEMPOTENCY");
    }

    const expected = evaluate(state, receipt.command);
    if (
      receipt.accepted !== expected.accepted ||
      receipt.reasonCode !== expected.reasonCode ||
      receipt.stateVersion !== expected.stateVersion
    ) {
      throw new Error("REPLAY_OUTCOME_MISMATCH");
    }

    if (expected.accepted) {
      state = applyAcceptedCommand(state, receipt.command);
    }
    idempotency.set(receipt.command.idempotencyKey, commandValue);
    previousHash = hash;
  }

  return structuredClone(state);
}
