#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("./", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

async function withPackageCopy(run) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "workhub-evidence-verifier-"));
  const copyRoot = join(temporaryRoot, "package");
  await cp(packageRoot, copyRoot, { recursive: true });
  try {
    return await run(copyRoot);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function verify(copyRoot) {
  return spawnSync(process.execPath, [join(copyRoot, "verify.mjs"), "--repo-root", repoRoot], {
    cwd: copyRoot,
    encoding: "utf8",
  });
}

async function readManifest(copyRoot) {
  return JSON.parse(await readFile(join(copyRoot, "manifest.json"), "utf8"));
}

async function writeManifest(copyRoot, manifest) {
  await writeFile(join(copyRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

test("rejects an unknown base commit binding", async () => {
  await withPackageCopy(async (copyRoot) => {
    const manifest = await readManifest(copyRoot);
    manifest.testedProduct.baseCommit = "0".repeat(40);
    await writeManifest(copyRoot, manifest);

    const result = verify(copyRoot);
    assert.notEqual(result.status, 0, `unknown base commit passed:\n${result.stdout}\n${result.stderr}`);
  });
});

test("rejects a forged tracked-diff binding", async () => {
  await withPackageCopy(async (copyRoot) => {
    const manifest = await readManifest(copyRoot);
    manifest.testedProduct.trackedDiffSha256 = "0".repeat(64);
    await writeManifest(copyRoot, manifest);

    const result = verify(copyRoot);
    assert.notEqual(result.status, 0, `forged tracked diff passed:\n${result.stdout}\n${result.stderr}`);
  });
});

test("rejects a forged candidate-source binding", async () => {
  await withPackageCopy(async (copyRoot) => {
    const manifest = await readManifest(copyRoot);
    manifest.testedProduct.candidateSourceHashes[0].sha256 = "0".repeat(64);
    await writeManifest(copyRoot, manifest);

    const result = verify(copyRoot);
    assert.notEqual(result.status, 0, `forged candidate source passed:\n${result.stdout}\n${result.stderr}`);
  });
});

test("rejects files absent from the exact package inventory", async () => {
  await withPackageCopy(async (copyRoot) => {
    await writeFile(join(copyRoot, "unlisted.txt"), "unexpected evidence file\n");

    const result = verify(copyRoot);
    assert.notEqual(result.status, 0, `unlisted file passed:\n${result.stdout}\n${result.stderr}`);
  });
});

async function replaceReadme(copyRoot, leaked) {
  const manifest = await readManifest(copyRoot);
  const readme = manifest.files.find((row) => row.path === "README.md");
  assert.ok(readme);
  await writeFile(join(copyRoot, "README.md"), leaked);
  const { createHash } = await import("node:crypto");
  readme.bytes = Buffer.byteLength(leaked);
  readme.sha256 = createHash("sha256").update(leaked).digest("hex");
  await writeManifest(copyRoot, manifest);
}

test("rejects a listed textual file containing a private user path", async () => {
  await withPackageCopy(async (copyRoot) => {
    await replaceReadme(copyRoot, `audit copy /${"Users"}/example/private\n`);

    const result = verify(copyRoot);
    assert.notEqual(result.status, 0, `private path passed:\n${result.stdout}\n${result.stderr}`);
  });
});

test("rejects a listed textual file containing an ordinary bearer secret", async () => {
  await withPackageCopy(async (copyRoot) => {
    await replaceReadme(copyRoot, `audit copy ${"Bearer"} ghp_1234567890abcdefghijklmnop\n`);

    const result = verify(copyRoot);
    assert.notEqual(result.status, 0, `listed secret passed:\n${result.stdout}\n${result.stderr}`);
  });
});

test("rejects a bearer secret prefixed by the allowed placeholder", async () => {
  await withPackageCopy(async (copyRoot) => {
    await replaceReadme(copyRoot, `audit copy ${"Bearer"} evaluation-client-ACTUALSECRET123456789\n`);

    const result = verify(copyRoot);
    assert.notEqual(result.status, 0, `placeholder-prefixed bearer passed:\n${result.stdout}\n${result.stderr}`);
  });
});

test("rejects a JSON secret prefixed by an allowed example value", async () => {
  await withPackageCopy(async (copyRoot) => {
    await replaceReadme(copyRoot, `{${JSON.stringify("api_key")}:${JSON.stringify("example_ACTUALSECRET123456789")}}\n`);

    const result = verify(copyRoot);
    assert.notEqual(result.status, 0, `example-prefixed JSON secret passed:\n${result.stdout}\n${result.stderr}`);
  });
});
