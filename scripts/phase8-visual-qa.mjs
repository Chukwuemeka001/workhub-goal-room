import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { resolveConfig } from "vite";
import { resolveBrowserExecutable } from "./browser-resolver.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const productionPaths = ["index.html", "package.json", "vite.config.ts", "src"];
function resolveTestedProductionIdentity() {
  const explicitCommit = process.env.PHASE8_TESTED_PRODUCTION_COMMIT;
  const explicitTree = process.env.PHASE8_TESTED_PRODUCTION_TREE;
  if (Boolean(explicitCommit) !== Boolean(explicitTree)) throw new Error("Phase 8 provenance requires both PHASE8_TESTED_PRODUCTION_COMMIT and PHASE8_TESTED_PRODUCTION_TREE");
  const commit = explicitCommit ?? execFileSync("git", ["-C", root, "log", "-1", "--format=%H", "--", ...productionPaths], { encoding: "utf8" }).trim();
  const tree = explicitTree ?? execFileSync("git", ["-C", root, "rev-parse", `${commit}^{tree}`], { encoding: "utf8" }).trim();
  if (!/^[0-9a-f]{40}$/.test(commit) || !/^[0-9a-f]{40}$/.test(tree)) throw new Error("Phase 8 provenance must be an exact 40-character lowercase Git commit/tree pair");
  return { commit, tree };
}
const testedProduction = resolveTestedProductionIdentity();
const output = join(root, "evaluation", "phase8");
const port = Number(process.env.PHASE8_QA_PORT ?? "4189");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PHASE8_QA_PORT must be an integer from 1 through 65535");
const profile = await mkdtemp(join(tmpdir(), "workhub-phase8-visual-"));
const chromePath = resolveBrowserExecutable();
const origin = `http://127.0.0.1:${port}`;
const { base } = await resolveConfig({}, "serve");
const fixtureUrl = `${origin}${base}qa/phase8-visual-fixture.html`;
const states = ["goal", "goal-revision", "plan", "plan-revision", "fail", "pass", "completion", "accepted"];
const viewports = [
  { family: "desktop", width: 1280, height: 800, mobile: false },
  { family: "desktop", width: 1440, height: 900, mobile: false },
  { family: "desktop", width: 1728, height: 1117, mobile: false },
  { family: "mobile", width: 375, height: 667, mobile: true },
  { family: "mobile", width: 393, height: 852, mobile: true },
  { family: "mobile", width: 430, height: 932, mobile: true },
  { family: "landscape", width: 852, height: 393, mobile: true },
  { family: "keyboard", width: 393, height: 552, mobile: true },
];
const representative = [
  { state: "goal", width: 1440, height: 900, family: "desktop" },
  { state: "fail", width: 1440, height: 900, family: "desktop" },
  { state: "accepted", width: 1440, height: 900, family: "desktop" },
  { state: "completion", width: 393, height: 852, family: "mobile" },
  { state: "accepted", width: 393, height: 552, family: "keyboard" },
];
const fixtureTokens = ["phase8-visual-fixture", "__phase8Qa", "buildPhase8Authority", "PHASE8_HOSTILE_MARKERS"];
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
async function waitFor(predicate, label, attempts = 200) { for (let index = 0; index < attempts; index += 1) { try { const value = await predicate(); if (value) return value; } catch {} await wait(50); } throw new Error(`Timed out waiting for ${label}`); }
async function run(command, args) { await new Promise((resolveRun, reject) => { const child = spawn(command, args, { cwd: root, stdio: "inherit" }); child.once("error", reject); child.once("exit", (code, signal) => code === 0 ? resolveRun() : reject(new Error(`${command} ${args.join(" ")} exited ${code ?? signal}`))); }); }
async function filesUnder(directory) { const files = []; for (const entry of await readdir(directory)) { const path = join(directory, entry); if ((await stat(path)).isDirectory()) files.push(...await filesUnder(path)); else files.push(path); } return files; }
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pngDimensions = (bytes) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });

let server; let chrome; let socket;
try {
  await mkdir(output, { recursive: true });
  await run("npm", ["run", "build"]);
  const dist = join(root, "dist");
  const fixtureLeaks = [];
  for (const path of (await filesUnder(dist)).filter((file) => [".html", ".js", ".css"].includes(extname(file)))) {
    const content = await readFile(path, "utf8");
    for (const token of fixtureTokens) if (content.includes(token)) fixtureLeaks.push({ file: path.slice(dist.length + 1), token });
  }
  if (fixtureLeaks.length) throw new Error(`Phase8 fixture leaked into production bundle: ${JSON.stringify(fixtureLeaks)}`);
  server = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, stdio: "ignore" });
  await waitFor(async () => (await fetch(fixtureUrl)).ok, "Phase8 Vite fixture");
  chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--disable-extensions", "--disable-component-extensions-with-background-pages", "--hide-scrollbars", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  const activePort = await waitFor(async () => (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0], "Chrome DevTools");
  const tabs = await (await fetch(`http://127.0.0.1:${activePort}/json`)).json();
  socket = new WebSocket(tabs[0].webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => { socket.addEventListener("open", resolveOpen, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let nextId = 0; const pending = new Map();
  socket.addEventListener("message", (event) => { const message = JSON.parse(event.data); if (!message.id) return; const request = pending.get(message.id); if (!request) return; pending.delete(message.id); clearTimeout(request.timer); message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result); });
  const call = (method, params = {}) => new Promise((resolveCall, reject) => { const id = ++nextId; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 60000); pending.set(id, { resolve: resolveCall, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
  await call("Page.enable"); await call("Runtime.enable"); await call("Accessibility.enable");
  async function evaluate(expression) { const response = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text); return response.result.value; }
  async function navigate(state, width, height, mobile) { await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height }); await call("Page.navigate", { url: `${fixtureUrl}?state=${state}` }); await waitFor(async () => evaluate("document.readyState==='complete' && Boolean(window.__phase8Qa)"), `${state} ${width}x${height}`); }
  async function pressKey(key) { const code = key; const vk = key === "Home" ? 36 : key === "End" ? 35 : key === "ArrowLeft" ? 37 : 39; await call("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk }); await call("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk }); }
  const rows = [];
  for (const viewport of viewports) for (const state of states) {
    await navigate(state, viewport.width, viewport.height, viewport.mobile);
    const measurement = await evaluate("window.__phase8Qa.measurements()");
    rows.push({ ...viewport, state, ...measurement });
  }
  const axRows = [];
  for (const viewport of viewports) {
    await navigate("accepted", viewport.width, viewport.height, viewport.mobile);
    const tree = await call("Accessibility.getFullAXTree");
    const visibleNodes = tree.nodes.filter((node) => !node.ignored);
    const mains = visibleNodes.filter((node) => node.role?.value === "main").map((node) => node.name?.value ?? "");
    const tabs = visibleNodes.filter((node) => node.role?.value === "tab").map((node) => node.name?.value ?? "");
    const panels = visibleNodes.filter((node) => node.role?.value === "tabpanel").map((node) => node.name?.value ?? "");
    axRows.push({ ...viewport, mainCount: mains.length, mainNames: mains, tabCount: tabs.length, tabNames: tabs, panelCount: panels.length, panelNames: panels });
  }
  const keyboard = [];
  for (const viewport of [viewports[1], viewports[4]]) {
    await navigate("accepted", viewport.width, viewport.height, viewport.mobile);
    const selector = viewport.family === "desktop" ? "#desktop-tab-goal" : "#mobile-tab-now";
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    const authority = await evaluate("window.__phase8Qa.authorityJson()");
    const sequence = [];
    const read = async (key) => sequence.push(await evaluate(`({key:${JSON.stringify(key)},focused:document.activeElement?.id??null,measurement:window.__phase8Qa.measurements(),authorityStable:window.__phase8Qa.authorityJson()===${JSON.stringify(authority)},ownerCalls:window.__phase8Qa.ownerCalls()})`));
    await read("initial");
    for (const key of ["ArrowRight", "End", "ArrowRight", "ArrowLeft", "Home"]) { await pressKey(key); await read(key); }
    keyboard.push({ family: viewport.family, viewport: { width: viewport.width, height: viewport.height }, sequence, events: await evaluate("window.__phase8Qa.keyboardEvents()") });
  }
  await navigate("accepted", 1440, 900, false);
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const reducedMotion = await evaluate(`(()=>{const styles=[...document.querySelectorAll('*')].map(node=>getComputedStyle(node));return {mediaMatches:matchMedia('(prefers-reduced-motion: reduce)').matches,nonZeroAnimations:styles.filter(style=>!['0s','0ms'].includes(style.animationDuration)).length,nonZeroTransitions:styles.filter(style=>!['0s','0ms'].includes(style.transitionDuration)).length}})()`);
  const screenshots = [];
  for (const shot of representative) {
    await navigate(shot.state, shot.width, shot.height, shot.family !== "desktop");
    const capture = await call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    const bytes = Buffer.from(capture.data, "base64");
    const name = `visual-${shot.state}-${shot.width}x${shot.height}.png`;
    await writeFile(join(output, name), bytes);
    screenshots.push({ path: `evaluation/phase8/${name}`, sha256: sha256(bytes), ...pngDimensions(bytes), state: shot.state, family: shot.family });
  }
  const rowFailures = rows.filter((row) => row.document.overflowX !== 0 || row.body.overflowX !== 0 || row.roots.oppositeDisplay !== "none" || row.roots.oppositeRects !== 0 || row.roots.activeDisplay === "none" || row.roots.activeRects !== 1 || row.semantics.tablistCount !== 1 || row.semantics.tabCount !== 4 || row.semantics.selectedTabCount !== 1 || row.semantics.panelCount !== 1 || row.semantics.panelLabelledBy !== row.semantics.selectedTabId || !row.controlsHorizontallyReachable || row.controlCollisions.length !== 0 || row.hostile.injectedNodes !== 0 || row.hostile.markers.some(({ renderedLiterally }) => !renderedLiterally));
  const axFailures = axRows.filter((row) => row.mainCount !== 1 || row.tabCount !== 4 || row.panelCount !== 1);
  const keyboardFailures = keyboard.filter((group) => group.sequence.some((entry) => !entry.authorityStable || entry.ownerCalls.length !== 0 || entry.focused !== entry.measurement.semantics.selectedTabId || entry.measurement.semantics.panelLabelledBy !== entry.measurement.semantics.selectedTabId) || group.events.length !== 5 || group.events.some((event) => !event.trusted || !event.defaultPrevented));
  if (rowFailures.length || axFailures.length || keyboardFailures.length || !reducedMotion.mediaMatches || reducedMotion.nonZeroAnimations !== 0 || reducedMotion.nonZeroTransitions !== 0) {
    console.error(JSON.stringify({ rowFailures: rowFailures.map((row) => ({ family: row.family, viewport: row.viewport, state: row.state, documentOverflow: row.document.overflowX, bodyOverflow: row.body.overflowX, roots: row.roots, semantics: row.semantics, controlsHorizontallyReachable: row.controlsHorizontallyReachable, collisionCount: row.controlCollisions.length, hostile: row.hostile })), axFailures, keyboardFailures }, null, 2));
    throw new Error(`Phase8 visual QA failed rows=${rowFailures.length} ax=${axFailures.length} keyboard=${keyboardFailures.length} motion=${JSON.stringify(reducedMotion)}`);
  }
  const evidence = {
    schemaVersion: 1,
    kind: "phase8-qa-only-production-projection-max-hostile",
    claimBoundary: "QA-only entry renders production desktop/mobile projections and components over states admitted through the real kernel, production WebMCP callbacks, verifier, and owner controller; this is distinct from native production evidence.",
    testedProductionCommit: testedProduction.commit,
    testedProductionTree: testedProduction.tree,
    producerBoundaries: rows.find((row) => row.state === "accepted").source,
    revisionProbe: rows.find((row) => row.state === "plan-revision").source,
    summary: {
      rowCount: rows.length,
      maximumDocumentHorizontalOverflow: Math.max(...rows.map((row) => row.document.overflowX)),
      maximumBodyHorizontalOverflow: Math.max(...rows.map((row) => row.body.overflowX)),
      maximumDocumentScrollY: Math.max(...rows.map((row) => row.document.maxScrollY)),
      maximumContainerScrollY: Math.max(...rows.map((row) => row.maximumContainerScrollY)),
      minimumControlHeight: Math.min(...rows.flatMap((row) => row.minControlHeight === null ? [] : [row.minControlHeight])),
      maximumControlCollisionCount: Math.max(...rows.map((row) => row.controlCollisions.length)),
      maximumInjectedNodeCount: Math.max(...rows.map((row) => row.hostile.injectedNodes)),
    },
    matrix: { viewports, states, rows },
    accessibility: { claim: "Chrome AX-tree inspection only; no automated VoiceOver claim", rows: axRows },
    trustedKeyboard: keyboard,
    reducedMotion,
    bundleExclusion: { builtProduction: true, fixtureTokens, fixtureLeaks },
    screenshots,
    findings: { P0: 0, P1: 0, rowFailures: 0, axFailures: 0, keyboardFailures: 0 },
  };
  await writeFile(join(output, "visual-max-hostile.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ rows: rows.length, axRows: axRows.length, keyboardGroups: keyboard.length, screenshots, fixtureLeaks, reducedMotion, failures: 0 }, null, 2));
} finally {
  socket?.close(); server?.kill("SIGTERM"); chrome?.kill("SIGTERM"); await wait(150);
  for (const child of [server, chrome].filter(Boolean)) if (child.exitCode === null) child.kill("SIGKILL");
  for (let attempt = 0; attempt < 5; attempt += 1) { try { await rm(profile, { recursive: true, force: true }); break; } catch (error) { if (attempt === 4) throw error; await wait(100); } }
}
