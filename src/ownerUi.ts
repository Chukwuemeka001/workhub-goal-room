import type { Receipt } from "./core/goalRoom";

function commandLabel(receipt: Receipt, proposedPlanVersion?: number): string {
  if (receipt.command.type === "PROPOSE_PLAN") {
    return receipt.accepted
      ? `Agent proposed Plan v${proposedPlanVersion ?? "?"}`
      : `Plan proposal refused · ${receipt.reasonCode ?? "unknown"}`;
  }
  if (receipt.command.type === "CONFIRM_PLAN") {
    return receipt.accepted
      ? `Owner confirmed Plan v${receipt.command.planVersion}`
      : `Plan confirmation refused · ${receipt.reasonCode ?? "unknown"}`;
  }
  return receipt.accepted
    ? `Owner requested revision to Plan v${receipt.command.planVersion}`
    : `Revision request refused · ${receipt.reasonCode ?? "unknown"}`;
}

export function createReceiptLabels(receipts: Receipt[]): string[] {
  let proposedPlanVersion = 0;
  return receipts.map((receipt) => {
    const version =
      receipt.command.type === "PROPOSE_PLAN" && receipt.accepted
        ? ++proposedPlanVersion
        : undefined;
    return commandLabel(receipt, version);
  });
}

export function prepareRevisionNote(rawValue: string) {
  const note = rawValue.trim();
  return { valid: note.length >= 3 && note.length <= 500, note };
}
