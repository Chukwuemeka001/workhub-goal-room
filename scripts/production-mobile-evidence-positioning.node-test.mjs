import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const root = resolve(new URL("..", import.meta.url).pathname);

test("production-mobile report labels injected capture as non-native WebMCP evidence", async () => {
  const evidenceRoot = await mkdtemp(join(tmpdir(), "workhub-production-mobile-positioning-test-"));
  try {
    execFileSync(process.execPath, ["scripts/production-mobile-qa.mjs"], {
      cwd: root,
      env: { ...process.env, WORKHUB_MOBILE_EVIDENCE_DIR: evidenceRoot },
      stdio: "pipe",
    });
    const report = JSON.parse(await readFile(join(evidenceRoot, "production-mobile-report.json"), "utf8"));
    assert.deepEqual(report.evidencePositioning, {
      classification: "descriptor-runtime-positioning",
      injectedCaptureShim: {
        injected: true,
        source: "Page.addScriptToEvaluateOnNewDocument",
        target: "document.modelContext.registerTool",
      },
      nativeWebMcpEvidence: false,
      disclaimer: "This report is descriptor/runtime positioning only; its injected capture shim is not native WebMCP evidence.",
    });
  } finally {
    await rm(evidenceRoot, { recursive: true, force: true });
  }
});
