import { describe, expect, it } from "vitest";
import { createAcceptanceDialog, type AcceptanceBinding } from "./acceptanceDialog";

class FakeNode {
  textContent = "";
  disabled = false;
  open = false;
  hidden = false;
  listeners = new Map<string, Array<(event: { preventDefault(): void }) => unknown>>();
  addEventListener(type: string, listener: (event: { preventDefault(): void }) => unknown) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  ownerDocument = { activeElement: null as FakeNode | null };
  children: FakeNode[] = [];
  focus() { this.ownerDocument.activeElement = this; }
  contains(node: unknown) { return this.children.includes(node as FakeNode); }
  async emit(type: string, extra: Record<string, unknown> = {}) {
    let prevented = false;
    const event = { preventDefault: () => { prevented = true; }, ...extra };
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
  ruleSet: "workhub_goal_room_release/v2",
};

function fixture() {
  const nodes = {
    dialog: new FakeNode(), form: new FakeNode(), cancel: new FakeNode(), confirm: new FakeNode(),
    title: new FakeNode(), candidate: new FakeNode(), digest: new FakeNode(), ruleSet: new FakeNode(), consequence: new FakeNode(),
    releaseGroup: new FakeNode(), releaseProfile: new FakeNode(), releaseSourceBaseCommit: new FakeNode(),
    releaseCandidateManifest: new FakeNode(), releaseProofManifest: new FakeNode(),
    releaseRollbackPatch: new FakeNode(), releaseConsequence: new FakeNode(),
  };
  nodes.dialog.children = [nodes.cancel, nodes.confirm];
  nodes.cancel.ownerDocument = nodes.dialog.ownerDocument;
  nodes.confirm.ownerDocument = nodes.dialog.ownerDocument;
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
    expect(nodes.releaseGroup.hidden).toBe(true);
    expect(nodes.releaseConsequence.textContent).toMatch(/no release envelope/i);
  });

  it("shows exact release identities and the bounded matched-tuple claim when authorized", () => {
    const { nodes, dialog } = fixture();
    dialog.open({
      ...binding,
      release: {
        profile: "release_guardian/v2",
        sourceBaseCommit: "089745dd595934147dcad71ece28097346b709c5",
        candidateManifestSha256: "96d1dc3f7678fcb3159c7d8eb963f199633145579e14adfa51fee64e9b0989c2",
        proofManifestSha256: "a9a9aac7896a3583a0db78ec5e801e906f0872659e1bf6d36922d091b4294c66",
        rollbackPatchSha256: "c78bacab6f06855426deea32ce900323aaba25761ae8133cb99d1e3b738770d4",
        compactCandidateManifest: "96d1dc3f76…9b0989c2",
        compactProofManifest: "a9a9aac789…b4294c66",
        compactRollbackPatch: "c78bacab6f…738770d4",
      },
    });

    expect(nodes.releaseGroup.hidden).toBe(false);
    expect(nodes.releaseProfile.textContent).toBe("release_guardian/v2");
    expect(nodes.releaseSourceBaseCommit.textContent).toBe("089745dd595934147dcad71ece28097346b709c5");
    expect(nodes.releaseCandidateManifest.textContent).toHaveLength(64);
    expect(nodes.releaseProofManifest.textContent).toHaveLength(64);
    expect(nodes.releaseRollbackPatch.textContent).toBe("c78bacab6f…738770d4");
    expect(nodes.releaseConsequence.textContent).toContain(
      "matched the prequalified identity tuple",
    );
    expect(nodes.releaseConsequence.textContent).toContain("did not run tests");
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

  it("cycles trusted Tab focus inside the open modal in both directions", async () => {
    const { nodes, dialog } = fixture();
    dialog.open(binding);
    expect(nodes.dialog.ownerDocument.activeElement).toBe(nodes.cancel);

    nodes.confirm.focus();
    expect(await nodes.dialog.emit("keydown", { key: "Tab", shiftKey: false })).toBe(true);
    expect(nodes.dialog.ownerDocument.activeElement).toBe(nodes.cancel);

    nodes.cancel.focus();
    expect(await nodes.dialog.emit("keydown", { key: "Tab", shiftKey: true })).toBe(true);
    expect(nodes.dialog.ownerDocument.activeElement).toBe(nodes.confirm);
  });

  it("returns focus to the invoking trigger after Cancel and Escape", async () => {
    for (const closeKind of ["click", "cancel"] as const) {
      const { nodes, dialog } = fixture();
      const trigger = new FakeNode();
      trigger.ownerDocument = nodes.dialog.ownerDocument;
      trigger.focus();
      dialog.open(binding);
      expect(nodes.dialog.ownerDocument.activeElement).toBe(nodes.cancel);

      if (closeKind === "click") await nodes.cancel.emit("click");
      else await nodes.dialog.emit("cancel");

      expect(nodes.dialog.open).toBe(false);
      expect(nodes.dialog.ownerDocument.activeElement).toBe(trigger);
    }
  });
});
