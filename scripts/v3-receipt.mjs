import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const evidenceRoot = join(root, "evaluation", "v3");
const readJson = async (name) => JSON.parse(await readFile(join(evidenceRoot, name), "utf8"));
const modes = Object.fromEntries(await Promise.all(
  ["visual", "responsive", "a11y", "hostile"].map(async (name) => [name, await readJson(`${name}.json`)]),
));
const fixtureExclusion = await readJson("fixture-exclusion.json");
const protectedBytes = await readJson("protected-bytes.json");
for (const [name, evidence] of Object.entries(modes)) {
  if (evidence.summary.failureCount !== 0 || evidence.failures.length !== 0) throw new Error(`Cannot bind failing V3 ${name} evidence`);
}
if (!fixtureExclusion.passed) throw new Error("Cannot bind failing fixture exclusion evidence");
if (!protectedBytes.passed) throw new Error("Cannot bind changed protected authority bytes");

const boundSources = [
  "index.html",
  "design/GOAL_ROOM_V3_VISUAL_CONTRACT.md",
  "design/TRANSLATION_LEDGER.md",
  "qualification/v3-replay.ts",
  "qualification/v3-fixture.ts",
  "qualification/v3-fixture.html",
  "qualification/v3Contract.test.ts",
  "qualification/v3Replay.test.ts",
  "qualification/v3Infrastructure.test.ts",
  "src/custodyView.ts",
  "src/toolSurfaceView.ts",
  "src/acceptanceDialog.ts",
  "src/revisionDialog.ts",
  "src/main.ts",
  "src/desktopUi.ts",
  "src/desktopView.ts",
  "src/mobileUi.ts",
  "src/mobileView.ts",
  "src/ownerUi.ts",
  "src/ownerView.ts",
  "src/phase0View.ts",
  "src/desktop.css",
  "src/style.css",
  "scripts/composition-production-qa.mjs",
  "scripts/v3-browser-qa.mjs",
  "scripts/v3-fixture-exclusion.mjs",
  "scripts/v3-protected-bytes.mjs",
  "scripts/v3-receipt.mjs",
  "package.json",
  "README.md",
];
const sourceHashes = [];
for (const path of boundSources) {
  const bytes = await readFile(join(root, path));
  sourceHashes.push({ path, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.byteLength });
}
const storyRows = modes.responsive.rows.slice(0, 14).map(({ story, passBoundary }) => ({
  id: story.id,
  label: story.label,
  kernelPhase: story.kernelPhase,
  presentation: story.presentation,
  stateVersion: story.stateVersion,
  stateDigest: story.stateDigest,
  receiptCount: story.receiptCount,
  receiptHash: story.receiptHash,
  passBoundary,
}));
const receipt = {
  schemaVersion: 1,
  kind: "goal-room-v3-deterministic-qualification-receipt",
  boundary: "Local production-excluded qualification evidence. No deployment, publishing, payment, messaging, authentication, or manual screen-reader claim.",
  witnessedRed: {
    command: "npx vitest run qualification/v3Contract.test.ts",
    result: "FAIL",
    testFiles: { failed: 1, passed: 0 },
    tests: { failed: 2, passed: 2 },
    failures: [
      "switches to the distinct mobile composition below 1200px",
      "styles the desktop custody lane, editorial workspace, and collapsed static-six disclosure",
    ],
    witnessedBeforeImplementation: true,
  },
  qualification: {
    replaySource: "real-kernel-replay",
    storyCount: storyRows.length,
    stories: storyRows,
    syntheticStories: storyRows.filter(({ presentation }) => presentation !== "canonical").map(({ id }) => id),
    finalReceiptHash: storyRows.at(-1)?.receiptHash ?? "GENESIS",
    passIsNotAcceptance: storyRows.find(({ id }) => id === "S12")?.passBoundary.accepted === false &&
      storyRows.find(({ id }) => id === "S12")?.passBoundary.verdict === "PASS",
  },
  checks: {
    visual: modes.visual.summary,
    responsive: modes.responsive.summary,
    accessibility: modes.a11y.summary,
    hostile: modes.hostile.summary,
    fixtureExclusion: { passed: fixtureExclusion.passed, entryReferences: fixtureExclusion.entryReferences, leaks: fixtureExclusion.leaks },
    protectedBytes: { passed: protectedBytes.passed, rows: protectedBytes.rows },
  },
  sourceHashes,
  screenshotHashes: modes.visual.screenshots,
};
if (receipt.qualification.storyCount !== 14 || JSON.stringify(receipt.qualification.syntheticStories) !== JSON.stringify(["S09"]) || !receipt.qualification.passIsNotAcceptance) {
  throw new Error("V3 receipt story boundary mismatch");
}
await writeFile(join(evidenceRoot, "qualification-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({
  storyCount: receipt.qualification.storyCount,
  syntheticStories: receipt.qualification.syntheticStories,
  finalReceiptHash: receipt.qualification.finalReceiptHash,
  sourceCount: sourceHashes.length,
  screenshotCount: receipt.screenshotHashes.length,
  passed: true,
}, null, 2));
