import type { Receipt } from "./core/goalRoom";
import type { LifecycleStage, OwnerViewModel } from "./ownerView";

export function createLifecycleAccessibleLabel(
  stage: Pick<LifecycleStage, "label" | "status">,
): string {
  return `${stage.label} — ${stage.status}`;
}

export function createBoundaryMessage(view: OwnerViewModel): string {
  if (view.nextLegalAction.label === "No further governed action") {
    return "Goal accepted. No further action is required.";
  }
  return view.nextLegalAction.actor === "owner"
    ? "The agent and verifier are blocked until you decide."
    : view.nextLegalAction.actor === "system"
      ? "The agent cannot write or override this verdict."
      : "No owner action is required right now.";
}

function commandLabel(
  receipt: Receipt,
  proposedPlanVersion?: number,
  candidateVersion?: number,
): string {
  switch (receipt.command.type) {
    case "PROPOSE_PLAN":
      return receipt.accepted
        ? `Agent proposed Plan v${proposedPlanVersion ?? "?"}`
        : `Plan proposal refused · ${receipt.reasonCode ?? "unknown"}`;
    case "CONFIRM_PLAN":
      return receipt.accepted
        ? `Owner confirmed Plan v${receipt.command.planVersion}`
        : `Plan confirmation refused · ${receipt.reasonCode ?? "unknown"}`;
    case "REQUEST_PLAN_REVISION":
      return receipt.accepted
        ? `Owner requested revision to Plan v${receipt.command.planVersion}`
        : `Revision request refused · ${receipt.reasonCode ?? "unknown"}`;
    case "CLAIM_STEP":
      return receipt.accepted
        ? `Agent claimed step ${receipt.command.stepId}`
        : `Step claim refused · ${receipt.reasonCode ?? "unknown"}`;
    case "SUBMIT_CANDIDATE":
      return receipt.accepted
        ? `Agent submitted Candidate v${candidateVersion ?? "?"} · ${receipt.command.sha256.slice(0, 8)}`
        : `Candidate submission refused · ${receipt.reasonCode ?? "unknown"}`;
    case "RECORD_VERIFICATION":
      return receipt.accepted
        ? `System verification ${receipt.command.verdict} · ${receipt.command.candidateSha256.slice(0, 8)}`
        : `Verification refused · ${receipt.reasonCode ?? "unknown"}`;
    case "REQUEST_COMPLETION":
      return receipt.accepted
        ? `Agent requested owner acceptance · ${receipt.command.candidateSha256.slice(0, 8)}`
        : `Completion request refused · ${receipt.reasonCode ?? "unknown"}`;
    case "ACCEPT_GOAL":
      return receipt.accepted
        ? `Owner accepted Goal · ${receipt.command.candidateSha256.slice(0, 8)}`
        : `Goal acceptance refused · ${receipt.reasonCode ?? "unknown"}`;
  }
}

export function createReceiptLabels(receipts: Receipt[]): string[] {
  let proposedPlanVersion = 0;
  let candidateVersion = 0;
  return receipts.map((receipt) => {
    const planVersion =
      receipt.command.type === "PROPOSE_PLAN" && receipt.accepted
        ? ++proposedPlanVersion
        : undefined;
    const acceptedCandidateVersion =
      receipt.command.type === "SUBMIT_CANDIDATE" && receipt.accepted
        ? ++candidateVersion
        : undefined;
    return commandLabel(receipt, planVersion, acceptedCandidateVersion);
  });
}

export function prepareRevisionNote(rawValue: string) {
  const note = rawValue.trim();
  return { valid: note.length >= 3 && note.length <= 500, note };
}
