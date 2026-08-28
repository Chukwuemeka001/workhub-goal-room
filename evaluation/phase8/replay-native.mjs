import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(new URL("../..", import.meta.url).pathname);
const output = join(root, "evaluation", "phase8");
const url = process.env.PHASE8_URL ?? "http://127.0.0.1:4188/";
const canary = process.env.CHROME_CANARY_BIN ?? "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary";
if (!existsSync(canary)) throw new Error("Chrome Canary executable not found");
const exactBrowserVersion = execFileSync(canary, ["--version"], { encoding: "utf8" }).trim().replace(/^Google Chrome\s+/, "");
const profile = await mkdtemp(join(tmpdir(), "workhub-phase8-native-"));
const browser = spawn(canary, [
  "--headless=new", "--disable-gpu", "--disable-extensions",
  "--disable-component-extensions-with-background-pages", "--remote-debugging-port=0",
  `--user-data-dir=${profile}`, "--enable-features=WebMCPTesting,DevToolsWebMCPSupport", url,
], { stdio: "ignore" });
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
const waitFor = async (predicate, label) => {
  for (let index = 0; index < 160; index += 1) {
    try { const value = await predicate(); if (value) return value; } catch {}
    await wait(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
};

try {
  await mkdir(output, { recursive: true });
  const port = await waitFor(async () => (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0], "Canary CDP");
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const socket = new WebSocket(tabs.find((tab) => tab.type === "page").webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => { socket.onopen = resolveOpen; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
  };
  const call = (method, params = {}) => new Promise((resolveCall, reject) => {
    const callId = ++id;
    pending.set(callId, { resolve: resolveCall, reject });
    socket.send(JSON.stringify({ id: callId, method, params }));
  });
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Accessibility.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await waitFor(async () => (await call("Runtime.evaluate", { expression: "document.readyState === 'complete'", returnByValue: true })).result.value, "production page");
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const context = await evaluate(`({
    userAgent: navigator.userAgent,
    secureContext: isSecureContext,
    url: location.href,
    documentModelContext: typeof document.modelContext,
    navigatorModelContext: typeof navigator.modelContext,
    registerTool: typeof (document.modelContext ?? navigator.modelContext)?.registerTool,
    testingMethods: Object.getOwnPropertyNames(Object.getPrototypeOf(document.modelContext ?? {})),
  })`);
  const discovered = await evaluate(`(async()=>{
    const tools=await document.modelContext.getTools();
    return tools.map((tool,index)=>({index,name:tool.name,title:tool.title,description:tool.description,inputSchema:tool.inputSchema,annotations:tool.annotations}));
  })()`);
  const registrationOrder = ["get_goal_room_state", "propose_goal_contract", "propose_plan", "claim_step", "submit_artifact", "request_completion"];
  if (discovered.length !== 6 || new Set(discovered.map(({ name }) => name)).size !== 6) throw new Error("Expected six native tools");

  await evaluate(`(async()=>{
    const input=document.querySelector('#desktop-owner-intent');
    input.value='Qualify one native governed Goal proposal.';
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.closest('form').requestSubmit();
    await new Promise(resolve=>setTimeout(resolve,0));
  })()`);
  const stateBefore = await evaluate(`(async()=>{
    const tool=(await document.modelContext.getTools()).find(({name})=>name==='get_goal_room_state');
    return JSON.parse(await document.modelContext.executeTool(tool,'{}'));
  })()`);
  const receiptCountBefore = await evaluate("document.querySelectorAll('.desktop-receipt-list li[data-accepted]').length");
  const malformed = await evaluate(`(async()=>{
    const tool=(await document.modelContext.getTools()).find(({name})=>name==='propose_goal_contract');
    const value={expectedStateVersion:1,idempotencyKey:'phase8-native-malformed',goal:'Native Goal',why:'Prove the native callback.',doneLooksLike:['Owner sees the proposal'],constraints:[],nonGoals:[],evidenceRequired:['Receipt'],openQuestions:[],actor:'owner'};
    return JSON.parse(await document.modelContext.executeTool(tool,JSON.stringify(value)));
  })()`);
  const stateAfterMalformed = await evaluate(`(async()=>{
    const tool=(await document.modelContext.getTools()).find(({name})=>name==='get_goal_room_state');
    return JSON.parse(await document.modelContext.executeTool(tool,'{}'));
  })()`);
  const receiptCountAfterMalformed = await evaluate("document.querySelectorAll('.desktop-receipt-list li[data-accepted]').length");
  const accepted = await evaluate(`(async()=>{
    const tool=(await document.modelContext.getTools()).find(({name})=>name==='propose_goal_contract');
    const value={expectedStateVersion:1,idempotencyKey:'phase8-native-goal-v1',goal:'Native Goal proposal is visible',why:'Prove browser discovery, invocation, and shared UI.',doneLooksLike:['Owner sees exact proposal and receipt'],constraints:['No external effects'],nonGoals:['Autonomous model claim'],evidenceRequired:['Native testing API transcript'],openQuestions:[]};
    return JSON.parse(await document.modelContext.executeTool(tool,JSON.stringify(value)));
  })()`);
  const visible = await evaluate(`({
    bodyIncludesGoal: document.body.innerText.includes('Native Goal proposal is visible'),
    bodyIncludesReceipt: document.body.innerText.includes('Receipts · 2 recorded attempts'),
    connection: document.querySelector('.desktop-connection')?.textContent ?? '',
    desktopVisible: getComputedStyle(document.querySelector('.desktop-surface')).display !== 'none',
    mobileHidden: getComputedStyle(document.querySelector('.mobile-room')).display === 'none',
    documentOverflow: document.documentElement.scrollWidth-document.documentElement.clientWidth,
    receiptCount: document.querySelectorAll('.desktop-receipt-list li[data-accepted]').length,
  })`);
  const screenshot = await call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const screenshotBytes = Buffer.from(screenshot.data, "base64");
  await writeFile(join(output, "native-goal-1440x900.png"), screenshotBytes);
  const screenshotSha256 = createHash("sha256").update(screenshotBytes).digest("hex");

  const ax = await call("Accessibility.getFullAXTree");
  const visibleAx = ax.nodes.filter((node) => !node.ignored).map((node) => ({ role: node.role?.value, name: node.name?.value })).filter(({ role, name }) => role && name);
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const reducedMotion = await evaluate(`(()=>{
    const rows=[...document.querySelectorAll('*')].map(node=>{const style=getComputedStyle(node);return {animationDuration:style.animationDuration,transitionDuration:style.transitionDuration}});
    return {mediaMatches:matchMedia('(prefers-reduced-motion: reduce)').matches,nonZeroAnimations:rows.filter(x=>!['0s','0ms'].includes(x.animationDuration)).length,nonZeroTransitions:rows.filter(x=>!['0s','0ms'].includes(x.transitionDuration)).length};
  })()`);
  const result = {
    kind: "phase8-native-canary-production-qualification",
    testedProductionCommit: "c4602a9d5d1fde8451e76fcc1e6e0797f693d70c",
    testedProductionTree: "c4c9b4105175df6284b49ebfca30b7b8f411f8b6",
    archive: "local production dist built with npm run build from tested production tree plus test-only Phase8 files excluded by Vite",
    browser: { product: "Google Chrome Canary", version: exactBrowserVersion, userAgent: context.userAgent },
    flags: ["enable-webmcp-testing", "devtools-webmcp-support"],
    commandLineFeatureMapping: ["WebMCPTesting", "DevToolsWebMCPSupport"],
    profile: "fresh disposable unsigned-in profile outside Git; deleted by replay script",
    reloads: 0,
    context: { ...context, url: "http://127.0.0.1:4188/" },
    registrationOrder,
    nativeEnumerationOrder: discovered.map(({ name }) => name),
    discovered,
    controls: {
      stateBefore: { phase: stateBefore.phase, currentStateVersion: stateBefore.currentStateVersion },
      malformed,
      stateAfterMalformed: { phase: stateAfterMalformed.phase, currentStateVersion: stateAfterMalformed.currentStateVersion },
      receiptCountBefore,
      receiptCountAfterMalformed,
      accepted,
    },
    visible,
    accessibility: {
      claim: "Chrome accessibility tree inspection; not automated VoiceOver speech/navigation",
      namedRoleCount: visibleAx.length,
      roles: Object.fromEntries([...new Set(visibleAx.map(({ role }) => role))].map((role) => [role, visibleAx.filter((node) => node.role === role).length])),
      requiredNamedNodes: visibleAx.filter(({ role }) => ["tab", "tabpanel", "dialog", "status", "button", "navigation", "main"].includes(role)),
    },
    reducedMotion,
    screenshot: { path: "evaluation/phase8/native-goal-1440x900.png", sha256: screenshotSha256, width: 1440, height: 900 },
    claimLimit: "Native Canary registration, discovery, testing-API invocation, malformed callback no-mutation, and visible shared-state mutation only; no autonomous model-selection claim.",
  };
  if (!malformed || malformed.reasonCode !== "INVALID_TOOL_INPUT" || stateBefore.currentStateVersion !== stateAfterMalformed.currentStateVersion || receiptCountBefore !== receiptCountAfterMalformed) throw new Error("Malformed no-mutation control failed");
  if (!accepted.accepted || accepted.currentStateVersion !== 2 || !visible.bodyIncludesGoal || !visible.bodyIncludesReceipt || visible.receiptCount !== 2 || visible.documentOverflow !== 0) throw new Error("Accepted native shared-state gate failed");
  await writeFile(join(output, "native-canary.json"), `${JSON.stringify(result, null, 2)}\n`);
  const transcript = {
    redaction: "CDP endpoint, process IDs, disposable profile path, screenshot base64, and full AX node payload omitted",
    messages: [
      { method: "Runtime.evaluate", operation: "runtime context probe", result: result.context },
      { method: "Runtime.evaluate", operation: "document.modelContext.getTools", result: discovered },
      { method: "Runtime.evaluate", operation: "owner intent through production desktop form", result: { stateVersion: 1 } },
      { method: "Runtime.evaluate", operation: "executeTool malformed Goal proposal", result: malformed },
      { method: "Runtime.evaluate", operation: "read state and visible receipt count after malformed", result: { state: result.controls.stateAfterMalformed, receiptCountAfterMalformed } },
      { method: "Runtime.evaluate", operation: "executeTool accepted Goal proposal", result: accepted },
      { method: "Runtime.evaluate", operation: "independent visible shared UI read", result: visible },
      { method: "Page.captureScreenshot", result: result.screenshot },
      { method: "Accessibility.getFullAXTree", result: result.accessibility },
      { method: "Emulation.setEmulatedMedia", params: { prefersReducedMotion: "reduce" }, result: reducedMotion },
    ],
  };
  await writeFile(join(output, "cdp-transcript.redacted.json"), `${JSON.stringify(transcript, null, 2)}\n`);
  console.log(JSON.stringify({ tools: discovered.length, malformedNoMutation: true, acceptedVisible: true, screenshotSha256, axNamedRoles: visibleAx.length, reducedMotion }, null, 2));
  socket.close();
} finally {
  browser.kill("SIGTERM");
  await wait(200);
  if (browser.exitCode === null) browser.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
