import { createReleaseGuardianEnvelope } from "../src/verifier/releaseRules";
import { createGoalRoom } from "../src/core/goalRoom";
import { createOwnerDecisionController } from "../src/ownerController";
import { installGoalRoomTools } from "../src/webmcp";

export const PHASE8_HOSTILE_MARKERS = [
  "<script>phase8()</script>",
  "<svg onload=phase8()>",
  "<img src=x onerror=phase8()>",
  "<a href=javascript:phase8()>phase8</a>",
  "</textarea><input autofocus onfocus=phase8()>",
] as const;
export const PHASE8_REVISION_PROBE_CODE_POINTS = 2000;
export const codePointLength = (value: string) => Array.from(value).length;

export type Phase8Checkpoint =
  | "goal" | "goal-revision" | "plan" | "plan-revision"
  | "fail" | "pass" | "completion" | "accepted";

type Tool = { name: string; execute: (input: unknown) => Promise<Record<string, unknown>> };

function exactCodePoints(prefix: string, length: number, fill: string): string {
  const prefixLength = codePointLength(prefix);
  if (prefixLength > length || codePointLength(fill) !== 1) throw new Error("INVALID_PHASE8_BOUNDARY_FIXTURE");
  return `${prefix}${fill.repeat(length - prefixLength)}`;
}

function goalContract(version: number) {
  const list = (label: string) => Array.from({ length: 16 }, (_, index) =>
    exactCodePoints(`${label}-${version}-${index + 1}:${PHASE8_HOSTILE_MARKERS[index % PHASE8_HOSTILE_MARKERS.length]}:`, 500, String.fromCodePoint(0x1f9ea + (index % 4))),
  );
  return {
    goal: exactCodePoints(`Goal-v${version}:${PHASE8_HOSTILE_MARKERS[0]}:`, 1000, "界"),
    why: exactCodePoints(`Why-v${version}:${PHASE8_HOSTILE_MARKERS[1]}:`, 1000, "🧭"),
    doneLooksLike: list("done"),
    constraints: list("constraint"),
    nonGoals: list("non-goal"),
    evidenceRequired: list("evidence"),
    openQuestions: list("question"),
  };
}

function planSteps(version: number) {
  return Array.from({ length: 8 }, (_, index) => ({
    id: exactCodePoints(`step-${version}-${index + 1}-${PHASE8_HOSTILE_MARKERS[3]}-`, 80, String(index + 1)),
    title: exactCodePoints(`Plan-v${version}-step-${index + 1}:${PHASE8_HOSTILE_MARKERS[2]}:`, 160, "計"),
  }));
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildPhase8Authority(checkpoint: Phase8Checkpoint) {
  const room = createGoalRoom({ ownerIntent: null });
  const renderedVersions: number[] = [];
  const owner = createOwnerDecisionController({ room, render: () => renderedVersions.push(room.getState().stateVersion) });
  const registered: Tool[] = [];
  const toolInvocations: Array<{ toolName: string; result: Record<string, unknown> }> = [];
  const installation = installGoalRoomTools({
    documentLike: { modelContext: { registerTool: (tool) => { registered.push(tool as Tool); } } },
    navigatorLike: {},
    room,
    onInvocation: (record) => toolInvocations.push(record),
  });
  const invoke = async (name: string, input: unknown) => {
    const tool = registered.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`MISSING_PHASE8_TOOL:${name}`);
    const result = await tool.execute(input);
    if (result.accepted !== true) throw new Error(`PHASE8_TOOL_REFUSED:${name}:${String(result.reasonCode)}`);
    return result;
  };

  await owner.setOwnerIntent(exactCodePoints(`Intent:${PHASE8_HOSTILE_MARKERS[4]}:`, 1000, "意"));
  await invoke("propose_goal_contract", {
    expectedStateVersion: 1, idempotencyKey: "phase8-goal-v1", ...goalContract(1),
  });
  if (checkpoint === "goal") return result();
  await owner.requestGoalRevision(exactCodePoints(`Goal-revision-finite-probe:${PHASE8_HOSTILE_MARKERS[0]}:`, PHASE8_REVISION_PROBE_CODE_POINTS, "改"));
  if (checkpoint === "goal-revision") return result();
  await invoke("propose_goal_contract", {
    expectedStateVersion: 3, idempotencyKey: "phase8-goal-v2", ...goalContract(2),
  });
  await owner.confirmGoalContract();
  await invoke("propose_plan", {
    expectedStateVersion: 5, idempotencyKey: "phase8-plan-v1", goalContractVersion: 2, steps: planSteps(1),
  });
  if (checkpoint === "plan") return result();
  await owner.requestRevision(exactCodePoints(`Plan-revision-finite-probe:${PHASE8_HOSTILE_MARKERS[1]}:`, PHASE8_REVISION_PROBE_CODE_POINTS, "修"));
  if (checkpoint === "plan-revision") return result();
  const stepsV2 = planSteps(2);
  await invoke("propose_plan", {
    expectedStateVersion: 7, idempotencyKey: "phase8-plan-v2", goalContractVersion: 2, steps: stepsV2,
  });
  await owner.confirmPlan();
  await invoke("claim_step", {
    expectedStateVersion: 9, idempotencyKey: "phase8-claim", planVersion: 2, stepId: stepsV2[0].id,
  });
  const failedContent = createReleaseGuardianEnvelope({ proofManifestSha256: "a9a9aac7896a3583a0db78ec5e801e906f0872659e1bf6d36922d091b4294c60" });
  const failedSha = await sha256(failedContent);
  await invoke("submit_artifact", {
    expectedStateVersion: 10, idempotencyKey: "phase8-candidate-fail", planVersion: 2,
    stepId: stepsV2[0].id, content: failedContent, sha256: failedSha,
  });
  await room.verifyActiveCandidate("phase8-verify-fail");
  if (checkpoint === "fail") return result();
  const passedContent = createReleaseGuardianEnvelope();
  const passedSha = await sha256(passedContent);
  await invoke("submit_artifact", {
    expectedStateVersion: 12, idempotencyKey: "phase8-candidate-pass", planVersion: 2,
    stepId: stepsV2[0].id, content: passedContent, sha256: passedSha,
  });
  await room.verifyActiveCandidate("phase8-verify-pass");
  if (checkpoint === "pass") return result();
  await invoke("request_completion", {
    expectedStateVersion: 14, idempotencyKey: "phase8-completion", candidateSha256: passedSha,
  });
  if (checkpoint === "completion") return result();
  await owner.acceptGoal();
  return result();

  function result() {
    return {
      checkpoint,
      room,
      owner,
      registrationStatus: installation.status,
      registrationOrder: registered.map(({ name }) => name),
      toolInvocations: structuredClone(toolInvocations),
      renderedVersions: [...renderedVersions],
      revisionProbe: {
        codePoints: PHASE8_REVISION_PROBE_CODE_POINTS,
        claim: "declared finite hostile/max probe; production source admits nonblank revision notes without a maximum",
      },
    };
  }
}
