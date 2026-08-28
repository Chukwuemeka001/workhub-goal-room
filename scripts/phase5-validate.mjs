import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const read = (path) => readFileSync(join(root, path), "utf8");
const receipt = JSON.parse(read("evaluation/phase5-qualification.json"));
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

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
