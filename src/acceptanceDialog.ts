export type AcceptanceBinding = {
  candidateVersion: number;
  digest: string;
  compactDigest: string;
  ruleSet: string;
};

type EventLike = { preventDefault(): void; key?: string; shiftKey?: boolean };
type EventNode = {
  addEventListener(type: string, listener: (event: EventLike) => unknown): void;
};
type TextNode = { textContent: string | null };
type FocusNode = EventNode & { focus(): void };

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
};

export function createAcceptanceDialog(
  nodes: AcceptanceDialogNodes,
  onConfirm: (binding: AcceptanceBinding) => Promise<void>,
) {
  let exactBinding: AcceptanceBinding | null = null;

  const reset = () => {
    exactBinding = null;
    nodes.confirm.disabled = false;
  };
  const closeWithoutMutation = (event?: EventLike) => {
    event?.preventDefault();
    nodes.dialog.close();
    reset();
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
      nodes.title.textContent = `Accept Candidate v${binding.candidateVersion}?`;
      nodes.candidate.textContent = `Candidate v${binding.candidateVersion} (${binding.compactDigest})`;
      nodes.digest.textContent = binding.digest;
      nodes.ruleSet.textContent = binding.ruleSet;
      nodes.consequence.textContent = "This acceptance is irreversible. It seals the Goal Room for this exact PASS-bound candidate.";
      nodes.dialog.showModal();
      nodes.cancel.focus();
    },
    close: closeWithoutMutation,
    binding: () => exactBinding === null ? null : { ...exactBinding },
  };
}
