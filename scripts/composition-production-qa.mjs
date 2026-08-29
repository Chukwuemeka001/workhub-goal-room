import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveConfig } from "vite";
import { resolveBrowserExecutable } from "./browser-resolver.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const dist = join(root, "dist");

const matrix = [
  { width: 375, height: 667, expected: "mobile" },
  { width: 393, height: 852, expected: "mobile" },
  { width: 430, height: 932, expected: "mobile" },
  { width: 852, height: 393, expected: "mobile" },
  { width: 620, height: 900, expected: "mobile" },
  { width: 621, height: 900, expected: "mobile" },
  { width: 932, height: 620, expected: "mobile" },
  { width: 933, height: 620, expected: "mobile" },
  { width: 1199, height: 900, expected: "mobile" },
  { width: 1200, height: 900, expected: "desktop" },
  { width: 1280, height: 800, expected: "desktop" },
  { width: 1440, height: 900, expected: "desktop" },
  { width: 1728, height: 1117, expected: "desktop" },
];
const expectedMainName = {
  mobile: "WorkHub Goal Room mobile",
  desktop: "WorkHub Goal Room desktop Mission Room",
};
export function resolveStaticRequestPath(distDirectory, pathname, base) {
  const normalizedBase = `/${base.replace(/^\/+|\/+$/g, "")}/`.replace(/^\/\/$/, "/");
  let relativePath;
  if (normalizedBase === "/") relativePath = pathname.replace(/^\/+/, "");
  else if (pathname.startsWith(normalizedBase)) relativePath = pathname.slice(normalizedBase.length);
  else return null;
  const requested = relativePath === "" ? "index.html" : relativePath;
  const path = resolve(distDirectory, requested);
  return path === distDirectory || path.startsWith(`${distDirectory}${sep}`) ? path : null;
}
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
async function waitFor(predicate, label, attempts = 160) {
  for (let index = 0; index < attempts; index += 1) {
    try { const value = await predicate(); if (value) return value; } catch {}
    await wait(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolveRun() : reject(new Error(`${command} ${args.join(" ")} exited ${code ?? signal}`)));
  });
}
async function filesUnder(directory) {
  const entries = await readdir(directory);
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry);
    if ((await stat(path)).isDirectory()) files.push(...await filesUnder(path)); else files.push(path);
  }
  return files;
}

async function runCompositionQa() {
const chromePath = resolveBrowserExecutable();
const { base } = await resolveConfig({}, "build");
await run("npm", ["run", "build"]);
const productionFiles = await filesUnder(dist);
const forbiddenFixtureTokens = ["__mobileQa", "__desktopQa", "qa/mobile-fixture", "qa/desktop-fixture"];
const fixtureLeaks = [];
for (const path of productionFiles.filter((entry) => [".html", ".js", ".css"].includes(extname(entry)))) {
  const content = await readFile(path, "utf8");
  for (const token of forbiddenFixtureTokens) if (content.includes(token)) fixtureLeaks.push({ file: path.slice(dist.length + 1), token });
}
if (fixtureLeaks.length) throw new Error(`Production bundle contains QA fixture code: ${JSON.stringify(fixtureLeaks)}`);

const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const path = resolveStaticRequestPath(dist, pathname, base);
    if (!path) throw new Error("invalid path");
    const body = await readFile(path);
    response.writeHead(200, { "content-type": mime[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});
await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
const address = server.address();
if (!address || typeof address === "string") throw new Error("Static server did not expose a TCP port");
const origin = `http://127.0.0.1:${address.port}`;
const profile = await mkdtemp(join(tmpdir(), "workhub-composition-qa-"));
let chrome;
let socket;
try {
  chrome = spawn(chromePath, [
    "--headless=new", "--disable-gpu", "--disable-extensions", "--disable-component-extensions-with-background-pages",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: "ignore" });
  const activePort = await waitFor(async () => (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0], "Chrome DevTools");
  const tabs = await (await fetch(`http://127.0.0.1:${activePort}/json`)).json();
  socket = new WebSocket(tabs[0].webSocketDebuggerUrl);
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
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve: resolveCall, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Accessibility.enable");
  async function evaluate(expression) {
    const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  const rows = [];
  for (const viewport of matrix) {
    await call("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false, screenWidth: viewport.width, screenHeight: viewport.height });
    await call("Page.navigate", { url: `${origin}${base}` });
    await waitFor(async () => {
      const result = await evaluate("({ready:document.readyState==='complete',mobile:Boolean(document.querySelector('#mobile-owner-intent')),desktop:Boolean(document.querySelector('#desktop-owner-intent'))})");
      return result.ready && result.mobile && result.desktop;
    }, `${viewport.width}x${viewport.height} production render`);
    const dom = await evaluate(`(() => {
      const mobile = document.querySelector('#mobile-room');
      const desktop = document.querySelector('.desktop-surface');
      const displayed = (element) => getComputedStyle(element).display !== 'none';
      const visibleRoots = [mobile, desktop].filter(displayed);
      const visibleWithinActiveRoot = (element) => visibleRoots.some((root) => root.contains(element)) && getComputedStyle(element).display !== 'none';
      const visibleFormIds = [...document.querySelectorAll('form[id], form [id]')].filter(visibleWithinActiveRoot).map((element) => element.id);
      const duplicateVisibleFormIds = visibleFormIds.filter((id, index) => visibleFormIds.indexOf(id) !== index);
      const ownerInputs = [...document.querySelectorAll('#mobile-owner-intent, #desktop-owner-intent')].filter(visibleWithinActiveRoot);
      const dialog = document.querySelector('#revision-dialog');
      return {
        innerWidth, innerHeight,
        mobileDisplay: getComputedStyle(mobile).display,
        desktopDisplay: getComputedStyle(desktop).display,
        bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        documentClientWidth: document.documentElement.clientWidth,
        visibleRootCount: visibleRoots.length,
        visibleRootIds: visibleRoots.map((root) => root.id || root.className),
        visibleOwnerSurfaceCount: ownerInputs.length,
        visibleOwnerInputIds: ownerInputs.map((input) => input.id),
        duplicateVisibleFormIds,
        dialog: {
          display: getComputedStyle(dialog).display,
          open: dialog.open,
          labelledBy: dialog.getAttribute('aria-labelledby'),
          titleId: dialog.querySelector('h2')?.id ?? null,
          formCount: dialog.querySelectorAll('#revision-form').length,
          sharedOutsideRoots: !mobile.contains(dialog) && !desktop.contains(dialog),
        },
      };
    })()`);
    const axTree = await call("Accessibility.getFullAXTree");
    const axMains = axTree.nodes.filter((node) => !node.ignored && node.role?.value === "main").map((node) => node.name?.value ?? "");
    const axDialogs = axTree.nodes.filter((node) => !node.ignored && node.role?.value === "dialog").map((node) => node.name?.value ?? "");
    const row = { ...viewport, ...dom, axMainCount: axMains.length, axMainNames: axMains, axDialogCount: axDialogs.length };
    const expectedMobile = viewport.expected === "mobile";
    const overflowFailed = row.bodyOverflow !== 0 || row.documentOverflow !== 0;
    const failed =
      row.mobileDisplay !== (expectedMobile ? "block" : "none") ||
      row.desktopDisplay !== (expectedMobile ? "none" : "block") ||
      overflowFailed || row.visibleRootCount !== 1 ||
      row.axMainCount !== 1 || row.axMainNames[0] !== expectedMainName[viewport.expected] ||
      row.visibleOwnerSurfaceCount !== 1 || row.duplicateVisibleFormIds.length !== 0 ||
      row.dialog.display !== "none" || row.dialog.open || row.dialog.labelledBy !== row.dialog.titleId ||
      row.dialog.formCount !== 1 || !row.dialog.sharedOutsideRoots || row.axDialogCount !== 0;
    rows.push({ ...row, failed });
  }
  const failures = rows.filter((row) => row.failed);
  if (failures.length) {
    console.error(JSON.stringify({ fixtureLeaks, failures }, null, 2));
    throw new Error(`Production composition QA failed ${failures.length}/${rows.length} viewports`);
  }
  console.log(JSON.stringify({ builtProduction: true, fixtureLeaks, rows, failures: 0 }, null, 2));
} finally {
  socket?.close();
  chrome?.kill("SIGTERM");
  await new Promise((resolveClose) => server.close(resolveClose));
  await wait(100);
  if (chrome?.exitCode === null) chrome.kill("SIGKILL");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { await rm(profile, { recursive: true, force: true }); break; }
    catch (error) { if (attempt === 4) throw error; await wait(100); }
  }
}
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await runCompositionQa();
