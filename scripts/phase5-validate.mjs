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
const requiredZoomSelectors = [
  ".mobile-goal-title", ".mobile-actor", ".mobile-frontier-title", ".mobile-frontier-live", ".mobile-boundary",
  "#mobile-owner-intent", ".mobile-intent-form button[type='submit']", "#mobile-tab-now", "#mobile-tab-plan", "#mobile-tab-proof", "#mobile-tab-activity", ".judge-help summary",
];
check(zoom?.route === "/index.html", "production effective 200% record is absent or not bound to /index.html");
check(zoom?.method === "halved-css-viewport-equivalent", "production zoom method is not a defensible effective 200% equivalent");
check(zoom?.referenceViewport?.width === 1440 && zoom?.referenceViewport?.height === 900, "production zoom reference viewport must be 1440x900");
check(zoom?.cssViewport?.innerWidth === 720 && zoom?.cssViewport?.innerHeight === 450, "production zoom CSS viewport must be effectively halved to 720x450");
check(zoom?.effectiveScale === 2 && zoom?.visualViewport?.width === 720 && zoom?.visualViewport?.height === 450, "production zoom effective scale/visual viewport measurement is invalid");
check(zoom?.overflow?.documentX === 0 && zoom?.overflow?.bodyX === 0, "production zoom has unintended horizontal overflow");
check(zoom?.composition?.active?.length === 1 && zoom?.composition?.active?.[0] === "mobile-room" && zoom?.composition?.axMainNames?.length === 1 && zoom.composition.axMainNames[0] === "WorkHub Goal Room mobile", "production zoom distinct composition/named AX main is invalid");
check(Array.isArray(zoom?.requiredContent) && zoom.requiredContent.length === requiredZoomSelectors.length && requiredZoomSelectors.every((selector) => zoom.requiredContent.some((row) => row.selector === selector && row.rendered === true && row.reachable === true)), "production zoom required content/controls are not all rendered and reachable");

const contrast = productionJourney.accessibility?.contrast;
const contrastRows = Array.isArray(contrast?.inventory) ? contrast.inventory : [];
const requiredContrastThresholds = new Map([
  ["normal-text", 4.5], ["large-text", 3], ["status-success", 4.5], ["status-fail", 4.5],
  ["status-warning", 4.5], ["actionable-control", 3], ["focus-indicator", 3],
]);
const contrastRatio = (foreground, background) => {
  const luminance = (hex) => {
    const channels = hex.slice(1).match(/.{2}/g).map((value) => Number.parseInt(value, 16) / 255);
    const [r, g, b] = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
};
const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
check(contrast?.source === "computed production rendered styles", "production-derived contrast inventory is absent");
check(["desktop", "mobile"].every((composition) => [...requiredContrastThresholds.keys()].every((category) => contrastRows.some((row) => row.composition === composition && row.category === category))), "each contrast composition must cover every required category");
check(contrastRows.length >= 14, "contrast inventory is not representative");
check(contrastRows.every((row) => {
  const colorsValid = /^#[0-9a-f]{6}$/i.test(row.foreground) && /^#[0-9a-f]{6}$/i.test(row.background);
  const threshold = requiredContrastThresholds.get(row.category);
  const focusValid = row.category !== "focus-indicator" || (row.focused === true && row.outlineStyle === "solid" && /^\d+(?:\.\d+)?px$/.test(row.outlineWidth) && Number.parseFloat(row.outlineWidth) >= 3);
  return [row.selector, row.state, row.token, row.composition].every(nonEmpty)
    && ["desktop", "mobile"].includes(row.composition) && threshold !== undefined && row.threshold === threshold
    && colorsValid && Number.isFinite(row.ratio) && row.ratio === contrastRatio(row.foreground, row.background)
    && row.ratio >= row.threshold && row.pass === true && focusValid;
}), "contrast inventory contains invalid measurements, metadata, thresholds, focus evidence, or failures");
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
const distFiles = walk(dist).map((path) => path.slice(dist.length + 1).split("\\").join("/")).sort();
check(distFiles.length === 5, `production build must contain exactly five files, found ${distFiles.length}`);
check(distFiles.filter((path) => !path.startsWith("assets/")).join(",") === "PRIVACY.md,SECURITY.md,index.html", "production build top-level inventory is invalid");
check(distFiles.filter((path) => /^assets\/index-[A-Za-z0-9_-]+\.(?:css|js)$/.test(path)).length === 2, "production build hashed asset inventory is invalid");
for (const name of ["SECURITY.md", "PRIVACY.md"]) {
  check(readFileSync(join(dist, name)).equals(readFileSync(join(root, name))), `${name} build copy differs from authoritative root document`);
}
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
