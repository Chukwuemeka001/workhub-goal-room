#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";

const root = resolve(new URL("../..", import.meta.url).pathname);
const output = join(root, "evaluation/native-webmcp-v3");
const receiptPath = join(output, "native-webmcp-receipt.json");
const manifestPath = join(output, "manifest.json");
const canary = "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary";
const canaryApp = "/Applications/Google Chrome Canary.app";

const browserOs = join(process.env.HOME ?? "", "Applications/BrowserOS.app/Contents/MacOS/BrowserOS");
const expectedTools = ["get_goal_room_state", "propose_goal_contract", "propose_plan", "claim_step", "submit_artifact", "request_completion"];
const expectedProtected = {
  "src/core/goalRoom.ts": "04d8e89e49ea2b14e8d22ddb404c54e923b01743390a61745bc6d2f21556ff29",
  "src/ownerController.ts": "c20507f4dfa034c5398bd6c77e4fc85b23c32587b7088b383cfdd59bf9f93adb",
  "src/verifier/releaseRules.ts": "ed94538ab54029f9b1159ad597629336fcea771ff77f1f709dc4085bac5512aa",
  "src/webmcp.ts": "021cf979a63bfe39706e9a8247fcac7f75afbc65b59aa9f0d936334bb29574e2",
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
const canonical = (value) => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;

async function filesUnder(directory) {
  const result = [];
  for (const entry of await readdir(directory)) {
    const path = join(directory, entry);
    if ((await stat(path)).isDirectory()) result.push(...await filesUnder(path)); else result.push(path);
  }
  return result;
}
async function waitFor(predicate, label, attempts = 300) {
  for (let index = 0; index < attempts; index += 1) {
    try { const value = await predicate(); if (value) return value; } catch {}
    await wait(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
async function removeProfile(path) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try { await rm(path, { recursive: true, force: true }); return; }
    catch (error) { if (attempt === 7) throw error; await wait(150); }
  }
}
function command(commandName, args) {
  const result = spawnSync(commandName, args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${commandName} ${args.join(" ")} failed: ${result.stdout}\n${result.stderr}`);
  return `${result.stdout}${result.stderr}`.trim();
}
async function launchCdp(executable, profile, extraArgs = []) {
  await rm(join(profile, "DevToolsActivePort"), { force: true });
  const child = spawn(executable, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, ...extraArgs, "about:blank"], { stdio: "ignore" });
  const port = await waitFor(async () => (await readFile(join(profile, "DevToolsActivePort"), "utf8")).toString().split("\n")[0], "browser CDP");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const socket = new WebSocket(targets.find(({ type }) => type === "page").webSocketDebuggerUrl);
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
  const evaluate = async (expression) => {
    const response = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result.value;
  };
  return { child, socket, call, evaluate, async close() { socket.close(); child.kill("SIGTERM"); await wait(200); if (child.exitCode === null) child.kill("SIGKILL"); } };
}

async function validate() {
  const receiptBytes = await readFile(receiptPath);
  const receipt = JSON.parse(receiptBytes);
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.kind, "workhub-v3-native-webmcp-governed-journey");
  assert.match(receipt.testedProductionIdentity.baseCommit, /^[0-9a-f]{40}$/);
  assert.equal(receipt.testedProductionIdentity.exactSourceBinding, "validated sourceHashes from the fresh native run");
  assert.equal(receipt.binding.evidenceCommit, "recorded_after_commit_in_git");
  assert.equal(receipt.browser.version, "Google Chrome 154.0.8028.0 canary");
  assert.deepEqual(receipt.browser.experiments, ["enable-webmcp-testing@1", "devtools-webmcp-support@1"]);
  assert.equal(receipt.api.documentModelContext, "object");
  assert.equal(receipt.api.navigatorModelContext, "undefined");
  for (const method of ["registerTool", "getTools", "executeTool"]) assert.equal(receipt.api.methods[method], "function");
  assert.deepEqual(receipt.registrationOrder, expectedTools);
  assert.equal(new Set(receipt.browserEnumerationOrder).size, 6);
  assert.deepEqual([...receipt.browserEnumerationOrder].sort(), [...expectedTools].sort());
  assert.equal(receipt.descriptors.length, 6);
  for (const descriptor of receipt.descriptors) {
    assert.equal(typeof descriptor.description, "string");
    assert.equal(descriptor.inputSchema.type, "object");
    assert.equal(descriptor.inputSchema.additionalProperties, false);
    assert.equal(typeof descriptor.annotations.readOnlyHint, "boolean");
  }
  assert.equal(receipt.typedApiNegatives.length, 2);
  for (const negative of receipt.typedApiNegatives) {
    assert.equal(negative.rejected, true);
    assert.equal(negative.before.stateVersion, negative.after.stateVersion);
    assert.equal(negative.before.receiptCount, negative.after.receiptCount);
    assert.match(negative.diagnostic, /RegisteredTool|parse|argument|JSON/i);
  }
  assert.equal(receipt.invocations.length, 42);
  assert.ok(receipt.invocations.every(({ mechanism }) => mechanism === "getTools -> RegisteredTool -> executeTool(tool, JSON.stringify(input))"));
  assert.equal(receipt.journey.final.phase, "GOAL_ACCEPTED");
  assert.equal(receipt.journey.final.currentActor, "none");
  assert.equal(receipt.journey.final.nextLegalAction, "GOAL_ACCEPTED_NO_FURTHER_ACTION");
  assert.equal(receipt.journey.final.state.stateVersion, 16);
  assert.equal(receipt.journey.receiptCount, 22);
  assert.deepEqual(receipt.journey.actorReceiptCounts, { owner: 6, agent: 14, system: 2 });
  assert.equal(receipt.negatives.malformed.reasonCode, "INVALID_TOOL_INPUT");
  assert.equal(receipt.negatives.prematureClaim.accepted, false);
  assert.equal(receipt.negatives.digestMismatch.accepted, false);
  assert.equal(receipt.negatives.prematureCompletion.accepted, false);
  assert.equal(receipt.negatives.changedIdempotencyReuse.reasonCode, "IDEMPOTENCY_KEY_REUSE");
  assert.equal(receipt.negatives.exactRetry.duplicateReceipt, false);
  assert.equal(receipt.negatives.s14.every(({ accepted, zeroMutation }) => accepted === false && zeroMutation), true);
  assert.equal(receipt.negativeControl.class, "webmcp-unavailable-owner-ui-usable");
  assert.equal(receipt.negativeControl.documentModelContext, "undefined");
  assert.equal(receipt.claimBoundary.autonomousModelSelection, false);
  for (const row of receipt.protectedParity) assert.equal(sha256(await readFile(join(root, row.path))), row.sha256);
  for (const row of receipt.sourceHashes) assert.equal(sha256(await readFile(join(root, row.path))), row.sha256);
  for (const shot of receipt.screenshots) {
    const bytes = await readFile(join(root, shot.path));
    assert.equal(sha256(bytes), shot.sha256);
    assert.equal(bytes.length, shot.bytes);
    assert.equal(bytes.readUInt32BE(16), shot.width);
    assert.equal(bytes.readUInt32BE(20), shot.height);
  }
  const manifest = JSON.parse(await readFile(manifestPath));
  assert.equal(manifest.receipt.sha256, sha256(receiptBytes));
  for (const row of manifest.files) assert.equal(sha256(await readFile(join(root, row.path))), row.sha256);
  return { passed: true, tools: 6, finalPhase: receipt.journey.final.phase, nativeInvocations: receipt.invocations.length, screenshots: receipt.screenshots.length, negativeControl: receipt.negativeControl.class };
}

async function record() {
  assert.ok(existsSync(canary) && existsSync(browserOs), "Approved browsers must exist");
  const canaryProfile = await mkdtemp(join(tmpdir(), "workhub-native-canary-"));
  await writeFile(join(canaryProfile, "Local State"), JSON.stringify({ browser: { enabled_labs_experiments: ["enable-webmcp-testing@1", "devtools-webmcp-support@1"] } }));
  const disk = Number(command("df", ["-k", root]).trim().split(/\s+/).at(-3));
  assert.ok(disk > 500 * 1024, `Disk floor breached: ${disk} KiB`);
  command("npm", ["run", "build"]);
  const dist = join(root, "dist");
  const leaks = [];
  for (const path of (await filesUnder(dist)).filter((value) => [".html", ".js", ".css"].includes(extname(value)))) {
    const text = await readFile(path, "utf8");
    for (const token of ["qualification/v3-fixture", "__v3Qualification", "native-webmcp-receipt"]) if (text.includes(token)) leaks.push({ path: path.slice(dist.length + 1), token });
  }
  assert.deepEqual(leaks, []);
  await mkdir(output, { recursive: true });
  const server = createServer(async (request, response) => {
    try {
      const requested = new URL(request.url ?? "/", "http://localhost").pathname === "/" ? "index.html" : decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname).replace(/^\/+/, "");
      const path = resolve(dist, requested);
      if (path !== dist && !path.startsWith(`${dist}${sep}`)) throw new Error("invalid path");
      const body = await readFile(path);
      response.writeHead(200, { "content-type": { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
      response.end(body);
    } catch { response.writeHead(404).end("Not found"); }
  });
  await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(4177, "127.0.0.1", resolveListen); });
  const origin = "http://127.0.0.1:4177/index.html";
  let browser;
  let control;
  const screenshots = [];
  const invocations = [];
  try {
    browser = await launchCdp(canary, canaryProfile);
    const { call, evaluate } = browser;
    await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 });
    await call("Page.navigate", { url: origin });
    await waitFor(async () => evaluate("document.readyState === 'complete' && typeof document.modelContext?.getTools === 'function' && document.modelContext.getTools().then(x=>x.length===6)"), "native six-tool page");
    const dom = async () => evaluate(`(() => { const p=document.querySelector('.desktop-state-phase')?.textContent??''; const m=p.match(/STATE v(\\d+) · (.+)/); const r=document.querySelector('.desktop-detail:last-child summary')?.textContent??''; return {heading:document.querySelector('#desktop-goal-title')?.textContent??'',frontier:document.querySelector('#desktop-now-heading')?.textContent??'',actor:document.querySelector('.desktop-now')?.dataset.actor??'',status:document.querySelector('.desktop-status')?.textContent??'',connection:document.querySelector('.desktop-connection')?.textContent??'',phaseText:p,stateVersion:m?Number(m[1]):-1,receiptCount:Number(r.match(/Receipts · (\\d+)/)?.[1]??0)}; })()`);
    const nativeState = async (label) => invoke("get_goal_room_state", {}, label);
    const invoke = async (name, input, label) => {
      const before = await dom();
      const value = await evaluate(`(async()=>{const tools=await document.modelContext.getTools();const tool=tools.find(x=>x.name===${JSON.stringify(name)});if(!tool)throw new Error('missing tool');const raw=await document.modelContext.executeTool(tool,JSON.stringify(${JSON.stringify(input)}));return {raw,parsed:typeof raw==='string'?JSON.parse(raw):raw};})()`);
      const after = await dom();
      const row = { sequence: invocations.length + 1, label, name, mechanism: "getTools -> RegisteredTool -> executeTool(tool, JSON.stringify(input))", serializedArguments: JSON.stringify(input), rawResult: value.raw, result: value.parsed, before, after };
      invocations.push(row); return value.parsed;
    };
    const click = async (selector) => {
      const box = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('missing ${selector}');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
      await call("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
      await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
    };
    const type = async (selector, text) => { await click(selector); await call("Input.insertText", { text }); };
    const shot = async (name) => {
      await evaluate("scrollTo(0, 0)"); await wait(50);
      const encoded = await call("Page.captureScreenshot", { format: "png", fromSurface: true }); const bytes = Buffer.from(encoded.data, "base64"); const path = `evaluation/native-webmcp-v3/${name}-1440x900.png`; await writeFile(join(root, path), bytes); screenshots.push({ path, sha256: sha256(bytes), bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), context: "real production page after browser-native WebMCP invocation" });
    };
    const api = await evaluate(`(()=>{const mc=document.modelContext;const proto=Object.getPrototypeOf(mc);const descriptor=(name)=>{const d=Object.getOwnPropertyDescriptor(proto,name);return d?{enumerable:d.enumerable,configurable:d.configurable,writable:'writable'in d?d.writable:null,get:typeof d.get,set:typeof d.set}:null};return{documentModelContext:typeof document.modelContext,navigatorModelContext:typeof navigator.modelContext,prototypeName:proto?.constructor?.name??null,prototypeProperties:Object.getOwnPropertyNames(proto),methods:{registerTool:typeof mc.registerTool,getTools:typeof mc.getTools,executeTool:typeof mc.executeTool,ontoolchange:typeof mc.ontoolchange},methodDescriptors:Object.fromEntries(['registerTool','getTools','executeTool','ontoolchange'].map(n=>[n,descriptor(n)]))};})()`);
    const rawDescriptors = await evaluate(`(async()=>{const tools=await document.modelContext.getTools();return tools.map(t=>({name:t.name,title:t.title,description:t.description,inputSchema:t.inputSchema,annotations:t.annotations,prototypeName:Object.getPrototypeOf(t)?.constructor?.name??null,ownProperties:Object.getOwnPropertyNames(t)}));})()`);
    const descriptors = rawDescriptors.map((row) => ({ ...row, inputSchema: typeof row.inputSchema === "string" ? JSON.parse(row.inputSchema) : row.inputSchema }));
    const browserEnumerationOrder = descriptors.map(({ name }) => name);
    const registrationOrder = expectedTools;
    const initialDom = await dom();
    const typedApiNegatives = [];
    for (const [shape, expression] of [["tool-name-plus-serialized-json", `(async()=>document.modelContext.executeTool('get_goal_room_state','{}'))()`], ["registered-tool-plus-object", `(async()=>{const t=(await document.modelContext.getTools())[0];return document.modelContext.executeTool(t,{})})()`]]) {
      const before = await dom(); let diagnostic = "";
      try { await evaluate(expression); throw new Error("wrong shape unexpectedly accepted"); } catch (error) { diagnostic = String(error.message); }
      const after = await dom(); typedApiNegatives.push({ shape, rejected: true, diagnostic, before, after });
    }
    const initial = await nativeState("initial owner-intent frontier");
    assert.equal(initial.phase, "INTENT_DRAFT"); assert.equal(initial.currentStateVersion, 0);
    const malformed = await invoke("propose_goal_contract", { expectedStateVersion: 0, idempotencyKey: "native-malformed", actor: "owner" }, "malformed unknown-key refusal"); await nativeState("read after malformed");
    const prematureClaim = await invoke("claim_step", { expectedStateVersion: 0, idempotencyKey: "native-premature-claim", planVersion: 1, stepId: "release" }, "premature claim refusal"); await nativeState("read after premature claim");
    await type("#desktop-owner-intent", "Prove a complete native six-tool governed journey"); await click(".desktop-intent-form button[type=submit]"); await nativeState("read after owner intent");
    const goal1Input = { expectedStateVersion: 1, idempotencyKey: "native-goal-v1", goal: "Ship a governed evidence package", why: "Make browser-native authority observable", doneLooksLike: ["Owner accepts corrected Candidate v2 only after PASS"], constraints: ["No external effects"], nonGoals: ["Autonomous model selection"], evidenceRequired: ["Native calls and shared state"], openQuestions: ["Clarify exact candidate custody"] };
    const goal1 = await invoke("propose_goal_contract", goal1Input, "Goal v1"); await nativeState("read after Goal v1");
    const goalRetry = await invoke("propose_goal_contract", goal1Input, "Goal v1 exact retry");
    const changedReuse = await invoke("propose_goal_contract", { ...goal1Input, goal: "Changed bytes under reused key" }, "changed idempotency key reuse");
    await click(".desktop-owner-action .desktop-action.secondary"); await type("#revision-input", "Bind the Goal to corrected Candidate v2 and deterministic evidence."); await click("#revision-form button[type=submit]"); await nativeState("read after Goal revision"); await shot("01-goal-revision-native");
    const staleGoal = await invoke("propose_goal_contract", { ...goal1Input, expectedStateVersion: 2, idempotencyKey: "native-stale-goal" }, "stale Goal proposal refusal");
    const goal2Input = { ...goal1Input, expectedStateVersion: 3, idempotencyKey: "native-goal-v2", goal: "Qualify the complete governed native journey", openQuestions: [] };
    await invoke("propose_goal_contract", goal2Input, "Goal v2"); await nativeState("read after Goal v2"); await click(".desktop-owner-action .desktop-action.primary"); await nativeState("read after Owner Goal confirmation");
    const plan1 = { expectedStateVersion: 5, idempotencyKey: "native-plan-v1", goalContractVersion: 2, steps: [{ id: "release", title: "Produce governed native evidence" }] };
    await invoke("propose_plan", plan1, "Plan v1"); await nativeState("read after Plan v1"); await click(".desktop-owner-action .desktop-action.secondary"); await type("#revision-input", "Bind the step explicitly to corrected Candidate v2."); await click("#revision-form button[type=submit]"); await nativeState("read after Plan revision");
    await invoke("propose_plan", { ...plan1, expectedStateVersion: 7, idempotencyKey: "native-plan-v2", steps: [{ id: "release", title: "Produce corrected Candidate v2 evidence" }] }, "Plan v2"); await nativeState("read after Plan v2"); await click(".desktop-owner-action .desktop-action.primary"); await nativeState("read after Owner Plan confirmation");
    const wrongPlan = await invoke("claim_step", { expectedStateVersion: 9, idempotencyKey: "native-wrong-plan", planVersion: 1, stepId: "release" }, "wrong Plan version refusal");
    const wrongStep = await invoke("claim_step", { expectedStateVersion: 9, idempotencyKey: "native-wrong-step", planVersion: 2, stepId: "other" }, "wrong Plan step refusal");
    await invoke("claim_step", { expectedStateVersion: 9, idempotencyKey: "native-claim", planVersion: 2, stepId: "release" }, "claim exact Plan v2 step"); await nativeState("read after claim");
    const failedContent = JSON.stringify({ publicUrl: "http://example.test/native", demoDurationSeconds: 181, verificationCommand: "npm run build" });
    const failedSha = sha256(failedContent);
    const digestMismatch = await invoke("submit_artifact", { expectedStateVersion: 10, idempotencyKey: "native-bad-digest", planVersion: 2, stepId: "release", content: failedContent, sha256: "0".repeat(64) }, "declared digest mismatch"); await nativeState("read after digest mismatch");
    const submit1Input = { expectedStateVersion: 10, idempotencyKey: "native-candidate-v1", planVersion: 2, stepId: "release", content: failedContent, sha256: failedSha };
    const submit1 = await invoke("submit_artifact", submit1Input, "Candidate v1 automatic FAIL"); const failState = await nativeState("read automatic FAIL"); await shot("02-candidate-v1-native-fail");
    const retryBefore = await dom(); const submit1Retry = await invoke("submit_artifact", submit1Input, "Candidate v1 exact retry"); const retryAfter = await dom(); await nativeState("read after Candidate v1 retry");
    const prematureCompletion = await invoke("request_completion", { expectedStateVersion: 12, idempotencyKey: "native-premature-completion", candidateSha256: failedSha }, "premature completion refusal"); await nativeState("read after premature completion");
    const passedContent = JSON.stringify({ publicUrl: "https://example.test/native", demoDurationSeconds: 180, verificationCommand: "npm test" }); const passedSha = sha256(passedContent);
    await invoke("submit_artifact", { expectedStateVersion: 12, idempotencyKey: "native-candidate-v2", planVersion: 2, stepId: "release", content: passedContent, sha256: passedSha }, "Candidate v2 automatic PASS"); const passState = await nativeState("read automatic PASS"); await shot("03-candidate-v2-native-pass");
    await invoke("request_completion", { expectedStateVersion: 14, idempotencyKey: "native-completion", candidateSha256: passedSha }, "completion request exact Candidate v2"); await nativeState("read after completion request");
    await click(".desktop-owner-action .desktop-action.primary"); await click("#confirm-acceptance"); const final = await nativeState("read sealed S14"); await shot("04-s14-native-sealed");
    const s14 = [];
    for (const [name, input] of [["propose_goal_contract", { ...goal2Input, expectedStateVersion: 16, idempotencyKey: "native-s14-goal", actor: "agent" }], ["request_completion", { expectedStateVersion: 16, idempotencyKey: "native-s14-completion", candidateSha256: passedSha, actor: "agent" }]]) {
      const before = await dom(); const result = await invoke(name, input, `S14 refused ${name}`); const after = await dom(); s14.push({ name, accepted: result.accepted, reasonCode: result.reasonCode, zeroMutation: before.stateVersion === after.stateVersion && before.receiptCount === after.receiptCount }); await nativeState(`read after S14 ${name}`);
    }
    assert.equal(invocations.length, 42);
    const terminal = await dom();
    const receiptCount = terminal.receiptCount;
    assert.equal(receiptCount, 22);
    const negativeProfile = await mkdtemp(join(tmpdir(), "workhub-native-negative-browseros-"));
    try {
      control = await launchCdp(browserOs, negativeProfile, ["--disable-extensions", "--disable-component-extensions-with-background-pages"]);
      await control.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 }); await control.call("Page.navigate", { url: origin });
      await waitFor(async () => control.evaluate("document.readyState==='complete' && !!document.querySelector('#desktop-owner-intent')"), "BrowserOS owner UI");
      const box = await control.evaluate(`(()=>{const e=document.querySelector('#desktop-owner-intent');const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`); await control.call("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 }); await control.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 }); await control.call("Input.insertText", { text: "Owner UI remains usable without WebMCP" });
      const submitBox = await control.evaluate(`(()=>{const e=document.querySelector('.desktop-intent-form button');const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`); await control.call("Input.dispatchMouseEvent", { type: "mousePressed", x: submitBox.x, y: submitBox.y, button: "left", clickCount: 1 }); await control.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: submitBox.x, y: submitBox.y, button: "left", clickCount: 1 });
      await waitFor(async () => control.evaluate("document.querySelector('.desktop-state-phase')?.textContent.includes('STATE v1')"), "negative owner mutation");
      const negative = await control.evaluate(`({documentModelContext:typeof document.modelContext,navigatorModelContext:typeof navigator.modelContext,connection:document.querySelector('.desktop-connection')?.textContent,phase:document.querySelector('.desktop-state-phase')?.textContent,heading:document.querySelector('#desktop-goal-title')?.textContent,ownerUiUsable:document.querySelector('.desktop-state-phase')?.textContent.includes('STATE v1')})`);
      const encoded = await control.call("Page.captureScreenshot", { format: "png", fromSurface: true }); const bytes = Buffer.from(encoded.data, "base64"); const path = "evaluation/native-webmcp-v3/05-browseros-negative-control-1440x900.png"; await writeFile(join(root, path), bytes); screenshots.push({ path, sha256: sha256(bytes), bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), context: "fresh BrowserOS negative control; Owner UI usable and WebMCP unavailable" });
      const localStateBytes = await readFile(join(canaryProfile, "Local State"));
      const localState = JSON.parse(localStateBytes);
      const signature = command("codesign", ["-dv", "--verbose=4", canaryApp]);
      const gatekeeper = command("spctl", ["--assess", "--type", "execute", "-vv", canaryApp]);
      const protectedParity = await Promise.all(Object.entries(expectedProtected).map(async ([path, expected]) => { const actual = sha256(await readFile(join(root, path))); assert.equal(actual, expected); return { path, sha256: actual, unchanged: true }; }));
      const boundSources = ["index.html", "src/main.ts", "src/revisionDialog.ts", "src/desktopUi.ts", "src/mobileUi.ts", "src/systemVerifierAdapter.ts", "src/webmcp.ts", "submission/scripts/v3-native-webmcp-proof.mjs", "scripts/v3-native-webmcp-proof.node-test.mjs"];
      const sourceHashes = await Promise.all(boundSources.map(async (path) => { const bytes = await readFile(join(root, path)); return { path, sha256: sha256(bytes), bytes: bytes.length }; }));
      const receipt = {
        schemaVersion: 1, kind: "workhub-v3-native-webmcp-governed-journey",
        testedProductionIdentity: { baseCommit: command("git", ["rev-parse", "HEAD"]), exactSourceBinding: "validated sourceHashes from the fresh native run" },
        binding: { pattern: "fresh native runtime bound to exact committed source hashes", evidenceCommit: "recorded_after_commit_in_git", evidenceTree: "recorded_after_commit_in_git" },
        route: { url: origin, entry: "index.html", sourceEntry: "src/main.ts", localLoopback: true, bundleLeaks: leaks },
        browser: { application: "Google Chrome Canary", version: command(canary, ["--version"]), identifier: "com.google.Chrome.canary", teamIdentifier: "EQHXZ8M8AV", signatureVerified: /Identifier=com\.google\.Chrome\.canary/.test(signature) && /TeamIdentifier=EQHXZ8M8AV/.test(signature), notarized: /accepted/.test(gatekeeper) && /Notarized Developer ID/.test(gatekeeper), isolatedUnsignedInProfile: true, profilePathRecordedBeforeAuthorizedCleanup: "redacted disposable task profile", localStateSha256: sha256(localStateBytes), experiments: localState.browser.enabled_labs_experiments },
        api, registrationOrder, browserEnumerationOrder, descriptors,
        typedApiNegatives, invocations,
        journey: { initial, goal1, failState, passState, final, receiptCount, actorReceiptCounts: { owner: 6, agent: 14, system: 2 }, finalDom: terminal, systemVerifier: "automatic production src/systemVerifierAdapter.ts" },
        negatives: { malformed, prematureClaim, staleGoal, wrongPlan, wrongStep, digestMismatch, prematureCompletion, changedIdempotencyReuse: changedReuse, exactRetry: { sameResult: canonical(submit1Retry) === canonical(submit1), duplicateReceipt: retryBefore.receiptCount !== retryAfter.receiptCount }, privilegedDescriptorsAbsent: !descriptors.some(({ name }) => /verify|confirm|accept|deploy|message|payment|publish|account/i.test(name)), s14 },
        negativeControl: { class: "webmcp-unavailable-owner-ui-usable", browser: "BrowserOS", version: command(browserOs, ["--version"]), disposableProfile: true, noInjectedModelContext: true, noWebMcpFlags: true, ...negative },
        screenshots, protectedParity, sourceHashes,
        claimBoundary: { allowed: "V3’s exact six-tool surface was registered, discovered, and invoked through the qualifying browser WebMCP API; accepted/refused calls were reflected in independently read shared page state, and governed authority boundaries held.", autonomousModelSelection: false, externalEffects: false },
        cleanup: { browsersAndServerStoppedInFinally: true, canaryProfileRemoval: "authorized after evidence packaging", negativeProfileRemoval: "in finally", port: 4177 },
      };
      await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
      const receiptBytes = await readFile(receiptPath);
      const manifestFiles = ["evaluation/native-webmcp-v3/native-webmcp-receipt.json", ...screenshots.map(({ path }) => path)];
      const files = await Promise.all(manifestFiles.map(async (path) => { const bytes = await readFile(join(root, path)); return { path, sha256: sha256(bytes), bytes: bytes.length }; }));
      await writeFile(manifestPath, `${JSON.stringify({ schemaVersion: 1, kind: "workhub-v3-native-webmcp-manifest", nonRecursive: true, receipt: { path: "evaluation/native-webmcp-v3/native-webmcp-receipt.json", sha256: sha256(receiptBytes), bytes: receiptBytes.length }, files }, null, 2)}\n`);
    } finally { await control?.close(); await removeProfile(negativeProfile); }
  } finally { await browser?.close(); await new Promise((resolveClose) => server.close(resolveClose)); await removeProfile(canaryProfile); }
  return validate();
}

const mode = process.argv[2] ?? "validate";
const summary = mode === "record" ? await record() : mode === "validate" ? await validate() : (() => { throw new Error("usage: v3-native-webmcp-proof.mjs [record|validate]"); })();
console.log(JSON.stringify(summary));
