export type AcceptanceBinding = {
  candidateVersion: number;
  digest: string;
  compactDigest: string;
  ruleSet: string;
};

type EventLike = { preventDefault(): void };
type EventNode = {
  addEventListener(type: string, listener: (event: EventLike) => unknown): void;
};
type TextNode = { textContent: string | null };

export type AcceptanceDialogNodes = {
  dialog: EventNode & { showModal(): void; close(): void };
  form: EventNode;
  cancel: EventNode;
  confirm: { disabled: boolean };
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
    },
    close: closeWithoutMutation,
    binding: () => exactBinding === null ? null : { ...exactBinding },
  };
}
