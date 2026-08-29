import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { resolveConfig } from "vite";
import { resolveBrowserExecutable } from "./browser-resolver.mjs";
import { resolveStaticRequestPath } from "./composition-production-qa.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const dist = join(root, "dist");
const exportedEvidence = Boolean(process.env.WORKHUB_MOBILE_EVIDENCE_DIR);
const evidenceRoot = exportedEvidence
  ? resolve(process.env.WORKHUB_MOBILE_EVIDENCE_DIR)
  : await mkdtemp(join(tmpdir(), "workhub-production-mobile-evidence-"));
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
const digest = (value) => createHash("sha256").update(value).digest("hex");
const matrix = [
  ...[375, 393, 430].flatMap((width) => [1, 3].map((dpr) => ({ width, height: width === 375 ? 812 : width === 393 ? 852 : 932, dpr }))),
  { width: 393, height: 552, dpr: 3, dynamicHeight: true },
];

async function waitFor(predicate, label, attempts = 240) {
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
  const files = [];
  for (const entry of await readdir(directory)) {
    const path = join(directory, entry);
    if ((await stat(path)).isDirectory()) files.push(...await filesUnder(path)); else files.push(path);
  }
  return files;
}

await run("npm", ["run", "build"]);
await mkdir(evidenceRoot, { recursive: true });
const { base } = await resolveConfig({}, "build");
const productionFiles = await filesUnder(dist);
const fixtureTokens = ["__mobileQa", "qa/mobile-fixture", "qualification/v3-fixture", "__v3Qualification"];
const fixtureLeaks = [];
for (const path of productionFiles.filter((value) => [".html", ".js", ".css"].includes(extname(value)))) {
  const content = await readFile(path, "utf8");
  for (const token of fixtureTokens) if (content.includes(token)) fixtureLeaks.push({ file: path.slice(dist.length + 1), token });
}
if (fixtureLeaks.length) throw new Error(`Production bundle contains fixture code: ${JSON.stringify(fixtureLeaks)}`);

const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png" };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const path = resolveStaticRequestPath(dist, pathname, base);
    if (!path || (path !== dist && !path.startsWith(`${dist}${sep}`))) throw new Error("invalid path");
    const body = await readFile(path);
    response.writeHead(200, { "content-type": mime[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
    response.end(body);
  } catch { response.writeHead(404).end("Not found"); }
});
await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
const address = server.address();
if (!address || typeof address === "string") throw new Error("Static server did not expose a port");
const route = `http://127.0.0.1:${address.port}${base}`;
const profile = await mkdtemp(join(tmpdir(), "workhub-production-mobile-"));
let chrome;
let socket;
const report = {
  builtProduction: true,
  sourceEntry: "src/main.ts",
  route: base,
  mobileEmulation: true,
  evidencePositioning: {
    classification: "descriptor-runtime-positioning",
    injectedCaptureShim: {
      injected: true,
      source: "Page.addScriptToEvaluateOnNewDocument",
      target: "document.modelContext.registerTool",
    },
    nativeWebMcpEvidence: false,
    disclaimer: "This report is descriptor/runtime positioning only; its injected capture shim is not native WebMCP evidence.",
  },
  fixtureLeaks,
  matrix: [],
  states: {},
  screenshots: [],
  failures: [],
};
const fail = (scope, message, observed) => report.failures.push({ scope, message, observed });
try {
  chrome = spawn(resolveBrowserExecutable(), [
    "--headless=new", "--disable-gpu", "--disable-extensions", "--disable-component-extensions-with-background-pages",
    "--hide-scrollbars", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: "ignore" });
  const activePort = await waitFor(async () => (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0], "Chrome DevTools");
  const tabs = await (await fetch(`http://127.0.0.1:${activePort}/json`)).json();
  socket = new WebSocket(tabs[0].webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => { socket.addEventListener("open", resolveOpen, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id); pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  const call = (method, params = {}) => new Promise((resolveCall, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30_000);
    pending.set(id, { resolve: resolveCall, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await call("Page.enable"); await call("Runtime.enable");
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    window.__productionMobile = { tools: new Map(), registrations: [] };
    Object.defineProperty(document, 'modelContext', { configurable: true, value: {
      registerTool(tool) { window.__productionMobile.tools.set(tool.name, tool); window.__productionMobile.registrations.push(tool.name); }
    }});
  })();` });
  async function evaluate(expression) {
    const response = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result.value;
  }
  async function setViewport(width, height, dpr = 1) {
    await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: true, screenWidth: width, screenHeight: height });
  }
  async function navigateFresh(viewport) {
    await setViewport(viewport.width, viewport.height, viewport.dpr);
    await call("Page.navigate", { url: `${route}?fresh=${viewport.width}-${viewport.height}-${viewport.dpr}-${Date.now()}` });
    await waitFor(async () => evaluate("document.readyState === 'complete' && window.__productionMobile.registrations.length === 6 && Boolean(document.querySelector('#mobile-owner-intent'))"), "fresh production mobile owner intent");
  }
  async function click(selector) {
    const point = await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e) throw new Error('missing ${selector}'); e.scrollIntoView({block:'center',inline:'nearest'}); const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
    await call("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  }
  async function type(selector, value) { await click(selector); await call("Input.insertText", { text: value }); }
  async function invoke(name, input) { return evaluate(`window.__productionMobile.tools.get(${JSON.stringify(name)}).execute(${JSON.stringify(input)})`); }
  async function state() { return invoke("get_goal_room_state", {}); }
  async function expectState(version, phase) { return waitFor(async () => { const value = await state(); return value.currentStateVersion === version && value.phase === phase ? value : false; }, `${phase} v${version}`); }
  async function screenshot(name) {
    await setViewport(393, 852, 3); await wait(60);
    const shot = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
    const bytes = Buffer.from(shot.data, "base64");
    const path = join(evidenceRoot, `${name}-393x852-dpr3.png`);
    await writeFile(path, bytes);
    report.screenshots.push({ state: name, path, sha256: digest(bytes), bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
  }
  const measurementExpression = `(() => {
    const rect = (e) => e ? ((r) => ({left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}))(e.getBoundingClientRect()) : null;
    const visible = (e) => e && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
    const accessibleName = (e) => {
      const labelledBy = (e.getAttribute('aria-labelledby') || '').trim().split(/\\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
      const associatedLabel = e.id ? document.querySelector('label[for="' + CSS.escape(e.id) + '"]') : null;
      return (e.getAttribute('aria-label') || labelledBy || associatedLabel?.textContent || e.textContent || '').trim();
    };
    const root=document.querySelector('#mobile-room'), dock=document.querySelector('.mobile-action-dock'), tabs=document.querySelector('.mobile-tab-bar');
    const form=document.querySelector('.mobile-intent-form'), input=document.querySelector('#mobile-owner-intent'), submit=form?.querySelector('button[type=submit]');
    const controls=[...document.querySelectorAll('#mobile-room button,#mobile-room textarea')].filter(visible).map((e)=>({tag:e.tagName,id:e.id,label:accessibleName(e),disabled:e.disabled,rect:rect(e)}));
    return {innerWidth,innerHeight,devicePixelRatio,visualViewport:{width:visualViewport.width,height:visualViewport.height,scale:visualViewport.scale,offsetLeft:visualViewport.offsetLeft,offsetTop:visualViewport.offsetTop},
      displays:{mobile:getComputedStyle(root).display,desktop:getComputedStyle(document.querySelector('.desktop-surface')).display},
      rects:{root:rect(root),dock:rect(dock),tabs:rect(tabs),form:rect(form),input:rect(input),submit:rect(submit)},controls,
      ownerIntent:{id:input?.id,labelFor:input?.id ? document.querySelector('label[for="' + CSS.escape(input.id) + '"]')?.htmlFor : null,accessibleName:input ? accessibleName(input) : ''},
      selected:[...document.querySelectorAll('.mobile-tab')].filter((e)=>e.getAttribute('aria-selected')==='true').map((e)=>({id:e.id,label:e.textContent.trim()})),
      panel:{id:document.querySelector('.mobile-tab-panel')?.id,heading:document.querySelector('.mobile-panel-heading')?.textContent?.trim(),text:document.querySelector('.mobile-tab-panel')?.textContent?.trim()},
      overflow:{document:document.documentElement.scrollWidth-document.documentElement.clientWidth,body:document.body.scrollWidth-document.body.clientWidth,root:root.scrollWidth-root.clientWidth},
      gridColumns:getComputedStyle(form).gridTemplateColumns};
  })()`;
  function rectContained(rect, viewport) { return rect && rect.left >= -0.5 && rect.right <= viewport.width + 0.5 && rect.width > 0 && rect.height > 0; }
  for (const viewport of matrix) {
    await navigateFresh(viewport);
    const row = { ...viewport, ...(await evaluate(measurementExpression)) };
    report.matrix.push(row);
    const scope = `${viewport.width}x${viewport.height}@${viewport.dpr}`;
    if (row.innerWidth !== viewport.width || Math.abs(row.visualViewport.width - viewport.width) > 1) fail(scope, "CSS and visual viewport widths must match requested production mobile viewport", { innerWidth: row.innerWidth, visualViewport: row.visualViewport });
    if (row.displays.mobile !== "block" || row.displays.desktop !== "none") fail(scope, "production mobile composition must be exclusive", row.displays);
    if (!row.rects.root || Math.abs(row.rects.root.width - row.visualViewport.width) > 1 || row.rects.root.left < -0.5 || row.rects.root.right > row.visualViewport.width + 0.5) fail(scope, "mobile root must span usable visual viewport", row.rects.root);
    for (const name of ["dock", "tabs", "form", "input", "submit"]) if (!rectContained(row.rects[name], row.visualViewport)) fail(scope, `${name} rectangle must be contained by visual viewport`, row.rects[name]);
    for (const control of row.controls) if (!rectContained(control.rect, row.visualViewport) || control.disabled) fail(scope, "every fresh owner control must be contained and enabled", control);
    if (row.ownerIntent.id !== "mobile-owner-intent" || row.ownerIntent.labelFor !== "mobile-owner-intent" || row.ownerIntent.accessibleName !== "Owner intent") fail(scope, "S01 owner intent must have its associated label[for] as the accessible name", row.ownerIntent);
    if (row.overflow.document || row.overflow.body || row.overflow.root) fail(scope, "document, body, and mobile root must have zero horizontal overflow", row.overflow);
    if (row.selected.length !== 1 || row.selected[0].id !== "mobile-tab-now" || row.selected[0].label !== "Now") fail(scope, "production mobile must start on tab id now labelled Now", row.selected);
    if (row.panel.id !== "mobile-panel-now" || row.panel.heading !== "Current frontier" || !row.panel.text?.includes("Current status:")) fail(scope, "Now must render concise Current frontier panel", row.panel);
    if (!row.rects.tabs || Math.abs(row.rects.tabs.bottom - row.visualViewport.height) > 1 || !row.rects.dock || Math.abs(row.rects.dock.bottom - row.rects.tabs.top) > 1) fail(scope, "fixed action dock and tab bar must meet at the visual-viewport safe edge", { dock: row.rects.dock, tabs: row.rects.tabs, visualViewport: row.visualViewport });
  }

  await navigateFresh({ width: 393, height: 852, dpr: 3 });
  const s01 = await evaluate(`(() => { const input=document.querySelector('#mobile-owner-intent'),label=document.querySelector('label[for="mobile-owner-intent"]'); return {inputId:input?.id,labelFor:label?.htmlFor,labelText:label?.textContent?.trim(),accessibleName:label?.textContent?.trim()}; })()`);
  report.states.S01 = s01;
  if (s01.inputId !== "mobile-owner-intent" || s01.labelFor !== "mobile-owner-intent" || s01.labelText !== "Owner intent" || s01.accessibleName !== "Owner intent") fail("S01", "owner intent textarea must be accessibly named by its associated label[for]", s01);
  const beforeTabs = await state();
  for (const id of ["plan", "proof", "activity", "now"]) {
    if (await evaluate(`Boolean(document.querySelector('#mobile-tab-${id}'))`)) await click(`#mobile-tab-${id}`);
  }
  const afterTabs = await state();
  if (JSON.stringify(beforeTabs) !== JSON.stringify(afterTabs)) fail("S01-tabs", "tab navigation must cause zero owner or authority mutation", { before: beforeTabs, after: afterTabs });
  await screenshot("s01-current-frontier");
  await type("#mobile-owner-intent", "Qualify the real production mobile Owner frontier");
  await click(".mobile-intent-form button[type=submit]");
  let current = await expectState(1, "INTENT_DRAFT");
  if (current.ownerIntent !== "Qualify the real production mobile Owner frontier") fail("S01-action", "fresh owner intent form must be actionable through production controller", current);
  const goal = { expectedStateVersion: 1, idempotencyKey: "mobile-goal", goal: "Qualify production mobile", why: "Prove owner-facing mobile behavior", doneLooksLike: ["Owner accepts exact verified evidence"], constraints: ["No external effects"], nonGoals: ["Speculative WebKit CSS"], evidenceRequired: ["Built production mobile qualification"], openQuestions: [] };
  await invoke("propose_goal_contract", goal); await click(".mobile-action-dock .mobile-button.primary");
  await expectState(3, "GOAL_CONTRACT_CONFIRMED");
  await invoke("propose_plan", { expectedStateVersion: 3, idempotencyKey: "mobile-plan", goalContractVersion: 1, steps: [{ id: "qualify", title: "Qualify production mobile states" }] });
  await click(".mobile-action-dock .mobile-button.primary"); await expectState(5, "PLAN_CONFIRMED");
  await invoke("claim_step", { expectedStateVersion: 5, idempotencyKey: "mobile-claim", planVersion: 1, stepId: "qualify" });
  const content = JSON.stringify({ publicUrl: "https://example.test/mobile", demoDurationSeconds: 180, verificationCommand: "npm test" });
  const sha256 = digest(content);
  await invoke("submit_artifact", { expectedStateVersion: 6, idempotencyKey: "mobile-candidate", planVersion: 1, stepId: "qualify", content, sha256 });
  current = await expectState(8, "VERIFICATION_PASSED");
  const s12 = await evaluate(`(() => { const dock=document.querySelector('.mobile-action-dock'); return {actor:document.querySelector('.mobile-frontier').dataset.actor,buttons:[...dock.querySelectorAll('button')].filter(e=>getComputedStyle(e).display!=='none').map(e=>e.textContent.trim()),text:dock.textContent.trim()}; })()`);
  report.states.S12 = s12;
  if (s12.buttons.length !== 0 || s12.actor !== "agent") fail("S12", "PASS must expose no Owner legal action and leave Agent frontier", s12);
  await screenshot("s12-pass-no-owner-action");
  await invoke("request_completion", { expectedStateVersion: 8, idempotencyKey: "mobile-completion", candidateSha256: sha256 });
  current = await expectState(9, "COMPLETION_REQUESTED");
  const s13 = await evaluate(`(() => { const dock=document.querySelector('.mobile-action-dock'),buttons=[...dock.querySelectorAll('button')].filter(e=>getComputedStyle(e).display!=='none'),r=buttons[0]?.getBoundingClientRect(),d=dock.getBoundingClientRect(); return {actor:document.querySelector('.mobile-frontier').dataset.actor,buttonCount:buttons.length,label:buttons[0]?.textContent.trim(),buttonRect:r?{left:r.left,right:r.right,width:r.width}:null,dockRect:{left:d.left,right:d.right,width:d.width},fullWidth:Boolean(r&&r.width>=d.width-25)}; })()`);
  report.states.S13 = s13;
  if (s13.actor !== "owner" || s13.buttonCount !== 1 || !/accept/i.test(s13.label ?? "") || !s13.fullWidth) fail("S13", "completion must expose exactly one full-width Owner acceptance action", s13);
  await click(".mobile-action-dock .mobile-button.primary");
  const expectedCompactDigest = `${sha256.slice(0, 10)}…${sha256.slice(-8)}`;
  const s13Dialog = await evaluate(`(() => {
    const dialog=document.querySelector('#acceptance-dialog'), titleId=dialog?.getAttribute('aria-labelledby'), descriptionId=dialog?.getAttribute('aria-describedby');
    const title=titleId ? document.getElementById(titleId) : null, consequence=descriptionId ? document.getElementById(descriptionId) : null;
    const bindings=Object.fromEntries([...dialog.querySelectorAll('.acceptance-binding > div')].map((row)=>[row.querySelector('dt')?.textContent?.trim(),row.querySelector('dd')?.textContent?.trim()]));
    const candidateDisplay=bindings.Candidate || '', candidateVersion=candidateDisplay.match(/^Candidate v\\d+/)?.[0] || '';
    const confirm=document.querySelector('#confirm-acceptance'), visible=(e)=>Boolean(e&&getComputedStyle(e).display!=='none'&&e.getClientRects().length>0);
    return {open:dialog?.open===true,visible:visible(dialog),labelledBy:titleId,describedBy:descriptionId,title:title?.textContent?.trim(),consequence:consequence?.textContent?.trim(),bindings,candidateVersion,candidateDisplay,digest:bindings['SHA-256'],ruleSet:bindings['PASS rule set'],activeElementId:document.activeElement?.id,confirmVisible:visible(confirm),confirmEnabled:confirm?.disabled===false,confirmLabel:confirm?.textContent?.trim()};
  })()`);
  report.states.S13.dialog = s13Dialog;
  const expectedConsequence = "This acceptance is irreversible. It seals the Goal Room for this exact PASS-bound candidate.";
  if (!s13Dialog.open || !s13Dialog.visible || s13Dialog.labelledBy !== "acceptance-dialog-title" || s13Dialog.describedBy !== "acceptance-dialog-consequence" || s13Dialog.title !== "Accept Candidate v1?" || s13Dialog.candidateVersion !== "Candidate v1" || s13Dialog.candidateDisplay !== `Candidate v1 (${expectedCompactDigest})` || !/^[0-9a-f]{64}$/.test(s13Dialog.digest ?? "") || s13Dialog.digest !== sha256 || s13Dialog.ruleSet !== "workhub_goal_room_release/v1" || s13Dialog.consequence !== expectedConsequence || s13Dialog.activeElementId !== "cancel-acceptance" || !s13Dialog.confirmVisible || !s13Dialog.confirmEnabled || s13Dialog.confirmLabel !== "Confirm acceptance") fail("S13-dialog", "visible acceptance dialog must expose exact accessible PASS-bound candidate evidence with initial focus on Cancel", { expected: { candidateVersion: "Candidate v1", candidateDisplay: `Candidate v1 (${expectedCompactDigest})`, digest: sha256, ruleSet: "workhub_goal_room_release/v1", consequence: expectedConsequence }, observed: s13Dialog });
  await screenshot("s13-owner-acceptance");
  await click("#confirm-acceptance");
  current = await expectState(10, "GOAL_ACCEPTED");
  const s14 = await evaluate(`(() => { const dock=document.querySelector('.mobile-action-dock'); const visible=e=>getComputedStyle(e).display!=='none'&&e.getClientRects().length>0; return {actor:document.querySelector('.mobile-frontier').dataset.actor,controls:[...dock.querySelectorAll('button,textarea')].filter(visible).map(e=>e.textContent.trim()),dock:dock.textContent.trim(),acceptanceDialogOpen:document.querySelector('#acceptance-dialog').open}; })()`);
  report.states.S14 = s14;
  if (current.currentActor !== "none" || current.nextLegalAction !== "GOAL_ACCEPTED_NO_FURTHER_ACTION" || s14.actor !== "none" || s14.controls.length !== 0) fail("S14", "sealed production mobile state must be actorless with no actions", { state: current, dom: s14 });
  await screenshot("s14-sealed-no-actions");
  await writeFile(join(evidenceRoot, "production-mobile-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (report.failures.length) {
    console.error(JSON.stringify(report, null, 2));
    throw new Error(`Real-production mobile QA failed ${report.failures.length} assertions`);
  }
  console.log(JSON.stringify({ passed: true, matrix: report.matrix.length, states: Object.keys(report.states), screenshots: report.screenshots, failures: 0 }, null, 2));
} finally {
  socket?.close(); chrome?.kill("SIGTERM");
  await new Promise((resolveClose) => server.close(resolveClose));
  await wait(150); if (chrome?.exitCode === null) chrome.kill("SIGKILL");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { await rm(profile, { recursive: true, force: true }); break; }
    catch (error) { if (attempt === 4) throw error; await wait(100); }
  }
  if (!exportedEvidence) await rm(evidenceRoot, { recursive: true, force: true });
}
