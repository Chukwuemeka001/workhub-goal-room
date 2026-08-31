#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTHORIZED_V2_MIGRATIONS,
  SOURCE_BASE_COMMIT,
  UNCHANGED_AUTHORITY_FILES,
  verifyProtectedParity,
} from "../evaluation/release-integrity-v2/protectedParity.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const EVIDENCE_DIRECTORY = "evaluation/production-journey-v2";
const evidenceRoot = join(root, EVIDENCE_DIRECTORY);
const journeyBytes = await readFile(join(evidenceRoot, "journey.json"));
const journey = JSON.parse(journeyBytes);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const EXPECTED_TOOL_NAMES = Object.freeze([
  "get_goal_room_state",
  "propose_goal_contract",
  "propose_plan",
  "claim_step",
  "submit_artifact",
  "request_completion",
]);
const HISTORICAL_RECEIPT_SCRIPT = Object.freeze({
  path: "scripts/production-journey-receipt.mjs",
  sha256: "2a11364e28e5dcbbd28d792a5c2ef3bc71c97ecd2581c9e65e5b7bc27e0b5377",
});

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

if (journey.kind !== "goal-room-real-production-journey") throw new Error("Wrong production journey evidence kind");
if (journey.route.entry !== "/index.html" || journey.route.sourceEntry !== "src/main.ts" || journey.route.fixtureImports.length || journey.route.bundleLeaks.length) throw new Error("Production route boundary failed");
if (journey.invocation.class !== "captured-registered-webmcp-descriptor-callbacks" || journey.invocation.browserNativeTestingApi !== false || journey.invocation.autonomousModelSelection !== false) throw new Error("Invocation claim boundary failed");
const actualToolNames = journey.tools.map(({ name }) => name);
if (JSON.stringify(actualToolNames) !== JSON.stringify(EXPECTED_TOOL_NAMES)) throw new Error("Exact six-tool surface mismatch");
if (journey.finalState.phase !== "GOAL_ACCEPTED" || journey.finalState.stateVersion !== 16 || journey.terminal.currentActor !== "none" || journey.terminal.actor !== "none" || journey.terminal.buttons !== 0) throw new Error("Terminal state failed");
if (journey.reloadReset.phase !== "INTENT_DRAFT" || journey.reloadReset.stateVersion !== 0 || journey.reloadReset.ownerIntent !== null) throw new Error("Reload reset failed");
if (journey.receipts.length !== 22) throw new Error(`Receipt count mismatch: ${journey.receipts.length}`);
journey.receipts.forEach((receipt, index) => {
  const { hash, ...body } = receipt;
  const expectedHash = sha256(canonical(body));
  if (hash !== expectedHash || receipt.sequence !== index + 1 || receipt.previousHash !== (index ? journey.receipts[index - 1].hash : "GENESIS")) throw new Error(`Receipt ${index + 1} validation failed`);
});
if (journey.receiptSummary.finalHash !== journey.receipts.at(-1).hash) throw new Error("Final receipt hash mismatch");
for (const screenshot of journey.screenshots) {
  if (!screenshot.path.startsWith(`${EVIDENCE_DIRECTORY}/`)) throw new Error(`V2 screenshot escaped dedicated evidence directory: ${screenshot.path}`);
  const bytes = await readFile(join(root, screenshot.path));
  if (sha256(bytes) !== screenshot.sha256 || bytes.length !== screenshot.bytes) throw new Error(`Screenshot mismatch: ${screenshot.path}`);
}

const parity = await verifyProtectedParity(root);
if (!parity.matched) throw new Error("V2 authority parity failed");
if (JSON.stringify(parity.protectedFiles.map(({ path }) => path)) !== JSON.stringify(UNCHANGED_AUTHORITY_FILES)) throw new Error("V2 protected authority inventory mismatch");
if (JSON.stringify(parity.authorizedMigrations.map(({ path }) => path)) !== JSON.stringify(AUTHORIZED_V2_MIGRATIONS)) throw new Error("V2 authorized migration inventory mismatch");
const historicalReceiptBytes = await readFile(join(root, HISTORICAL_RECEIPT_SCRIPT.path));
if (sha256(historicalReceiptBytes) !== HISTORICAL_RECEIPT_SCRIPT.sha256) throw new Error("Historical production-journey receipt contract changed");

const boundSources = [
  "index.html",
  "src/main.ts",
  "src/revisionDialog.ts",
  "src/desktopUi.ts",
  "src/mobileUi.ts",
  "src/systemVerifierAdapter.ts",
  "scripts/production-journey-qa.mjs",
  "scripts/production-journey-receipt-v2.mjs",
  "src/phase8Journey.test.ts",
  "package.json",
  "evaluation/release-integrity-v2/protectedParity.mjs",
];
const sourceHashes = [];
for (const path of boundSources) {
  const bytes = await readFile(join(root, path));
  sourceHashes.push({ path, sha256: sha256(bytes), bytes: bytes.length });
}

const receipt = {
  schemaVersion: 2,
  kind: "goal-room-production-journey-v2-qualification-receipt",
  evidenceDirectory: EVIDENCE_DIRECTORY,
  testedProductionIdentity: journey.testedSource,
  journeySha256: sha256(journeyBytes),
  route: journey.route,
  browser: journey.browser,
  invocation: journey.invocation,
  toolSurface: {
    registration: "static-six",
    names: actualToolNames,
    exact: true,
  },
  results: {
    checkpoints: journey.checkpoints.length,
    receipts: journey.receipts.length,
    finalReceiptHash: journey.receiptSummary.finalHash,
    screenshotCount: journey.screenshots.length,
    compositionCount: journey.compositions.length,
    finalPhase: journey.finalState.phase,
    replay: journey.receiptSummary.replay,
    reloadReset: journey.reloadReset,
  },
  negativeControls: journey.negatives,
  authorityParity: {
    sourceBaseCommit: SOURCE_BASE_COMMIT,
    unchangedAuthorityFiles: parity.protectedFiles,
    authorizedV2Migrations: parity.authorizedMigrations,
    historicalReceiptScript: {
      ...HISTORICAL_RECEIPT_SCRIPT,
      actualSha256: sha256(historicalReceiptBytes),
      unchanged: true,
    },
  },
  sourceHashes,
  screenshotHashes: journey.screenshots,
};
await writeFile(join(evidenceRoot, "qualification-receipt-v2.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({
  passed: true,
  journeySha256: receipt.journeySha256,
  receiptCount: receipt.results.receipts,
  finalReceiptHash: receipt.results.finalReceiptHash,
  screenshots: receipt.results.screenshotCount,
  exactToolSurface: true,
  protectedParity: true,
  authorizedV2Migrations: AUTHORIZED_V2_MIGRATIONS,
  historicalReceiptContractUnchanged: true,
}, null, 2));
