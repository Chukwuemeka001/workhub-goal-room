import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const read = (path) => readFileSync(join(root, path), "utf8");
const receipt = JSON.parse(read("evaluation/phase5-qualification.json"));
const productionJourney = JSON.parse(read("evaluation/production-journey/journey.json"));
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

const zoom = productionJourney.accessibility?.zoom200;
check(zoom?.route === "/index.html", "production effective 200% record is absent or not bound to /index.html");
check(zoom?.method === "halved-css-viewport-equivalent", "production zoom method is not a defensible effective 200% equivalent");
check(zoom?.referenceViewport?.width === 1440 && zoom?.referenceViewport?.height === 900, "production zoom reference viewport must be 1440x900");
check(zoom?.cssViewport?.innerWidth === 720 && zoom?.cssViewport?.innerHeight === 450, "production zoom CSS viewport must be effectively halved to 720x450");
check(zoom?.effectiveScale === 2 && zoom?.visualViewport?.width === 720 && zoom?.visualViewport?.height === 450, "production zoom effective scale/visual viewport measurement is invalid");
check(zoom?.overflow?.documentX === 0 && zoom?.overflow?.bodyX === 0, "production zoom has unintended horizontal overflow");
check(zoom?.composition?.active?.length === 1 && zoom?.composition?.active?.[0] === "mobile-room" && zoom?.composition?.axMainNames?.length === 1, "production zoom distinct composition/AX XOR is invalid");
check(Array.isArray(zoom?.requiredContent) && zoom.requiredContent.length >= 8 && zoom.requiredContent.every((row) => row.rendered && row.reachable), "production zoom required content/controls are not all rendered and reachable");

const contrast = productionJourney.accessibility?.contrast;
const contrastRows = Array.isArray(contrast?.inventory) ? contrast.inventory : [];
const requiredContrastCategories = ["normal-text", "large-text", "status-success", "status-fail", "status-warning", "actionable-control", "focus-indicator"];
check(contrast?.source === "computed production rendered styles", "production-derived contrast inventory is absent");
check(["desktop", "mobile"].every((composition) => contrastRows.some((row) => row.composition === composition)), "contrast inventory must cover desktop and mobile compositions");
check(requiredContrastCategories.every((category) => contrastRows.some((row) => row.category === category)), "contrast inventory is missing a required category");
check(contrastRows.length >= 14, "contrast inventory is not representative");
check(contrastRows.every((row) => row.selector && row.state && row.token && /^#[0-9a-f]{6}$/i.test(row.foreground) && /^#[0-9a-f]{6}$/i.test(row.background) && Number.isFinite(row.ratio) && [3, 4.5].includes(row.threshold) && row.pass === (row.ratio >= row.threshold) && row.pass), "contrast inventory contains invalid measurements or failures");
check(contrast?.failureCount === 0 && contrast?.counts?.total === contrastRows.length, "contrast inventory summary is invalid or has failures");

const html = read("index.html");
check(html.includes('<meta name="referrer" content="no-referrer" />'), "missing no-referrer metadata");
check(!/Content-Security-Policy/i.test(html), "unproven CSP present");
check(html.includes('aria-labelledby="judge-help-title"'), "semantic judge help absent");
check(html.includes("Reload starts a fresh room"), "reload recovery truth absent");
check(html.includes("PASS is not owner acceptance"), "PASS boundary absent");
check(!/reset[-_ ]room/i.test(html), "reset mutation language/control present");

for (const path of ["SECURITY.md", "PRIVACY.md", "evaluation/manual-accessibility-v3.md"]) {
  const text = read(path);
  check(text.length > 500, `${path} is incomplete`);
  check(!text.includes("/Users/"), `${path} contains a private home path`);
}
check(read("SECURITY.md").includes("not an enterprise or production-security claim"), "security claim boundary absent");
check(read("PRIVACY.md").includes("Reloading the page starts a fresh room"), "privacy lifecycle absent");
check(read("evaluation/manual-accessibility-v3.md").includes("does not claim full WCAG conformance"), "accessibility claim limit must remain explicit");

const productionSources = [
  "index.html", "src/main.ts", "src/desktopUi.ts", "src/mobileUi.ts", "src/acceptanceDialog.ts", "src/revisionDialog.ts",
  "src/style.css", "src/desktop.css", "SECURITY.md", "PRIVACY.md",
];
const source = productionSources.map((path) => read(path)).join("\n");
for (const pattern of [
  [/(?:localStorage|sessionStorage|indexedDB|caches\.open)\s*\(/, "browser persistence API"],
  [/\.(?:innerHTML|outerHTML)\s*=/, "unsafe HTML assignment"],
  [/(?:google-analytics|googletagmanager|segment\.io|mixpanel|amplitude)/i, "analytics client"],
  [/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/, "network client"],
]) check(!pattern[0].test(source), `${pattern[1]} found in production candidate`);

const walk = (dir) => readdirSync(dir).flatMap((entry) => {
  const path = join(dir, entry);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const dist = join(root, "dist");
for (const path of walk(dist)) {
  check(extname(path) !== ".map", `source map present: ${path.slice(root.length + 1)}`);
  if ([".html", ".js", ".css"].includes(extname(path))) {
    const text = readFileSync(path, "utf8");
    check(!text.includes("/Users/"), `private home path in build asset: ${path.slice(root.length + 1)}`);
    check(!/(?:google-analytics|googletagmanager|segment\.io|mixpanel|amplitude)/i.test(text), `analytics in build asset: ${path.slice(root.length + 1)}`);
  }
}

for (const [path, expected] of Object.entries(receipt.protectedStartGitObjects)) {
  const actual = execFileSync("git", ["hash-object", path], { cwd: root, encoding: "utf8" }).trim();
  check(actual === expected, `protected parity failed: ${path}`);
}
check(receipt.voiceOver.pageCheckpointGate === "passed", "actual VoiceOver page checkpoint gate is not integrated");
check(receipt.keyboard?.gate === "passed", "complete physical-keyboard gate is not integrated");
const voiceOverManifest = JSON.parse(read("evaluation/voiceover-v3/manifest.json"));
check(voiceOverManifest.files.length === 10, "VoiceOver evidence manifest is incomplete");
for (const row of voiceOverManifest.files) {
  const actual = createHash("sha256").update(readFileSync(join(root, row.path))).digest("hex");
  check(actual === row.sha256, `VoiceOver evidence hash mismatch: ${row.path}`);
}
check(receipt.security.csp.startsWith("omitted"), "CSP omission is not documented");

if (failures.length) {
  console.error(JSON.stringify({ passed: false, failureCount: failures.length, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({
  passed: true,
  productionSources: productionSources.length,
  protectedObjects: Object.keys(receipt.protectedStartGitObjects).length,
  sourceMaps: 0,
  persistenceApis: 0,
  analyticsClients: 0,
  unsafeHtmlAssignments: 0,
  referrerPolicy: "no-referrer",
  csp: "intentionally omitted with documented proof limit",
  voiceOverPageGate: receipt.voiceOver.pageCheckpointGate,
  keyboardGate: receipt.keyboard.gate,
  voiceOverScreenshots: voiceOverManifest.files.length,
}, null, 2));
