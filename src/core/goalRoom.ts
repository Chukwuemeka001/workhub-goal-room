export type Actor = "agent" | "owner" | "system";

export type PlanStep = {
  id: string;
  title: string;
};

export type PlanVersion = {
  version: number;
  status: "PROPOSED" | "CONFIRMED";
  proposedBy: Actor;
  steps: PlanStep[];
};

export type GoalRoomInput = {
  goal: string;
  doneLooksLike: string[];
};

export type GoalRoomState = {
  goal: string;
  doneLooksLike: string[];
  phase: "DRAFT" | "PLAN_PROPOSED" | "PLAN_CONFIRMED";
  stateVersion: number;
  activePlan: PlanVersion | null;
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

export type Command = ProposePlanCommand | ConfirmPlanCommand;
export type ReasonCode =
  | "OWNER_ONLY"
  | "PLAN_VERSION_MISMATCH"
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
  };
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
    return {
      ...state,
      phase: "PLAN_PROPOSED",
      stateVersion: state.stateVersion + 1,
      activePlan: {
        version: (state.activePlan?.version ?? 0) + 1,
        status: "PROPOSED",
        proposedBy: command.actor,
        steps: command.steps.map((step) => ({ ...step })),
      },
    };
  }

  if (
    command.actor !== "owner" ||
    state.activePlan?.status !== "PROPOSED" ||
    state.activePlan.version !== command.planVersion
  ) {
    throw new Error("REPLAY_AUTHORITY_MISMATCH");
  }

  return {
    ...state,
    phase: "PLAN_CONFIRMED",
    stateVersion: state.stateVersion + 1,
    activePlan: { ...state.activePlan, status: "CONFIRMED" },
  };
}

function nextLegalAction(state: GoalRoomState): string {
  if (state.phase === "DRAFT") return "AGENT_PROPOSE_PLAN";
  if (state.phase === "PLAN_PROPOSED") return "OWNER_CONFIRM_OR_REVISE_PLAN";
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

  return {
    accepted: true,
    stateVersion: state.stateVersion + 1,
    nextLegalAction: "OWNER_CONFIRM_OR_REVISE_PLAN",
    ownerRequired: true,
  };
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

  return {
    async dispatch(command: Command): Promise<DispatchResult> {
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

  for (const receipt of receipts) {
    const { hash, ...body } = receipt;
    if (
      receipt.previousHash !== previousHash ||
      (await sha256(body)) !== hash
    ) {
      throw new Error("RECEIPT_HASH_MISMATCH");
    }
    if (receipt.accepted) {
      state = applyAcceptedCommand(state, receipt.command);
      if (state.stateVersion !== receipt.stateVersion) {
        throw new Error("REPLAY_STATE_VERSION_MISMATCH");
      }
    } else if (state.stateVersion !== receipt.stateVersion) {
      throw new Error("REPLAY_STATE_VERSION_MISMATCH");
    }
    previousHash = hash;
  }

  return structuredClone(state);
}
