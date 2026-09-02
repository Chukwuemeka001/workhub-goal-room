#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCdpBrowser, createLoopbackOpenAIProvider } from "./adapters.mjs";
import { runAutonomousTrial, scoreTrial } from "./autonomous-core.mjs";

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!flag?.startsWith("--") || argv[index + 1] === undefined) throw new Error(`INVALID_ARGUMENT: ${flag ?? "missing"}`);
    values[flag.slice(2)] = argv[index + 1];
  }
  return values;
}
function requireValue(values, name) {
  if (!values[name]) throw new Error(`MISSING_ARGUMENT: --${name}`);
  return values[name];
}
function sha(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

const values = parseArgs(process.argv.slice(2));
const config = {
  cdpPort: Number(requireValue(values, "cdp-port")),
  pageUrl: requireValue(values, "page-url"),
  baseUrl: requireValue(values, "base-url"),
  model: requireValue(values, "model"),
  scenario: requireValue(values, "scenario"),
  sessionId: requireValue(values, "session-id"),
  output: resolve(requireValue(values, "output")),
};
if (!['owner_gate', 'positive'].includes(config.scenario)) throw new Error("INVALID_SCENARIO");
const browser = await createCdpBrowser({ cdpPort: config.cdpPort, pageUrl: config.pageUrl });
try {
  const provider = createLoopbackOpenAIProvider({ baseUrl: config.baseUrl });
  const trial = await runAutonomousTrial({ browser, provider, model: config.model, scenario: config.scenario, sessionId: config.sessionId });
  const receipt = {
    ...trial,
    score: scoreTrial(trial),
    recordedAt: new Date().toISOString(),
    route: {
      pageUrl: config.pageUrl,
      cdpHost: "127.0.0.1",
      cdpPort: config.cdpPort,
      modelBaseUrl: new URL(config.baseUrl).origin,
      credentialHandling: "Hermes loopback proxy attached opaque OAuth credential; evaluation client used only placeholder bearer",
    },
  };
  const here = dirname(fileURLToPath(import.meta.url));
  const sources = await Promise.all(["autonomous-core.mjs", "adapters.mjs", "run-trial.mjs"].map(async (name) => {
    const bytes = await readFile(resolve(here, name));
    return { name, bytes: bytes.length, sha256: sha(bytes) };
  }));
  receipt.sourceBinding = sources;
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  await mkdir(dirname(config.output), { recursive: true });
  const temporary = `${config.output}.tmp-${process.pid}`;
  await writeFile(temporary, bytes, { mode: 0o600 });
  await rename(temporary, config.output);
  console.log(JSON.stringify({ output: config.output, bytes: bytes.length, sha256: sha(bytes), score: receipt.score, calls: receipt.modelSelectedCalls.map((row) => row.name) }));
} finally {
  await browser.close();
}
