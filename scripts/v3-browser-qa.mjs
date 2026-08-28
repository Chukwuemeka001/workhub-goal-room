import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveBrowserExecutable } from "./browser-resolver.mjs";

const mode = process.argv[2];
const allowedModes = new Set(["visual", "responsive", "a11y", "hostile"]);
if (!allowedModes.has(mode)) throw new Error(`Expected V3 QA mode: ${[...allowedModes].join(", ")}`);

const root = resolve(new URL("..", import.meta.url).pathname);
const output = join(root, "evaluation", "v3");
const profile = await mkdtemp(join(tmpdir(), `workhub-v3-${mode}-`));
const chromePath = resolveBrowserExecutable();
const port = 4193 + [...allowedModes].indexOf(mode);
const origin = `http://127.0.0.1:${port}`;
const storyIds = Array.from({ length: 14 }, (_, index) => `S${String(index + 1).padStart(2, "0")}`);
const responsiveViewports = [
  { name: "minimum", width: 320, height: 568, expected: "mobile" },
  { name: "phone", width: 393, height: 852, expected: "mobile" },
  { name: "tablet-portrait", width: 768, height: 1024, expected: "mobile" },
  { name: "tablet-landscape", width: 1024, height: 768, expected: "mobile" },
  { name: "mobile-boundary", width: 1199, height: 900, expected: "mobile" },
  { name: "desktop-boundary", width: 1200, height: 900, expected: "desktop" },
  { name: "desktop", width: 1440, height: 900, expected: "desktop" },
  { name: "wide-desktop", width: 1728, height: 1117, expected: "desktop" },
];
const matrixByMode = {
  responsive: { stories: storyIds, viewports: responsiveViewports, tab: null },
  visual: {
    stories: ["S01", "S03", "S06", "S09", "S10", "S12", "S13", "S14"],
    viewports: [responsiveViewports[1], responsiveViewports[6]],
    tab: null,
  },
  a11y: {
    stories: ["S01", "S02", "S05", "S09", "S10", "S12", "S13", "S14"],
    viewports: [responsiveViewports[1], responsiveViewports[5], responsiveViewports[6]],
    tab: null,
  },
  hostile: {
    stories: ["S01", "S02", "S03", "S05", "S06", "S09", "S10", "S12", "S14"],
    viewports: [responsiveViewports[0], responsiveViewports[5], responsiveViewports[7]],
    tab: "activity",
  },
};
const matrix = matrixByMode[mode];
const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pngDimensions = (bytes) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });

async function waitFor(predicate, label, attempts = 240) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch {}
    await wait(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

let server;
let chrome;
let socket;
try {
  await mkdir(output, { recursive: true });
  server = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: root,
    stdio: "ignore",
  });
  await waitFor(async () => (await fetch(`${origin}/qualification/v3-fixture.html`)).ok, "V3 qualification fixture");
  chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-component-extensions-with-background-pages",
    "--hide-scrollbars",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: "ignore" });
  const activePort = await waitFor(async () => (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0], "Chrome DevTools");
  const tabs = await (await fetch(`http://127.0.0.1:${activePort}/json`)).json();
  socket = new WebSocket(tabs[0].webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const call = (method, params = {}) => new Promise((resolveCall, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 60_000);
    pending.set(id, { resolve: resolveCall, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await call("Page.enable");
  await call("Page.bringToFront");
  await call("Runtime.enable");
  await call("Accessibility.enable");
  async function evaluate(expression) {
    const response = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result.value;
  }
  async function navigate(story, viewport, options = {}) {
    await call("Emulation.setPageScaleFactor", { pageScaleFactor: options.pageScaleFactor ?? 1 });
    await call("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.expected === "mobile",
      screenWidth: viewport.width,
      screenHeight: viewport.height,
    });
    const query = new URLSearchParams({ story });
    if (options.tab ?? matrix.tab) query.set("tab", options.tab ?? matrix.tab);
    if (mode === "hostile" || options.hostile) query.set("hostile", "1");
    await call("Page.navigate", { url: `${origin}/qualification/v3-fixture.html?${query}` });
    await waitFor(
      async () => evaluate("document.readyState === 'complete' && window.__v3Qualification?.ready === true"),
      `${mode} ${story} ${viewport.width}x${viewport.height}`,
    );
  }
  async function pressKey(key, modifiers = 0) {
    const virtualKeyCodes = { Home: 36, End: 35, ArrowLeft: 37, ArrowRight: 39, Tab: 9, Escape: 27 };
    const windowsVirtualKeyCode = virtualKeyCodes[key];
    await call("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, modifiers, windowsVirtualKeyCode });
    await call("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, modifiers, windowsVirtualKeyCode });
  }

  const rows = [];
  for (const viewport of matrix.viewports) {
    for (const story of matrix.stories) {
      await navigate(story, viewport);
      const measurement = await evaluate("window.__v3Qualification.measurements()");
      rows.push({
        mode,
        ...measurement,
        viewport: { ...viewport, actual: measurement.viewport },
      });
    }
  }

  const commonFailures = rows.filter((row) => {
    const expectedMobile = row.viewport.expected === "mobile";
    const rootFailed = row.roots.active !== (expectedMobile ? "mobile-room" : "desktop-room") ||
      row.roots.activeDisplay === "none" || row.roots.activeRects !== 1 ||
      row.roots.oppositeDisplay !== "none" || row.roots.oppositeRects !== 0;
    const semanticFailed = row.semantics.mainCount !== 1 || row.semantics.tablistCount !== 1 ||
      row.semantics.tabCount !== 4 || row.semantics.selectedTabCount !== 1 ||
      row.semantics.panelCount !== 1 || row.semantics.panelLabelledBy !== row.semantics.selectedTabId;
    const targetFailed = row.controls.minimumHeight === null || row.controls.minimumHeight < 43.5 || !row.controls.allHorizontallyReachable;
    const focusPainted = row.focus && (
      (row.focus.outlineStyle !== "none" && Number.parseFloat(row.focus.outlineWidth) >= 2.5) ||
      row.focus.boxShadow.includes("rgb(240, 189, 114)")
    );
    const focusFailed = !row.focus || row.focus.activeId !== row.semantics.selectedTabId || !focusPainted;
    const dockFailed = expectedMobile && (!row.safeDock || row.safeDock.overlap > 0.5 || !row.safeDock.dockInside || !row.safeDock.tabsInside);
    const toolsFailed = !expectedMobile && (!row.staticTools || row.staticTools.open || row.staticTools.toolCount !== 6 || row.staticTools.interactiveDescendants !== 0);
    return rootFailed || semanticFailed || targetFailed || focusFailed || dockFailed || toolsFailed ||
      row.overflow.documentX !== 0 || row.overflow.bodyX !== 0 || row.overflow.activeX !== 0;
  });

  const modeFailures = [];
  const accessibility = [];
  const keyboard = [];
  const screenshots = [];
  let reducedMotion = null;
  let zoom = null;
  const acceptanceFocus = [];
  const hostilePanels = [];

  if (mode === "a11y") {
    for (const viewport of [responsiveViewports[1], responsiveViewports[6]]) {
      for (const story of ["S01", "S09", "S10", "S12", "S13", "S14"]) {
        await navigate(story, viewport);
        const tree = await call("Accessibility.getFullAXTree");
        const visible = tree.nodes.filter((node) => !node.ignored);
        const row = {
          story,
          viewport,
          mainNames: visible.filter((node) => node.role?.value === "main").map((node) => node.name?.value ?? ""),
          tabNames: visible.filter((node) => node.role?.value === "tab").map((node) => node.name?.value ?? ""),
          panelNames: visible.filter((node) => node.role?.value === "tabpanel").map((node) => node.name?.value ?? ""),
        };
        accessibility.push(row);
        if (row.mainNames.length !== 1 || row.tabNames.length !== 4 || row.panelNames.length !== 1) modeFailures.push({ kind: "ax-tree", ...row });
      }
      await navigate("S14", viewport);
      const activePrefix = viewport.expected === "mobile" ? "mobile" : "desktop";
      await evaluate(`document.querySelector('#${activePrefix}-tab-goal').focus()`);
      const initialOwnerCalls = await evaluate("window.__v3Qualification.ownerCalls()");
      const sequence = [];
      for (const key of ["ArrowRight", "End", "ArrowLeft", "Home"]) {
        await pressKey(key);
        sequence.push(await evaluate(`({key:${JSON.stringify(key)},activeId:document.activeElement?.id??null,selected:window.__v3Qualification.measurements().semantics.selectedTabId,ownerCalls:window.__v3Qualification.ownerCalls()})`));
      }
      keyboard.push({ viewport, initialOwnerCalls, sequence });
      if (initialOwnerCalls.length || sequence.some((entry) => entry.activeId !== entry.selected || entry.ownerCalls.length)) modeFailures.push({ kind: "keyboard", viewport, sequence });
    }
    for (const viewport of [responsiveViewports[1], responsiveViewports[6]]) {
      await navigate("S13", viewport);
      const selector = viewport.expected === "mobile" ? ".mobile-action-dock .mobile-button.primary" : ".desktop-owner-action .desktop-action.primary";
      await evaluate(`window.__v3AcceptanceTrigger=document.querySelector(${JSON.stringify(selector)});window.__v3AcceptanceTrigger.focus();window.__v3AcceptanceTrigger.click()`);
      const sequence = [await evaluate(`({activeId:document.activeElement?.id??null,inside:document.querySelector('#acceptance-dialog').contains(document.activeElement),open:document.querySelector('#acceptance-dialog').open})`)];
      for (let index = 0; index < 10; index += 1) {
        await pressKey("Tab");
        sequence.push(await evaluate(`({activeId:document.activeElement?.id??null,inside:document.querySelector('#acceptance-dialog').contains(document.activeElement),open:document.querySelector('#acceptance-dialog').open})`));
      }
      await evaluate("document.querySelector('#cancel-acceptance').focus()");
      await pressKey("Tab", 8);
      const reverse = await evaluate(`({activeId:document.activeElement?.id??null,inside:document.querySelector('#acceptance-dialog').contains(document.activeElement),open:document.querySelector('#acceptance-dialog').open})`);
      await pressKey("Escape");
      const closed = await evaluate(`({open:document.querySelector('#acceptance-dialog').open,returned:document.activeElement===window.__v3AcceptanceTrigger,ownerCalls:window.__v3Qualification.ownerCalls()})`);
      await evaluate("window.__v3AcceptanceTrigger.click()");
      await evaluate("document.querySelector('#cancel-acceptance').click()");
      const cancelClosed = await evaluate(`({open:document.querySelector('#acceptance-dialog').open,returned:document.activeElement===window.__v3AcceptanceTrigger,ownerCalls:window.__v3Qualification.ownerCalls()})`);
      const row = { viewport, sequence, reverse, closed, cancelClosed };
      acceptanceFocus.push(row);
      if (sequence.some((entry) => !entry.open || !entry.inside) || !reverse.open || !reverse.inside || reverse.activeId !== "confirm-acceptance" || closed.open || !closed.returned || closed.ownerCalls.includes("confirm-acceptance") || cancelClosed.open || !cancelClosed.returned || cancelClosed.ownerCalls.includes("confirm-acceptance")) {
        modeFailures.push({ kind: "acceptance-focus", ...row });
      }
    }
    await navigate("S12", responsiveViewports[6]);
    await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    reducedMotion = await evaluate(`(()=>{const styles=[...document.querySelectorAll('*')].map(node=>getComputedStyle(node));return {matches:matchMedia('(prefers-reduced-motion: reduce)').matches,animations:styles.filter(style=>parseFloat(style.animationDuration)>0).length,transitions:styles.filter(style=>parseFloat(style.transitionDuration)>0).length}})()`);
    if (!reducedMotion.matches || reducedMotion.animations || reducedMotion.transitions) modeFailures.push({ kind: "reduced-motion", reducedMotion });
  }

  if (mode === "hostile") {
    for (const row of rows) {
      if (row.hostile.injectedNodeCount !== 0 || row.hostile.longestTextWidth > 1 || row.hostile.markers.some(({ renderedLiterally }) => !renderedLiterally)) {
        modeFailures.push({ kind: "hostile", story: row.story.id, viewport: row.viewport, hostile: row.hostile });
      }
    }
    await navigate("S03", responsiveViewports[6], { tab: "activity", pageScaleFactor: 2 });
    zoom = await evaluate("window.__v3Qualification.measurements()");
    if (zoom.overflow.documentX !== 0 || zoom.overflow.bodyX !== 0 || zoom.hostile.injectedNodeCount !== 0 || zoom.hostile.longestTextWidth > 1) {
      modeFailures.push({ kind: "zoom-hostile", zoom });
    }
    for (const viewport of [responsiveViewports[0], responsiveViewports[5], responsiveViewports[7]]) {
      for (const tab of ["goal", "plan", "proof", "activity"]) {
        await navigate("S12", viewport, { tab, hostile: true });
        const measurement = await evaluate("window.__v3Qualification.measurements()");
        const row = { viewport, tab, overflow: measurement.overflow, hostile: measurement.hostile };
        hostilePanels.push(row);
        if (row.overflow.documentX !== 0 || row.overflow.bodyX !== 0 || row.overflow.activeX !== 0 || row.hostile.injectedNodeCount !== 0 || row.hostile.longestTextWidth > 1) {
          modeFailures.push({ kind: "hostile-panel", ...row });
        }
      }
    }
  }

  if (mode === "visual") {
    const captures = [
      { story: "S01", viewport: responsiveViewports[6] },
      { story: "S02", viewport: responsiveViewports[6] },
      { story: "S03", viewport: responsiveViewports[6] },
      { story: "S07", viewport: responsiveViewports[6] },
      { story: "S08", viewport: responsiveViewports[6] },
      { story: "S09", viewport: responsiveViewports[6] },
      { story: "S10", viewport: responsiveViewports[6] },
      { story: "S12", viewport: responsiveViewports[1] },
      { story: "S12", viewport: responsiveViewports[6], tab: "proof", suffix: "proof" },
      { story: "S13", viewport: responsiveViewports[6] },
      { story: "S13", viewport: responsiveViewports[1] },
      { story: "S13", viewport: responsiveViewports[6], openAcceptance: true, suffix: "modal" },
      { story: "S13", viewport: responsiveViewports[1], openAcceptance: true, suffix: "modal" },
      { story: "S14", viewport: responsiveViewports[6] },
      { story: "S14", viewport: responsiveViewports[1] },
      { story: "S12", viewport: responsiveViewports[4], suffix: "boundary-mobile" },
      { story: "S12", viewport: responsiveViewports[5], suffix: "boundary-desktop" },
      { story: "S03", viewport: responsiveViewports[0], hostile: true, tab: "activity", suffix: "hostile" },
      { story: "S03", viewport: responsiveViewports[7], hostile: true, tab: "activity", suffix: "hostile" },
    ];
    for (const capture of captures) {
      await navigate(capture.story, capture.viewport, capture);
      if (capture.openAcceptance) {
        const selector = capture.viewport.expected === "mobile" ? ".mobile-action-dock .mobile-button.primary" : ".desktop-owner-action .desktop-action.primary";
        await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
      }
      const result = await call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      const bytes = Buffer.from(result.data, "base64");
      const qualifier = capture.suffix ? `-${capture.suffix}` : "";
      const name = `v3-${capture.story.toLowerCase()}${qualifier}-${capture.viewport.width}x${capture.viewport.height}.png`;
      await writeFile(join(output, name), bytes);
      screenshots.push({ path: `evaluation/v3/${name}`, story: capture.story, ...capture.viewport, sha256: sha256(bytes), ...pngDimensions(bytes) });
    }
  }

  const failures = [
    ...commonFailures.map((row) => ({
      kind: "common",
      story: row.story.id,
      viewport: row.viewport,
      roots: row.roots,
      overflow: row.overflow,
      semantics: row.semantics,
      controls: { minimumHeight: row.controls.minimumHeight, allHorizontallyReachable: row.controls.allHorizontallyReachable },
      safeDock: row.safeDock,
      staticTools: row.staticTools,
      focus: row.focus,
    })),
    ...modeFailures,
  ];
  const evidence = {
    schemaVersion: 1,
    kind: `goal-room-v3-${mode}-qualification`,
    boundary: "Production-excluded qualification fixture using production projections over a real-kernel replay. S09 presentation metadata is synthetic/test-only; its kernel state is not mutated.",
    mode,
    stories: matrix.stories,
    viewports: matrix.viewports,
    summary: {
      rowCount: rows.length,
      failureCount: failures.length,
      maximumHorizontalOverflow: Math.max(0, ...rows.flatMap((row) => Object.values(row.overflow))),
      minimumControlHeight: Math.min(...rows.map((row) => row.controls.minimumHeight ?? Number.POSITIVE_INFINITY)),
      syntheticStories: rows.filter((row) => row.story.presentation !== "canonical").map((row) => row.story.id).filter((id, index, all) => all.indexOf(id) === index),
      finalReceiptHashes: [...new Set(rows.map((row) => row.story.receiptHash).filter((hash) => hash !== "GENESIS"))],
    },
    rows,
    accessibility,
    keyboard,
    acceptanceFocus,
    hostilePanels,
    reducedMotion,
    zoom,
    screenshots,
    failures,
  };
  await writeFile(join(output, `${mode}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
  if (failures.length) {
    console.error(JSON.stringify({ mode, failures }, null, 2));
    throw new Error(`Goal Room V3 ${mode} QA failed with ${failures.length} finding(s)`);
  }
  console.log(JSON.stringify({ mode, ...evidence.summary, screenshotCount: screenshots.length }, null, 2));
} finally {
  socket?.close();
  server?.kill("SIGTERM");
  chrome?.kill("SIGTERM");
  await wait(150);
  for (const child of [server, chrome].filter(Boolean)) if (child.exitCode === null) child.kill("SIGKILL");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(profile, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 4) throw error;
      await wait(100);
    }
  }
}
