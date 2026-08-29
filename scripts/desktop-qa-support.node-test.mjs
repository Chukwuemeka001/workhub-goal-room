import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const supportUrl = new URL("./desktop-qa-support.mjs", import.meta.url);

async function support() {
  try { return await import(supportUrl); }
  catch (error) { assert.fail(`desktop QA support API must exist: ${error.message}`); }
}

test("capture retries one concrete timeout and returns screenshot bytes", async () => {
  const { captureScreenshotWithRetry } = await support();
  let attempts = 0;
  const bytes = await captureScreenshotWithRetry(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("CDP timeout: Page.captureScreenshot");
    return { data: Buffer.from("real png bytes").toString("base64") };
  }, { attempts: 2, settle: async () => {} });
  assert.equal(attempts, 2);
  assert.deepEqual(bytes, Buffer.from("real png bytes"));
});

test("capture has a finite attempt budget and reports the final error", async () => {
  const { captureScreenshotWithRetry } = await support();
  let attempts = 0;
  await assert.rejects(
    captureScreenshotWithRetry(async () => { attempts += 1; throw new Error(`timeout-${attempts}`); }, { attempts: 3, settle: async () => {} }),
    /timeout-3/,
  );
  assert.equal(attempts, 3);
});

test("a late response from a timed-out CDP request cannot settle a later request", async () => {
  const { createCdpCaller } = await support();
  const sent = [];
  let onMessage;
  const socket = {
    addEventListener(type, listener) { if (type === "message") onMessage = listener; },
    send(payload) { sent.push(JSON.parse(payload)); },
  };
  const call = createCdpCaller(socket, { timeoutMs: 10 });
  const first = call("Page.captureScreenshot");
  await assert.rejects(first, /CDP timeout: Page\.captureScreenshot/);
  const second = call("Page.captureScreenshot");
  onMessage({ data: JSON.stringify({ id: sent[0].id, result: { data: "late" } }) });
  onMessage({ data: JSON.stringify({ id: sent[1].id, result: { data: "current" } }) });
  assert.deepEqual(await second, { data: "current" });
});

test("default evidence custody is temporary and cleaned while explicit export persists", async () => {
  const { createEvidenceCustody } = await support();
  const defaultCustody = await createEvidenceCustody({ env: {}, temporaryRoot: tmpdir() });
  assert.equal(defaultCustody.temporary, true);
  await writeFile(join(defaultCustody.directory, "shot.png"), "png");
  await defaultCustody.cleanup();
  await assert.rejects(stat(defaultCustody.directory), { code: "ENOENT" });

  const parent = await mkdtemp(join(tmpdir(), "workhub-desktop-export-test-"));
  const directory = join(parent, "evidence");
  const explicitCustody = await createEvidenceCustody({ env: { WORKHUB_QA_EVIDENCE_DIR: directory }, temporaryRoot: tmpdir() });
  assert.equal(explicitCustody.temporary, false);
  await writeFile(join(explicitCustody.directory, "shot.png"), "valid evidence");
  await explicitCustody.cleanup();
  assert.equal(await readFile(join(directory, "shot.png"), "utf8"), "valid evidence");
  await rm(parent, { recursive: true, force: true });
});
