import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const evidence = join(root, "evaluation", "mobile-phase5");
const port = 4178;
const origin = `http://127.0.0.1:${port}`;
const chromePath = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  `${process.env.HOME}/Applications/BrowserOS.app/Contents/MacOS/BrowserOS`,
].find((candidate) => candidate && existsSync(candidate));
if (!chromePath) throw new Error("Set CHROME_BIN to a Chromium-compatible browser executable");
const profile = await mkdtemp(join(tmpdir(), "workhub-mobile-qa-"));
let server;
let chrome;

const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
async function waitFor(predicate, label, attempts = 100) {
  for (let index = 0; index < attempts; index += 1) {
    try { const value = await predicate(); if (value) return value; } catch {}
    await wait(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

try {
  await mkdir(evidence, { recursive: true });
  server = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, stdio: "ignore" });
  await waitFor(async () => (await fetch(`${origin}/qa/mobile-fixture.html`)).ok, "Vite");
  chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--disable-extensions", "--disable-component-extensions-with-background-pages", "--hide-scrollbars", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  const activePort = await waitFor(async () => (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0], "Chrome DevTools");
  const tabs = await (await fetch(`http://127.0.0.1:${activePort}/json`)).json();
  const socket = new WebSocket(tabs[0].webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => { socket.addEventListener("open", resolveOpen, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  const call = (method, params = {}) => new Promise((resolveCall, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 60000);
    pending.set(id, { resolve: resolveCall, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await call("Page.enable");
  await call("Runtime.enable");

  async function navigate(url, width, height, requireQa = true) {
    await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true, screenWidth: width, screenHeight: height });
    await call("Page.navigate", { url });
    await waitFor(async () => {
      const result = await call("Runtime.evaluate", { expression: `document.readyState === 'complete' && ${requireQa ? "Boolean(window.__mobileQa)" : "true"}`, returnByValue: true });
      return result.result.value;
    }, `fixture ${url}`);
  }
  async function evaluate(expression) {
    const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  async function screenshot(path) {
    const result = await call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    await writeFile(path, Buffer.from(result.data, "base64"));
  }
  async function pressKey(key, code) {
    const windowsVirtualKeyCode = key === "Home" ? 36 : key === "End" ? 35 : key === "ArrowLeft" ? 37 : key === "Enter" ? 13 : key === " " ? 32 : 39;
    await call("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode });
    await call("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
  }

  const matrix = [
    [375, 667], [393, 852], [430, 932], [852, 393],
  ];
  const states = ["empty", "captured", "goal", "plan", "fail", "pass", "completion", "terminal", "max"];
  const measurements = [];
  for (const [width, height] of matrix) {
    for (const state of states) {
      await navigate(`${origin}/qa/mobile-fixture.html?state=${state}`, width, height);
      measurements.push(await evaluate("window.__mobileQa.measurements()"));
    }
  }
  for (const state of ["captured", "goal", "fail", "completion"]) {
    await navigate(`${origin}/qa/mobile-fixture.html?state=${state}`, 393, 852);
    await screenshot(join(evidence, `${state}-393x852.png`));
  }
  await navigate(`${origin}/qa/mobile-fixture.html?state=goal&sheet=1`, 393, 552);
  const keyboardSheet = await evaluate("window.__mobileQa.measurements()");
  measurements.push(keyboardSheet);
  await navigate(`${origin}/qa/mobile-fixture.html?state=goal`, 393, 852);
  const semantic = await evaluate(`(() => {
    const before = JSON.stringify(window.__mobileQa.view);
    document.querySelector('#mobile-tab-proof').click();
    return {
      selectedTab: window.__mobileQa.selectedTab(),
      authorityStable: before === JSON.stringify(window.__mobileQa.view),
      selectedSemantics: document.querySelector('#mobile-tab-proof').getAttribute('aria-selected') === 'true',
      focusedTabId: document.activeElement?.id ?? null,
      panelSemantics: document.querySelector('[role=tabpanel]')?.getAttribute('aria-labelledby') === 'mobile-tab-proof',
      tabCount: document.querySelectorAll('[role=tab]').length,
      conciseLiveRegions: document.querySelectorAll('[aria-live]').length === 1,
    };
  })()`);
  await navigate(`${origin}/qa/mobile-fixture.html?state=goal`, 393, 852);
  const keyboardAuthorityBefore = await evaluate("JSON.stringify(window.__mobileQa.view)");
  await evaluate("document.querySelector('#mobile-tab-now').focus()");
  const keyboardSequence = [];
  const readKeyboardState = async (key) => keyboardSequence.push(await evaluate(`({
    key: ${JSON.stringify(key)},
    focusedTabId: document.activeElement?.id ?? null,
    selectedTab: window.__mobileQa.selectedTab(),
    panelBinding: document.querySelector('[role=tabpanel]')?.getAttribute('aria-labelledby') ?? null,
    authorityStable: JSON.stringify(window.__mobileQa.view) === ${JSON.stringify(keyboardAuthorityBefore)},
    ownerCalls: window.__mobileQa.ownerCalls(),
  })`));
  await readKeyboardState("initial");
  for (const [key, code, label] of [["ArrowRight", "ArrowRight", "ArrowRight"], ["End", "End", "End"], ["ArrowRight", "ArrowRight", "ArrowRight"], ["ArrowLeft", "ArrowLeft", "ArrowLeft"], ["Home", "Home", "Home"], ["Enter", "Enter", "Enter"], [" ", "Space", "Space"]]) {
    await pressKey(key, code);
    await readKeyboardState(label);
  }
  const keyboardEvents = await evaluate("window.__mobileQa.keyboardEvents()");
  await navigate(`${origin}/qa/mobile-fixture.html?state=empty`, 393, 852);
  const intentRecovery = await evaluate(`(async () => {
    const form = document.querySelector('.mobile-intent-form');
    const input = document.querySelector('#mobile-owner-intent');
    input.value = '   ';
    form.requestSubmit();
    const invalid = { valid: input.validity.valid, message: input.validationMessage };
    input.value = '  Build a governed iPhone Goal Room.  ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const validAfterEdit = input.validity.valid;
    form.requestSubmit();
    await Promise.resolve();
    return {
      invalid,
      validAfterEdit,
      callCount: window.__mobileQa.intentCalls().length,
      intents: window.__mobileQa.intentCalls(),
    };
  })()`);
  await navigate(`${origin}/`, 1440, 900, false);
  const desktop = await evaluate(`({
    width: innerWidth, height: innerHeight,
    desktopVisible: getComputedStyle(document.querySelector('.desktop-surface')).display !== 'none',
    mobileHidden: getComputedStyle(document.querySelector('.mobile-room')).display === 'none',
    documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  })`);

  const failures = measurements.filter((entry) =>
    entry.documentOverflow !== 0 || entry.bodyOverflow !== 0 || entry.rootOverflow !== 0 ||
    entry.minControlHeight < 44 || entry.dockTabCollision !== 0 || !entry.dockInsideViewport ||
    !entry.tabInsideViewport || (!["empty", "max"].includes(entry.state) && !entry.hostileLiteral) || entry.injectedElements !== 0 ||
    (entry.dialog && (!entry.dialog.inside || !entry.dialog.focused))
  );
  if (!semantic.authorityStable || !semantic.selectedSemantics || semantic.focusedTabId !== "mobile-tab-proof" || !semantic.panelSemantics || semantic.tabCount !== 4 || !semantic.conciseLiveRegions) failures.push({ semantic });
  const expectedKeyboardSequence = [
    ["mobile-tab-now", "now", "mobile-tab-now"],
    ["mobile-tab-plan", "plan", "mobile-tab-plan"],
    ["mobile-tab-activity", "activity", "mobile-tab-activity"],
    ["mobile-tab-now", "now", "mobile-tab-now"],
    ["mobile-tab-activity", "activity", "mobile-tab-activity"],
    ["mobile-tab-now", "now", "mobile-tab-now"],
    ["mobile-tab-now", "now", "mobile-tab-now"],
    ["mobile-tab-now", "now", "mobile-tab-now"],
  ];
  if (keyboardSequence.some((entry, index) =>
    entry.focusedTabId !== expectedKeyboardSequence[index][0] ||
    entry.selectedTab !== expectedKeyboardSequence[index][1] ||
    entry.panelBinding !== expectedKeyboardSequence[index][2] ||
    !entry.authorityStable || entry.ownerCalls.length !== 0
  ) || keyboardEvents.length !== 7 || keyboardEvents.some((entry, index) => !entry.trusted || (index < 5 ? !entry.defaultPrevented : entry.defaultPrevented))) failures.push({ keyboardSequence, keyboardEvents });
  if (intentRecovery.invalid.valid || intentRecovery.invalid.message !== "Enter between 1 and 1000 non-whitespace characters." || !intentRecovery.validAfterEdit || intentRecovery.callCount !== 1 || intentRecovery.intents[0] !== "Build a governed iPhone Goal Room.") failures.push({ intentRecovery });
  if (!desktop.desktopVisible || !desktop.mobileHidden || desktop.documentOverflow !== 0) failures.push({ desktop });
  await writeFile(join(evidence, "measurements.json"), `${JSON.stringify({ generatedBy: "npm run qa:mobile", semantic, keyboardSequence, keyboardEvents, intentRecovery, desktop, measurements, failures }, null, 2)}\n`);
  const contactHtml = `<!doctype html><style>body{margin:0;background:#050607;color:white;font:14px system-ui}main{display:grid;grid-template-columns:repeat(2,180px);gap:14px;padding:14px}figure{margin:0}img{display:block;width:180px;height:auto}figcaption{padding:5px 0 0}</style><main>${["captured","goal","fail","completion"].map((state) => `<figure><img src="/${`evaluation/mobile-phase5/${state}-393x852.png`}"><figcaption>${state}</figcaption></figure>`).join("")}</main>`;
  await writeFile(join(evidence, "contact-sheet.html"), contactHtml);
  await navigate(`${origin}/evaluation/mobile-phase5/contact-sheet.html`, 402, 850, false);
  await screenshot(join(evidence, "contact-sheet.png"));
  socket.close();
  if (failures.length) throw new Error(`Mobile QA failed ${failures.length} measurement rows`);
  console.log(JSON.stringify({ states: states.length, viewportRows: matrix.length * states.length, totalMeasurements: measurements.length, interactionAssertions: 3, keyboardSteps: keyboardSequence.length, screenshots: 5, failures: 0, evidence }, null, 2));
} finally {
  server?.kill("SIGTERM");
  chrome?.kill("SIGTERM");
  await wait(100);
  for (const child of [server, chrome].filter(Boolean)) if (child.exitCode === null) child.kill("SIGKILL");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { await rm(profile, { recursive: true, force: true }); break; }
    catch (error) { if (attempt === 4) throw error; await wait(100); }
  }
}
