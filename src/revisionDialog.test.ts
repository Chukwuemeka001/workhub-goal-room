import { describe, expect, it } from "vitest";
import { containRevisionDialogFocus, createRevisionDialogFocusReturn } from "./revisionDialog";

class FakeNode {
  listeners = new Map<string, Array<(event: { key?: string; shiftKey?: boolean; preventDefault(): void }) => unknown>>();
  ownerDocument = { activeElement: null as FakeNode | null };
  children: FakeNode[] = [];
  addEventListener(type: string, listener: (event: { key?: string; shiftKey?: boolean; preventDefault(): void }) => unknown) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  contains(node: unknown) { return this.children.includes(node as FakeNode); }
  focus() { this.ownerDocument.activeElement = this; }
  async keydown(key: string, shiftKey: boolean) {
    let prevented = false;
    const event = { key, shiftKey, preventDefault: () => { prevented = true; } };
    for (const listener of this.listeners.get("keydown") ?? []) await listener(event);
    return prevented;
  }
}

describe("Goal and Plan revision dialog physical keyboard containment", () => {
  it.each(["Goal", "Plan"])("keeps Shift+Tab and Tab inside the %s revision dialog", async () => {
    const dialog = new FakeNode();
    const input = new FakeNode();
    const cancel = new FakeNode();
    const submit = new FakeNode();
    for (const node of [input, cancel, submit]) node.ownerDocument = dialog.ownerDocument;
    dialog.children = [input, cancel, submit];
    containRevisionDialogFocus(dialog, input, submit);

    input.focus();
    expect(await dialog.keydown("Tab", true)).toBe(true);
    expect(dialog.ownerDocument.activeElement).toBe(submit);

    submit.focus();
    expect(await dialog.keydown("Tab", false)).toBe(true);
    expect(dialog.ownerDocument.activeElement).toBe(input);

    dialog.ownerDocument.activeElement = null;
    expect(await dialog.keydown("Tab", false)).toBe(true);
    expect(dialog.ownerDocument.activeElement).toBe(input);
  });

  it.each(["Cancel", "Escape"])("returns focus to the exact revision trigger after %s", (closeKind) => {
    const dialog = new FakeNode();
    const trigger = new FakeNode();
    trigger.ownerDocument = dialog.ownerDocument;
    trigger.focus();
    const focusReturn = createRevisionDialogFocusReturn(dialog);
    focusReturn.capture();
    dialog.ownerDocument.activeElement = null;
    focusReturn.restore();
    expect(dialog.ownerDocument.activeElement, closeKind).toBe(trigger);
  });
});
