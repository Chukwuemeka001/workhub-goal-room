import type { ReleaseCustody } from "./custodyView";
import {
  RELEASE_MATCHED_TUPLE_STATEMENT,
  RELEASE_VERIFICATION_CLAIM_BOUNDARY,
} from "./verifier/releaseRules";

export type AcceptanceBinding = {
  candidateVersion: number;
  digest: string;
  compactDigest: string;
  ruleSet: string;
  /**
   * Release identities parsed from the already-submitted candidate. Null when
   * the candidate is not an exactly shaped release envelope, in which case the
   * dialog omits the release rows rather than inventing values.
   */
  release?: ReleaseCustody | null;
};

type EventLike = { preventDefault(): void; key?: string; shiftKey?: boolean };
type EventNode = {
  addEventListener(type: string, listener: (event: EventLike) => unknown): void;
};
type TextNode = { textContent: string | null };
type FocusNode = EventNode & { focus(): void; isConnected?: boolean };
type ReleaseRowNode = { hidden: boolean };

export type AcceptanceDialogNodes = {
  dialog: EventNode & {
    showModal(): void;
    close(): void;
    contains(node: unknown): boolean;
    ownerDocument?: { activeElement: unknown };
  };
  form: EventNode;
  cancel: FocusNode;
  confirm: FocusNode & { disabled: boolean };
  title: TextNode;
  candidate: TextNode;
  digest: TextNode;
  ruleSet: TextNode;
  consequence: TextNode;
  releaseGroup: ReleaseRowNode;
  releaseProfile: TextNode;
  releaseSourceBaseCommit: TextNode;
  releaseCandidateManifest: TextNode;
  releaseProofManifest: TextNode;
  releaseRollbackPatch: TextNode;
  releaseConsequence: TextNode;
};

export const ACCEPTANCE_RELEASE_CONSEQUENCE =
  `${RELEASE_MATCHED_TUPLE_STATEMENT} Accepting seals this exact proof manifest to these exact candidate bytes. A proof manifest belonging to different candidate bytes cannot be accepted. ${RELEASE_VERIFICATION_CLAIM_BOUNDARY}`;
const ACCEPTANCE_NO_RELEASE_BINDING = "No release envelope identities are recorded for this candidate.";

export function createAcceptanceDialog(
  nodes: AcceptanceDialogNodes,
  onConfirm: (binding: AcceptanceBinding) => Promise<void>,
) {
  let exactBinding: AcceptanceBinding | null = null;
  let returnFocus: FocusNode | null = null;

  const reset = () => {
    exactBinding = null;
    nodes.confirm.disabled = false;
  };
  const closeWithoutMutation = (event?: EventLike) => {
    event?.preventDefault();
    nodes.dialog.close();
    reset();
    const target = returnFocus;
    returnFocus = null;
    if (target?.isConnected !== false) target?.focus();
  };

  nodes.cancel.addEventListener("click", closeWithoutMutation);
  nodes.dialog.addEventListener("cancel", closeWithoutMutation);
  nodes.dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const active = nodes.dialog.ownerDocument?.activeElement;
    if (event.shiftKey && (active === nodes.cancel || !nodes.dialog.contains(active))) {
      event.preventDefault();
      nodes.confirm.focus();
    } else if (!event.shiftKey && (active === nodes.confirm || !nodes.dialog.contains(active))) {
      event.preventDefault();
      nodes.cancel.focus();
    }
  });
  nodes.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!exactBinding || nodes.confirm.disabled) return;
    const submittedBinding = exactBinding;
    nodes.confirm.disabled = true;
    try {
      await onConfirm(submittedBinding);
      nodes.dialog.close();
      reset();
    } catch (error) {
      nodes.confirm.disabled = false;
      throw error;
    }
  });

  return {
    open(binding: AcceptanceBinding) {
      exactBinding = { ...binding };
      const active = nodes.dialog.ownerDocument?.activeElement as Partial<FocusNode> | null | undefined;
      returnFocus = active && typeof active.focus === "function" && !nodes.dialog.contains(active)
        ? active as FocusNode
        : null;
      nodes.title.textContent = `Accept Candidate v${binding.candidateVersion}?`;
      nodes.candidate.textContent = `Candidate v${binding.candidateVersion} (${binding.compactDigest})`;
      nodes.digest.textContent = binding.digest;
      nodes.ruleSet.textContent = binding.ruleSet;
      nodes.consequence.textContent = "This acceptance is irreversible. It seals the Goal Room for this exact PASS-bound candidate.";
      const release = binding.release ?? null;
      nodes.releaseGroup.hidden = release === null;
      nodes.releaseProfile.textContent = release?.profile ?? "";
      nodes.releaseSourceBaseCommit.textContent = release?.sourceBaseCommit ?? "";
      nodes.releaseCandidateManifest.textContent = release?.candidateManifestSha256 ?? "";
      nodes.releaseProofManifest.textContent = release?.proofManifestSha256 ?? "";
      nodes.releaseRollbackPatch.textContent = release?.compactRollbackPatch ?? "";
      nodes.releaseConsequence.textContent = release === null
        ? ACCEPTANCE_NO_RELEASE_BINDING
        : ACCEPTANCE_RELEASE_CONSEQUENCE;
      nodes.dialog.showModal();
      nodes.cancel.focus();
    },
    close: closeWithoutMutation,
    binding: () => exactBinding === null ? null : { ...exactBinding },
  };
}
