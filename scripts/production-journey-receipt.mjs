import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const evidenceRoot = join(root, "evaluation", "production-journey");
const journeyBytes = await readFile(join(evidenceRoot, "journey.json"));
const journey = JSON.parse(journeyBytes);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
if (journey.kind !== "goal-room-real-production-journey") throw new Error("Wrong production journey evidence kind");
if (journey.route.entry !== "/index.html" || journey.route.sourceEntry !== "src/main.ts" || journey.route.fixtureImports.length || journey.route.bundleLeaks.length) throw new Error("Production route boundary failed");
if (journey.invocation.class !== "captured-registered-webmcp-descriptor-callbacks" || journey.invocation.browserNativeTestingApi !== false || journey.invocation.autonomousModelSelection !== false) throw new Error("Invocation claim boundary failed");
if (journey.tools.length !== 6 || journey.tools.some(({ name }) => /verify|accept/.test(name))) throw new Error("Privileged or incomplete tool surface");
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
  const bytes = await readFile(join(root, screenshot.path));
  if (sha256(bytes) !== screenshot.sha256 || bytes.length !== screenshot.bytes) throw new Error(`Screenshot mismatch: ${screenshot.path}`);
}
const protectedExpected = {
  "src/core/goalRoom.ts": "04d8e89e49ea2b14e8d22ddb404c54e923b01743390a61745bc6d2f21556ff29",
  "src/ownerController.ts": "c20507f4dfa034c5398bd6c77e4fc85b23c32587b7088b383cfdd59bf9f93adb",
  "src/verifier/releaseRules.ts": "ed94538ab54029f9b1159ad597629336fcea771ff77f1f709dc4085bac5512aa",
  "src/webmcp.ts": "021cf979a63bfe39706e9a8247fcac7f75afbc65b59aa9f0d936334bb29574e2",
};
const protectedParity = [];
for (const [path, expectedSha256] of Object.entries(protectedExpected)) {
  const actualSha256 = sha256(await readFile(join(root, path)));
  protectedParity.push({ path, expectedSha256, actualSha256, unchanged: actualSha256 === expectedSha256 });
}
if (protectedParity.some(({ unchanged }) => !unchanged)) throw new Error("Protected production authority changed");
const boundSources = ["index.html", "src/main.ts", "src/systemVerifierAdapter.ts", "scripts/production-journey-qa.mjs", "scripts/production-journey-receipt.mjs", "src/phase8Journey.test.ts", "package.json", "evaluation/production-journey/README.md"];
const sourceHashes = [];
for (const path of boundSources) {
  const bytes = await readFile(join(root, path));
  sourceHashes.push({ path, sha256: sha256(bytes), bytes: bytes.length });
}
const receipt = {
  schemaVersion: 1,
  kind: "goal-room-production-journey-qualification-receipt",
  testedProductionIdentity: journey.testedSource,
  evidenceCommit: "recorded_after_commit_in_git",
  evidenceTree: "recorded_after_commit_in_git",
  journeySha256: sha256(journeyBytes),
  route: journey.route,
  browser: journey.browser,
  invocation: journey.invocation,
  results: { checkpoints: journey.checkpoints.length, receipts: journey.receipts.length, finalReceiptHash: journey.receiptSummary.finalHash, screenshotCount: journey.screenshots.length, compositionCount: journey.compositions.length, finalPhase: journey.finalState.phase, replay: journey.receiptSummary.replay, reloadReset: journey.reloadReset },
  negativeControls: journey.negatives,
  protectedParity,
  sourceHashes,
  screenshotHashes: journey.screenshots,
};
await writeFile(join(evidenceRoot, "qualification-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ passed: true, journeySha256: receipt.journeySha256, receiptCount: receipt.results.receipts, finalReceiptHash: receipt.results.finalReceiptHash, screenshots: receipt.results.screenshotCount, protectedParity: true }, null, 2));
