type KeyboardEventLike = {
  key?: string;
  shiftKey?: boolean;
  preventDefault(): void;
};

type FocusNode = { focus(): void };
type ReturnFocusNode = FocusNode & { isConnected?: boolean };

type DialogNode = {
  addEventListener(type: string, listener: (event: KeyboardEventLike) => unknown): void;
  contains(node: unknown): boolean;
  ownerDocument?: { activeElement: unknown };
};

export function containRevisionDialogFocus(
  dialog: DialogNode,
  first: FocusNode,
  last: FocusNode,
): void {
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const active = dialog.ownerDocument?.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  });
}

export function createRevisionDialogFocusReturn(dialog: DialogNode) {
  let target: ReturnFocusNode | null = null;
  return {
    capture(explicitTarget?: ReturnFocusNode) {
      const active = explicitTarget ?? dialog.ownerDocument?.activeElement as Partial<ReturnFocusNode> | null | undefined;
      target = active && typeof active.focus === "function" && !dialog.contains(active)
        ? active as ReturnFocusNode
        : null;
    },
    restore() {
      const captured = target;
      target = null;
      if (captured?.isConnected !== false) captured?.focus();
    },
  };
}
