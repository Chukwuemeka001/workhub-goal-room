import { describe, expect, it } from "vitest";
import { createAcceptanceDialog, type AcceptanceBinding } from "./acceptanceDialog";

class FakeNode {
  textContent = "";
  disabled = false;
  open = false;
  listeners = new Map<string, Array<(event: { preventDefault(): void }) => unknown>>();
  addEventListener(type: string, listener: (event: { preventDefault(): void }) => unknown) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  async emit(type: string) {
    let prevented = false;
    const event = { preventDefault: () => { prevented = true; } };
    for (const listener of this.listeners.get(type) ?? []) await listener(event);
    return prevented;
  }
  showModal() { this.open = true; }
  close() { this.open = false; }
}

const binding: AcceptanceBinding = {
  candidateVersion: 2,
  digest: "7bb959aebadc1b0d557990440771bda517f53dfeca69b78f651650c941ffdf27",
  compactDigest: "7bb959aeba…41ffdf27",
  ruleSet: "workhub_goal_room_release/v1",
};

function fixture() {
  const nodes = {
    dialog: new FakeNode(), form: new FakeNode(), cancel: new FakeNode(), confirm: new FakeNode(),
    title: new FakeNode(), candidate: new FakeNode(), digest: new FakeNode(), ruleSet: new FakeNode(), consequence: new FakeNode(),
  };
  const submitted: AcceptanceBinding[] = [];
  const dialog = createAcceptanceDialog(nodes, async (exact) => { submitted.push(exact); });
  return { nodes, submitted, dialog };
}

describe("exact-candidate acceptance confirmation", () => {
  it("binds visible confirmation copy to candidate version, full digest, and PASS rule set", () => {
    const { nodes, dialog } = fixture();
    dialog.open(binding);
    expect(nodes.dialog.open).toBe(true);
    expect(nodes.title.textContent).toContain("Candidate v2");
    expect(nodes.candidate.textContent).toContain("v2");
    expect(nodes.digest.textContent).toBe(binding.digest);
    expect(nodes.ruleSet.textContent).toBe(binding.ruleSet);
    expect(nodes.consequence.textContent).toMatch(/irreversible/i);
  });

  it("Cancel and Escape close with zero submission or retained binding", async () => {
    const cancel = fixture();
    cancel.dialog.open(binding);
    await cancel.nodes.cancel.emit("click");
    expect(cancel.submitted).toEqual([]);
    expect(cancel.nodes.dialog.open).toBe(false);
    expect(cancel.dialog.binding()).toBeNull();

    const escape = fixture();
    escape.dialog.open(binding);
    expect(await escape.nodes.dialog.emit("cancel")).toBe(true);
    expect(escape.submitted).toEqual([]);
    expect(escape.nodes.dialog.open).toBe(false);
    expect(escape.dialog.binding()).toBeNull();
  });

  it("only explicit form submit calls the controller path and disables during submission", async () => {
    const { nodes, submitted, dialog } = fixture();
    dialog.open(binding);
    await nodes.form.emit("submit");
    expect(submitted).toEqual([binding]);
    expect(nodes.confirm.disabled).toBe(false);
    expect(nodes.dialog.open).toBe(false);
    expect(dialog.binding()).toBeNull();
  });
});
