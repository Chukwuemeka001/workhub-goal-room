import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(new URL("..", import.meta.url).pathname);
const receipt = resolve(root, "evaluation/native-webmcp-v3/native-webmcp-receipt.json");
const validator = resolve(root, "submission/scripts/v3-native-webmcp-proof.mjs");

test("fresh native V3 evidence is complete and deterministic", () => {
  assert.equal(
    existsSync(receipt),
    true,
    "Phase 4 native receipt must exist before the native proof can pass",
  );
  assert.equal(existsSync(validator), true, "Phase 4 native validator must exist");
  const result = spawnSync(process.execPath, [validator, "validate"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const summary = JSON.parse(result.stdout);
  assert.deepEqual(summary, {
    passed: true,
    tools: 6,
    finalPhase: "GOAL_ACCEPTED",
    nativeInvocations: 42,
    screenshots: 5,
    negativeControl: "webmcp-unavailable-owner-ui-usable",
  });
});
