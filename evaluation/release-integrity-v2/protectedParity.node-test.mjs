import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  AUTHORIZED_V2_MIGRATIONS,
  SOURCE_BASE_COMMIT,
  UNCHANGED_AUTHORITY_FILES,
  verifyProtectedParity,
} from "./protectedParity.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("v2 preserves the Owner and exact six-tool authority surface at the frozen base", async () => {
  const result = await verifyProtectedParity(repoRoot);
  assert.equal(result.sourceBaseCommit, SOURCE_BASE_COMMIT);
  assert.deepEqual(result.protectedFiles.map((entry) => entry.path), [...UNCHANGED_AUTHORITY_FILES]);
  assert.deepEqual(UNCHANGED_AUTHORITY_FILES, [
    "src/ownerController.ts",
    "src/webmcp.ts",
    "src/webmcp-globals.d.ts",
    "src/toolSurfaceView.ts",
  ]);
  assert.ok(result.protectedFiles.every((entry) => entry.unchanged));
  assert.equal(result.matched, true);
});

test("v2 parity records only the two authorized verifier migration files", async () => {
  const result = await verifyProtectedParity(repoRoot);
  assert.deepEqual(
    result.authorizedMigrations.map((entry) => entry.path),
    [...AUTHORIZED_V2_MIGRATIONS],
  );
  assert.ok(result.authorizedMigrations.every((entry) => !entry.unchanged));
});
