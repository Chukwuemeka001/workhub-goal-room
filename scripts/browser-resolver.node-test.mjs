import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveBrowserExecutable } from "./browser-resolver.mjs";

async function withTempDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), "browser-resolver-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function makeExecutable(path) {
  await writeFile(path, "#!/bin/sh\nexit 0\n");
  await chmod(path, 0o755);
}

test("resolves google-chrome from PATH without macOS fallbacks", async () => {
  await withTempDirectory(async (directory) => {
    const executable = join(directory, "google-chrome");
    await makeExecutable(executable);

    assert.equal(resolveBrowserExecutable({
      env: { PATH: directory },
      macosApplicationPaths: [],
    }), executable);
  });
});

test("resolves each supported Chromium executable name from PATH", async (context) => {
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    await context.test(name, async () => {
      await withTempDirectory(async (directory) => {
        const executable = join(directory, name);
        await makeExecutable(executable);

        assert.equal(resolveBrowserExecutable({
          env: { PATH: directory },
          macosApplicationPaths: [],
        }), executable);
      });
    });
  }
});

test("prioritizes an explicit executable CHROME_BIN over PATH and macOS fallbacks", async () => {
  await withTempDirectory(async (directory) => {
    const explicit = join(directory, "Explicit Browser");
    const pathBrowser = join(directory, "google-chrome");
    const macBrowser = join(directory, "Mac Browser");
    await Promise.all([explicit, pathBrowser, macBrowser].map(makeExecutable));

    assert.equal(resolveBrowserExecutable({
      env: { CHROME_BIN: explicit, PATH: directory },
      macosApplicationPaths: [macBrowser],
    }), explicit);
  });
});

test("rejects non-files and non-executable candidates before using PATH", async () => {
  await withTempDirectory(async (directory) => {
    const nonExecutable = join(directory, "not-executable");
    const executable = join(directory, "google-chrome");
    await writeFile(nonExecutable, "not executable\n");
    await makeExecutable(executable);

    assert.equal(resolveBrowserExecutable({
      env: { CHROME_BIN: nonExecutable, PATH: directory },
      macosApplicationPaths: [],
    }), executable);

    assert.equal(resolveBrowserExecutable({
      env: { CHROME_BIN: directory, PATH: directory },
      macosApplicationPaths: [],
    }), executable);
  });
});

test("resolves a PATH executable when the directory contains spaces", async () => {
  await withTempDirectory(async (directory) => {
    const binDirectory = join(directory, "browser bin");
    await mkdir(binDirectory);
    const executable = join(binDirectory, "google-chrome");
    await makeExecutable(executable);

    assert.equal(resolveBrowserExecutable({
      env: { PATH: binDirectory },
      macosApplicationPaths: [],
    }), executable);
  });
});

test("fails clearly when no executable browser exists", () => {
  assert.throws(
    () => resolveBrowserExecutable({ env: { PATH: "" }, macosApplicationPaths: [] }),
    /Set CHROME_BIN to a Chromium-compatible browser executable/,
  );
});

test("uses an executable macOS application fallback after PATH", async () => {
  await withTempDirectory(async (directory) => {
    const macBrowser = join(directory, "BrowserOS App");
    await makeExecutable(macBrowser);

    assert.equal(resolveBrowserExecutable({
      env: { PATH: "" },
      macosApplicationPaths: [join(directory, "missing"), macBrowser],
    }), macBrowser);
  });
});

test("prioritizes a PATH executable over a macOS application fallback", async () => {
  await withTempDirectory(async (directory) => {
    const pathBrowser = join(directory, "google-chrome");
    const macBrowser = join(directory, "Mac Browser");
    await Promise.all([pathBrowser, macBrowser].map(makeExecutable));

    assert.equal(resolveBrowserExecutable({
      env: { PATH: directory },
      macosApplicationPaths: [macBrowser],
    }), pathBrowser);
  });
});

test("V3 keyboard QA targets Now on mobile and preserves Goal on desktop", async () => {
  const source = await readFile(new URL("./v3-browser-qa.mjs", import.meta.url), "utf8");

  assert.match(
    source,
    /const selector = viewport\.expected === "mobile" \? "#mobile-tab-now" : "#desktop-tab-goal";/,
  );
  assert.match(source, /document\.querySelector\(\$\{JSON\.stringify\(selector\)\}\)\.focus\(\)/);
});
