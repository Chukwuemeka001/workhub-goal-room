import { createReleaseGuardianEnvelope } from "./verifier/releaseRules";
import { describe, expect, it, vi } from "vitest";
import { createGoalRoom, type GoalRoomState } from "./core/goalRoom";
import { installGoalRoomTools } from "./webmcp";

const contract = {
  goal: "Publish a governed release",
  why: "Make the authority boundary recoverable.",
  doneLooksLike: ["Owner can inspect exact evidence"],
  constraints: ["No external effects"],
  nonGoals: ["Account creation"],
  evidenceRequired: ["Deterministic PASS"],
  openQuestions: ["Which public URL?"],
};

function installed(room = createGoalRoom({ ownerIntent: "Build a governed release." })) {
  const registerTool = vi.fn();
  installGoalRoomTools({
    documentLike: { modelContext: { registerTool } },
    navigatorLike: {},
    room,
    onInvocation: vi.fn(),
  });
  return {
    room,
    definitions: registerTool.mock.calls.map(([definition]) => definition),
    tools: new Map<string, any>(
      registerTool.mock.calls.map(([definition]) => [definition.name, definition]),
    ),
  };
}

async function digestText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function confirmedGoalRoom() {
  const setup = installed();
  await setup.tools.get("propose_goal_contract").execute({
    expectedStateVersion: 0,
    idempotencyKey: "goal-v1",
    ...contract,
  });
  await setup.room.dispatch({
    type: "CONFIRM_GOAL_CONTRACT",
    actor: "owner",
    expectedStateVersion: 1,
    idempotencyKey: "confirm-goal-v1",
    goalContractVersion: 1,
  });
  return setup;
}

function mutateEveryNestedContainer(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) mutateEveryNestedContainer(item, seen);
    value.push("tampered");
    return;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    mutateEveryNestedContainer(nested, seen);
  }
  (value as Record<string, unknown>).__tampered = true;
}

async function expectStateParity(tools: Map<string, any>, room: ReturnType<typeof createGoalRoom>) {
  const result = await tools.get("get_goal_room_state").execute({});
  expect(result.state).toEqual(room.getState());
  return result;
}

describe("Phase 7 repair round 1", () => {
  it("binds propose_plan to the confirmed Goal version through the real state/tool/kernel/owner-gate path", async () => {
    const { room, tools, definitions } = await confirmedGoalRoom();
    const descriptor = definitions.find(({ name }) => name === "propose_plan");
    expect(descriptor).toMatchObject({
      description: expect.stringContaining("goalContractVersion"),
      inputSchema: {
        additionalProperties: false,
        properties: { goalContractVersion: { type: "integer", minimum: 1 } },
        required: ["expectedStateVersion", "idempotencyKey", "steps"],
      },
    });

    const recovered = await tools.get("get_goal_room_state").execute({});
    expect(recovered).toMatchObject({
      phase: "GOAL_CONTRACT_CONFIRMED",
      currentStateVersion: 2,
      goalContract: { version: 1, status: "CONFIRMED" },
      legalAgentActions: ["propose_plan"],
      nextLegalAction: "AGENT_PROPOSE_PLAN",
    });

    const base = {
      expectedStateVersion: 2,
      steps: [{ id: "build", title: "Build exact evidence" }],
    };
    for (const [idempotencyKey, version] of [
      ["missing-goal-version", undefined],
      ["string-goal-version", "1"],
      ["zero-goal-version", 0],
      ["fraction-goal-version", 1.5],
    ] as const) {
      const result = await tools.get("propose_plan").execute({
        ...base,
        idempotencyKey,
        ...(version === undefined ? {} : { goalContractVersion: version }),
      });
      expect(result).toMatchObject({
        accepted: false,
        reasonCode: "INVALID_TOOL_INPUT",
        currentStateVersion: 2,
        nextLegalAction: "AGENT_PROPOSE_PLAN",
      });
    }
    expect(room.getReceipts()).toHaveLength(2);

    const mismatch = await tools.get("propose_plan").execute({
      ...base,
      idempotencyKey: "wrong-goal-version",
      goalContractVersion: 2,
    });
    expect(mismatch).toMatchObject({
      accepted: false,
      reasonCode: "GOAL_VERSION_MISMATCH",
      currentStateVersion: 2,
      nextLegalAction: "AGENT_PROPOSE_PLAN",
    });
    expect(room.getReceipts()).toHaveLength(3);
    expect(room.getReceipts().at(-1)?.command).toMatchObject({
      type: "PROPOSE_PLAN",
      goalContractVersion: 2,
    });

    const input = {
      ...base,
      idempotencyKey: "plan-v1-goal-v1",
      goalContractVersion: recovered.goalContract.version,
    };
    const accepted = await tools.get("propose_plan").execute(input);
    expect(accepted).toMatchObject({
      accepted: true,
      currentStateVersion: 3,
      nextLegalAction: "OWNER_CONFIRM_OR_REVISE_PLAN",
      ownerRequired: true,
    });
    expect(await tools.get("propose_plan").execute(structuredClone(input))).toEqual(accepted);
    expect(room.getState().activePlan).toMatchObject({
      version: 1,
      goalContractVersion: 1,
      status: "PROPOSED",
    });
    expect(room.getReceipts()).toHaveLength(4);
  });

  it("preserves legacy three-key Plan calls in DRAFT and PLAN_REVISION_REQUESTED with revision-bound v2", async () => {
    const room = createGoalRoom({
      goal: "Ship a governed release",
      doneLooksLike: ["Owner accepts evidence"],
    });
    const { tools } = installed(room);
    expect(await tools.get("propose_plan").execute({
      expectedStateVersion: 0,
      idempotencyKey: "legacy-plan-v1",
      steps: [{ id: "build", title: "Build" }],
    })).toMatchObject({ accepted: true, currentStateVersion: 1 });
    await room.dispatch({
      type: "REQUEST_PLAN_REVISION",
      actor: "owner",
      expectedStateVersion: 1,
      idempotencyKey: "revise-plan-v1",
      planVersion: 1,
      note: "Add owner-visible proof.",
    });
    const revised = {
      expectedStateVersion: 2,
      idempotencyKey: "legacy-plan-v2",
      steps: [{ id: "build", title: "Build owner-visible proof" }],
    };
    const accepted = await tools.get("propose_plan").execute(revised);
    expect(accepted).toMatchObject({ accepted: true, currentStateVersion: 3 });
    expect(await tools.get("propose_plan").execute(structuredClone(revised))).toEqual(accepted);
    expect(room.getState().activePlan).toMatchObject({
      version: 2,
      goalContractVersion: 1,
      steps: revised.steps,
    });
    expect(room.getReceipts()).toHaveLength(3);
  });

  it("returns the full backward-compatible state plus complete recovery fields through revisions and refusals", async () => {
    const { room, tools } = installed();
    const lifecycle: GoalRoomState["phase"][] = [];
    lifecycle.push((await expectStateParity(tools, room)).phase);

    await tools.get("propose_goal_contract").execute({ expectedStateVersion: 0, idempotencyKey: "goal-v1", ...contract });
    let recovery = await expectStateParity(tools, room);
    lifecycle.push(recovery.phase);
    expect(recovery.goalContract).toEqual(room.getState().activeGoalContract);

    await room.dispatch({
      type: "REQUEST_GOAL_REVISION", actor: "owner", expectedStateVersion: 1,
      idempotencyKey: "revise-goal-v1", goalContractVersion: 1, note: "Resolve the URL question.",
    });
    recovery = await expectStateParity(tools, room);
    lifecycle.push(recovery.phase);
    expect(recovery.goalRevisionRequest).toEqual({ requestedBy: "owner", note: "Resolve the URL question." });
    expect(recovery.ownerIntent).toBe("Build a governed release.");

    await tools.get("propose_goal_contract").execute({
      expectedStateVersion: 2, idempotencyKey: "goal-v2", ...contract, openQuestions: [],
    });
    lifecycle.push((await expectStateParity(tools, room)).phase);
    await room.dispatch({
      type: "CONFIRM_GOAL_CONTRACT", actor: "owner", expectedStateVersion: 3,
      idempotencyKey: "confirm-goal-v2", goalContractVersion: 2,
    });
    recovery = await expectStateParity(tools, room);
    lifecycle.push(recovery.phase);
    expect(recovery.goalContract).toEqual(room.getState().activeGoalContract);

    await tools.get("propose_plan").execute({
      expectedStateVersion: 4, idempotencyKey: "plan-v1", goalContractVersion: 2,
      steps: [{ id: "build", title: "Build exact evidence" }],
    });
    recovery = await expectStateParity(tools, room);
    lifecycle.push(recovery.phase);
    expect(recovery.plan).toEqual(room.getState().activePlan);

    await room.dispatch({
      type: "REQUEST_PLAN_REVISION", actor: "owner", expectedStateVersion: 5,
      idempotencyKey: "revise-plan-v1", planVersion: 1, note: "Expose the proof command.",
    });
    recovery = await expectStateParity(tools, room);
    lifecycle.push(recovery.phase);
    expect(recovery.planRevisionRequest).toEqual({ requestedBy: "owner", note: "Expose the proof command." });

    await tools.get("propose_plan").execute({
      expectedStateVersion: 6, idempotencyKey: "plan-v2", goalContractVersion: 2,
      steps: [{ id: "build", title: "Build proof" }, { id: "verify", title: "Run proof command" }],
    });
    lifecycle.push((await expectStateParity(tools, room)).phase);
    await room.dispatch({
      type: "CONFIRM_PLAN", actor: "owner", expectedStateVersion: 7,
      idempotencyKey: "confirm-plan-v2", planVersion: 2,
    });
    recovery = await expectStateParity(tools, room);
    lifecycle.push(recovery.phase);
    expect(recovery.plan).toEqual(room.getState().activePlan);
    expect(recovery.plan.steps).toEqual([
      { id: "build", title: "Build proof" }, { id: "verify", title: "Run proof command" },
    ]);

    await room.dispatch({
      type: "CLAIM_STEP", actor: "agent", expectedStateVersion: 8,
      idempotencyKey: "claim-build", planVersion: 2, stepId: "build",
    });
    recovery = await expectStateParity(tools, room);
    lifecycle.push(recovery.phase);
    expect(recovery.claim).toEqual({ planVersion: 2, stepId: "build", claimedBy: "agent" });

    const refused = await tools.get("propose_plan").execute({
      expectedStateVersion: 9, idempotencyKey: "illegal-plan-v3", goalContractVersion: 2,
      steps: [{ id: "x", title: "Not legal now" }],
    });
    expect(refused).toMatchObject({ accepted: false, reasonCode: "PLAN_PROPOSAL_NOT_ALLOWED" });
    recovery = await expectStateParity(tools, room);
    expect(recovery.recentRefusal).toEqual({ reasonCode: "PLAN_PROPOSAL_NOT_ALLOWED", missingConditions: [] });

    const content = createReleaseGuardianEnvelope();
    const sha256 = await digestText(content);
    await tools.get("submit_artifact").execute({
      expectedStateVersion: 9, idempotencyKey: "candidate-v1", planVersion: 2,
      stepId: "build", content, sha256,
    });
    lifecycle.push((await expectStateParity(tools, room)).phase);
    await room.verifyActiveCandidate("verify-v1");
    lifecycle.push((await expectStateParity(tools, room)).phase);
    await tools.get("request_completion").execute({
      expectedStateVersion: 11, idempotencyKey: "completion-v1", candidateSha256: sha256,
    });
    lifecycle.push((await expectStateParity(tools, room)).phase);
    await room.dispatch({
      type: "ACCEPT_GOAL", actor: "owner", expectedStateVersion: 12,
      idempotencyKey: "accept-v1", candidateSha256: sha256,
    });
    lifecycle.push((await expectStateParity(tools, room)).phase);

    expect(lifecycle).toEqual([
      "INTENT_DRAFT", "GOAL_CONTRACT_PROPOSED", "GOAL_CONTRACT_REVISION_REQUESTED",
      "GOAL_CONTRACT_PROPOSED", "GOAL_CONTRACT_CONFIRMED", "PLAN_PROPOSED",
      "PLAN_REVISION_REQUESTED", "PLAN_PROPOSED", "PLAN_CONFIRMED", "STEP_CLAIMED",
      "CANDIDATE_SUBMITTED", "VERIFICATION_PASSED", "COMPLETION_REQUESTED", "GOAL_ACCEPTED",
    ]);

    const failedRoom = createGoalRoom({ goal: "Reject invalid evidence", doneLooksLike: ["PASS"] });
    const failed = installed(failedRoom);
    await failedRoom.dispatch({
      type: "PROPOSE_PLAN", actor: "agent", expectedStateVersion: 0,
      idempotencyKey: "failed-plan", steps: [{ id: "build", title: "Build" }],
    });
    await failedRoom.dispatch({
      type: "CONFIRM_PLAN", actor: "owner", expectedStateVersion: 1,
      idempotencyKey: "failed-confirm", planVersion: 1,
    });
    await failedRoom.dispatch({
      type: "CLAIM_STEP", actor: "agent", expectedStateVersion: 2,
      idempotencyKey: "failed-claim", planVersion: 1, stepId: "build",
    });
    const invalidContent = "{}";
    await failedRoom.dispatch({
      type: "SUBMIT_CANDIDATE", actor: "agent", expectedStateVersion: 3,
      idempotencyKey: "failed-candidate", planVersion: 1, stepId: "build",
      content: invalidContent, sha256: await digestText(invalidContent),
    });
    await failedRoom.verifyActiveCandidate("failed-verify");
    expect((await expectStateParity(failed.tools, failedRoom)).phase).toBe("VERIFICATION_FAILED");
  });

  it("defensively clones every nested recovery list and object", async () => {
    const { room, tools } = await confirmedGoalRoom();
    await tools.get("propose_plan").execute({
      expectedStateVersion: 2, idempotencyKey: "plan-v1", goalContractVersion: 1,
      steps: [{ id: "build", title: "Build exact evidence" }],
    });
    await room.dispatch({
      type: "REQUEST_PLAN_REVISION", actor: "owner", expectedStateVersion: 3,
      idempotencyKey: "revise-plan", planVersion: 1, note: "Show proof.",
    });
    const authoritative = room.getState();
    const recovery = await tools.get("get_goal_room_state").execute({});
    mutateEveryNestedContainer(recovery.state);
    mutateEveryNestedContainer(recovery.goalContract);
    mutateEveryNestedContainer(recovery.plan);
    mutateEveryNestedContainer(recovery.goalRevisionRequest);
    mutateEveryNestedContainer(recovery.planRevisionRequest);
    mutateEveryNestedContainer(recovery.legalAgentActions);
    expect(room.getState()).toEqual(authoritative);
  });

  it("rejects schema-invalid raw-padded Goal fields before the WebMCP callback mutates authority", async () => {
    const rawPadded1002 = ` ${"🙂".repeat(1000)} `;
    expect(Array.from(rawPadded1002)).toHaveLength(1002);

    for (const field of ["goal", "why"] as const) {
      const { room, tools, definitions } = installed();
      const descriptor = definitions.find(({ name }) => name === "propose_goal_contract");
      expect(descriptor.inputSchema.properties[field]).toEqual({
        type: "string", minLength: 1, maxLength: 1000,
      });
      const before = room.getState();
      expect(await tools.get("propose_goal_contract").execute({
        expectedStateVersion: 0, idempotencyKey: `raw-padded-${field}`, ...contract,
        [field]: rawPadded1002,
      })).toMatchObject({
        accepted: false, reasonCode: "INVALID_TOOL_INPUT", currentStateVersion: 0,
      });
      expect(room.getState()).toEqual(before);
      expect(room.getReceipts()).toEqual([]);
    }
  });

  it("rejects schema-invalid raw-padded items in every Goal list before WebMCP dispatch", async () => {
    const rawPadded502 = ` ${"🙂".repeat(500)} `;
    expect(Array.from(rawPadded502)).toHaveLength(502);

    for (const field of [
      "doneLooksLike", "constraints", "nonGoals", "evidenceRequired", "openQuestions",
    ] as const) {
      const { room, tools, definitions } = installed();
      const descriptor = definitions.find(({ name }) => name === "propose_goal_contract");
      expect(descriptor.inputSchema.properties[field].items.maxLength).toBe(500);
      const before = room.getState();
      expect(await tools.get("propose_goal_contract").execute({
        expectedStateVersion: 0, idempotencyKey: `raw-padded-${field}`, ...contract,
        [field]: [rawPadded502],
      })).toMatchObject({
        accepted: false, reasonCode: "INVALID_TOOL_INPUT", currentStateVersion: 0,
      });
      expect(room.getState()).toEqual(before);
      expect(room.getReceipts()).toEqual([]);
    }
  });

  it("rejects raw-padded over-bound Goal fields in the direct kernel without mutation", async () => {
    const rawPadded1002 = ` ${"🙂".repeat(1000)} `;
    for (const field of ["goal", "why"] as const) {
      const room = createGoalRoom({ ownerIntent: "Direct kernel parity." });
      const before = room.getState();
      await expect(room.dispatch({
        type: "PROPOSE_GOAL_CONTRACT", actor: "agent", expectedStateVersion: 0,
        idempotencyKey: `direct-raw-padded-${field}`, ...contract, [field]: rawPadded1002,
      })).rejects.toThrow("INVALID_COMMAND");
      expect(room.getState()).toEqual(before);
      expect(room.getReceipts()).toEqual([]);
    }
  });

  it("rejects raw-padded over-bound items in every direct-kernel Goal list", async () => {
    const rawPadded502 = ` ${"🙂".repeat(500)} `;
    for (const field of [
      "doneLooksLike", "constraints", "nonGoals", "evidenceRequired", "openQuestions",
    ] as const) {
      const room = createGoalRoom({ ownerIntent: "Direct kernel list parity." });
      const before = room.getState();
      await expect(room.dispatch({
        type: "PROPOSE_GOAL_CONTRACT", actor: "agent", expectedStateVersion: 0,
        idempotencyKey: `direct-raw-padded-${field}`, ...contract, [field]: [rawPadded502],
      })).rejects.toThrow("INVALID_COMMAND");
      expect(room.getState()).toEqual(before);
      expect(room.getReceipts()).toEqual([]);
    }
  });

  it("counts raw Unicode code points at every Goal boundary, then stores canonical trimmed values", async () => {
    const exactRaw1000 = ` ${"🙂".repeat(998)} `;
    const exactRaw500 = ` ${"🙂".repeat(498)} `;
    const acceptedPayload = {
      goal: exactRaw1000,
      why: "e\u0301".repeat(500),
      doneLooksLike: [exactRaw500],
      constraints: ["é".repeat(500)],
      nonGoals: ["a".repeat(500)],
      evidenceRequired: ["🙂".repeat(500)],
      openQuestions: ["e\u0301".repeat(250)],
    };
    expect(Array.from(exactRaw1000)).toHaveLength(1000);
    expect(Array.from(exactRaw500)).toHaveLength(500);
    expect(Array.from(acceptedPayload.why)).toHaveLength(1000);
    expect(Array.from(acceptedPayload.openQuestions[0])).toHaveLength(500);

    for (const direct of [false, true]) {
      const setup = installed();
      const result = direct
        ? await setup.room.dispatch({
            type: "PROPOSE_GOAL_CONTRACT", actor: "agent", expectedStateVersion: 0,
            idempotencyKey: "accepted-direct-boundaries", ...acceptedPayload,
          })
        : await setup.tools.get("propose_goal_contract").execute({
            expectedStateVersion: 0, idempotencyKey: "accepted-webmcp-boundaries",
            ...acceptedPayload,
          });
      expect(result).toMatchObject({ accepted: true });
      expect(setup.room.getState().activeGoalContract).toMatchObject({
        goal: "🙂".repeat(998),
        why: acceptedPayload.why,
        doneLooksLike: ["🙂".repeat(498)],
        constraints: acceptedPayload.constraints,
        nonGoals: acceptedPayload.nonGoals,
        evidenceRequired: acceptedPayload.evidenceRequired,
        openQuestions: acceptedPayload.openQuestions,
      });
      expect(setup.room.getReceipts()).toHaveLength(1);
    }

    for (const [name, value] of [
      ["ascii", "a".repeat(1001)],
      ["emoji", "🙂".repeat(1001)],
      ["combining", `${"e\u0301".repeat(500)}e`],
      ["raw-padded", ` ${"🙂".repeat(1000)} `],
      ["whitespace", "   "],
    ] as const) {
      for (const field of ["goal", "why"] as const) {
        for (const direct of [false, true]) {
          const setup = installed();
          const before = setup.room.getState();
          const input = {
            expectedStateVersion: 0, idempotencyKey: `${direct ? "direct" : "webmcp"}-${field}-${name}`,
            ...contract, [field]: value,
          };
          if (direct) {
            await expect(setup.room.dispatch({
              type: "PROPOSE_GOAL_CONTRACT", actor: "agent", ...input,
            })).rejects.toThrow("INVALID_COMMAND");
          } else {
            expect(await setup.tools.get("propose_goal_contract").execute(input))
              .toMatchObject({ accepted: false, reasonCode: "INVALID_TOOL_INPUT" });
          }
          expect(setup.room.getState()).toEqual(before);
          expect(setup.room.getReceipts()).toEqual([]);
        }
      }
    }

    const listOver501 = `${"e\u0301".repeat(250)}e`;
    expect(Array.from(listOver501)).toHaveLength(501);
    for (const field of [
      "doneLooksLike", "constraints", "nonGoals", "evidenceRequired", "openQuestions",
    ] as const) {
      for (const direct of [false, true]) {
        const setup = installed();
        const before = setup.room.getState();
        const input = {
          expectedStateVersion: 0, idempotencyKey: `${direct ? "direct" : "webmcp"}-${field}-501`,
          ...contract, [field]: [listOver501],
        };
        if (direct) {
          await expect(setup.room.dispatch({
            type: "PROPOSE_GOAL_CONTRACT", actor: "agent", ...input,
          })).rejects.toThrow("INVALID_COMMAND");
        } else {
          expect(await setup.tools.get("propose_goal_contract").execute(input))
            .toMatchObject({ accepted: false, reasonCode: "INVALID_TOOL_INPUT" });
        }
        expect(setup.room.getState()).toEqual(before);
        expect(setup.room.getReceipts()).toEqual([]);
      }
    }

    for (const direct of [false, true]) {
      const emojiBoundary = installed();
      const input = {
        expectedStateVersion: 0, idempotencyKey: `${direct ? "direct" : "webmcp"}-emoji-1000`,
        ...contract, goal: "🙂".repeat(1000),
      };
      const result = direct
        ? await emojiBoundary.room.dispatch({
            type: "PROPOSE_GOAL_CONTRACT", actor: "agent", ...input,
          })
        : await emojiBoundary.tools.get("propose_goal_contract").execute(input);
      expect(result).toMatchObject({ accepted: true });
    }
  });
});
