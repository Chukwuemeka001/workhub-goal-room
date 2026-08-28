import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { resolveBrowserExecutable } from "./browser-resolver.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const dist = join(root, "dist");
const output = join(root, "evaluation", "production-journey");
const chromePath = resolveBrowserExecutable();
const browserVersion = spawnSync(chromePath, ["--version"], { encoding: "utf8" }).stdout.trim();
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hostile = (length) => (`<img src=x onerror=__PRODUCTION_JOURNEY_INJECTION__()>😀&"'` + "X".repeat(length)).slice(0, length);

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
    child.once("exit", (code, signal) => code === 0 ? resolveRun() : reject(new Error(`${command} exited ${code ?? signal}`)));
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
await mkdir(output, { recursive: true });
const productionFiles = await filesUnder(dist);
const forbiddenTokens = ["qualification/v3-fixture", "qualification/v3-replay", "__v3Qualification", "advance-demo", "synthetic S09"];
const bundleLeaks = [];
for (const path of productionFiles.filter((value) => [".html", ".js", ".css"].includes(extname(value)))) {
  const text = await readFile(path, "utf8");
  for (const token of forbiddenTokens) if (text.includes(token)) bundleLeaks.push({ file: path.slice(dist.length + 1), token });
}
if (bundleLeaks.length) throw new Error(`Production bundle leaked qualification code: ${JSON.stringify(bundleLeaks)}`);

const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png" };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const path = resolve(dist, requested);
    if (path !== dist && !path.startsWith(`${dist}${sep}`)) throw new Error("invalid path");
    const body = await readFile(path);
    response.writeHead(200, { "content-type": mime[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
    response.end(body);
  } catch { response.writeHead(404).end("Not found"); }
});
await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(4177, "127.0.0.1", resolveListen); });
const address = server.address();
if (!address || typeof address === "string") throw new Error("No local server port");
const origin = `http://127.0.0.1:${address.port}`;
const profile = await mkdtemp(join(tmpdir(), "workhub-production-journey-"));
let chrome;
let socket;
const screenshots = [];
try {
  chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--disable-extensions", "--disable-component-extensions-with-background-pages", "--hide-scrollbars", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
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
  await call("Page.enable"); await call("Runtime.enable"); await call("Accessibility.enable");
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    window.__productionJourney = { tools: new Map(), registrations: [], digests: [], injectionCalls: 0 };
    window.__PRODUCTION_JOURNEY_INJECTION__ = () => { window.__productionJourney.injectionCalls += 1; };
    Object.defineProperty(document, 'modelContext', { configurable: true, value: {
      registerTool(tool) { window.__productionJourney.tools.set(tool.name, tool); window.__productionJourney.registrations.push({name:tool.name,title:tool.title,inputSchema:tool.inputSchema,annotations:tool.annotations}); }
    }});
    const original = crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest = async (algorithm, data) => {
      const bytes = new Uint8Array(data); const result = await original(algorithm, data);
      const hash = [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2,'0')).join('');
      window.__productionJourney.digests.push({ text: new TextDecoder().decode(bytes), hash });
      return result;
    };
  })();` });
  async function evaluate(expression) {
    const response = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result.value;
  }
  async function setViewport(width, height) {
    await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 1200, screenWidth: width, screenHeight: height });
  }
  async function click(selector) {
    const box = await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e) throw new Error(${JSON.stringify(`missing selector: ${selector}`)}); e.scrollIntoView({block:'center',inline:'center'}); e.focus(); const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,visible:getComputedStyle(e).display!=='none'&&r.width>0&&r.height>0&&r.bottom>=0&&r.top<=innerHeight}; })()`);
    if (!box.visible) throw new Error(`Control not visible: ${selector}`);
    await call("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
    await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
  }
  async function type(selector, value) {
    await click(selector);
    await call("Input.insertText", { text: value });
  }
  async function invoke(name, input) {
    return evaluate(`window.__productionJourney.tools.get(${JSON.stringify(name)}).execute(${JSON.stringify(input)})`);
  }
  async function state() { return invoke("get_goal_room_state", {}); }
  async function expectState(version, phase) {
    return waitFor(async () => { const current = await state(); return current.currentStateVersion === version && current.phase === phase ? current : false; }, `${phase} v${version}`);
  }
  async function screenshot(name, width = 1440, height = 900) {
    await setViewport(width, height); await wait(50);
    const shot = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
    const bytes = Buffer.from(shot.data, "base64"); const path = join(output, `${name}-${width}x${height}.png`);
    await writeFile(path, bytes);
    screenshots.push({ path: path.slice(root.length + 1), sha256: sha256(bytes), bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), mode: "headless-cdp-production-entry" });
  }
  const contrastInventory = [];
  async function captureContrast(spec) {
    if (spec.focus) { await click(spec.selector); await wait(20); }
    const measured = await evaluate(`(() => {
      const spec=${JSON.stringify(spec)};
      const element=document.querySelector(spec.selector);
      const backgroundElement=document.querySelector(spec.backgroundSelector);
      if(!element||!backgroundElement) throw new Error('Missing contrast selector '+JSON.stringify(spec));

      const parse=(value) => {
        const match=value.match(/rgba?\\(([^)]+)\\)/i);
        if(!match) throw new Error('Unsupported computed color '+value);
        const parts=match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        return {r:parts[0],g:parts[1],b:parts[2],a:parts.length>3?parts[3]:1};
      };
      const composite=(front,back) => ({r:front.r*front.a+back.r*(1-front.a),g:front.g*front.a+back.g*(1-front.a),b:front.b*front.a+back.b*(1-front.a),a:1});
      const background=(node) => {
        const layers=[];
        for(let current=node;current;current=current.parentElement) layers.push(parse(getComputedStyle(current).backgroundColor));
        let result={r:9,g:10,b:11,a:1};
        for(const layer of layers.reverse()) result=composite(layer,result);
        return result;
      };
      const elementStyle=getComputedStyle(element);
      const bg=background(backgroundElement);
      let raw;
      if(spec.property==='boxShadow') {
        const match=elementStyle.boxShadow.match(/rgba?\\([^)]+\\)/i);
        if(!match) throw new Error('No computed box-shadow color for '+spec.selector);
        raw=parse(match[0]);
      } else raw=parse(elementStyle[spec.property]);
      const fg=composite(raw,bg);
      const channel=(value) => { const normalized=value/255; return normalized<=0.04045?normalized/12.92:((normalized+0.055)/1.055)**2.4; };
      const luminance=(color) => 0.2126*channel(color.r)+0.7152*channel(color.g)+0.0722*channel(color.b);
      const ratio=(Math.max(luminance(fg),luminance(bg))+0.05)/(Math.min(luminance(fg),luminance(bg))+0.05);
      const hex=(color) => '#'+[color.r,color.g,color.b].map(value=>Math.round(value).toString(16).padStart(2,'0')).join('');
      return {foreground:hex(fg),background:hex(bg),ratio:Number(ratio.toFixed(2)),computedProperty:spec.property,rendered:getComputedStyle(element).display!=='none'&&element.getClientRects().length>0,focused:document.activeElement===element,outlineStyle:elementStyle.outlineStyle,outlineWidth:elementStyle.outlineWidth};
    })()`);
    const focusValid = !spec.focus || (measured.focused && measured.outlineStyle === "solid" && Number.parseFloat(measured.outlineWidth) >= 3);
    const row = { ...spec, ...measured, threshold: spec.threshold, pass: measured.rendered && focusValid && measured.ratio >= spec.threshold };
    delete row.backgroundSelector; delete row.property; delete row.focus; delete row.rendered;
    contrastInventory.push(row);
    if (!row.pass) throw new Error(`Production contrast failure: ${JSON.stringify(row)}`);
  }
  async function captureInitialContrast(composition, width, height) {
    await setViewport(width, height); await wait(50);
    const desktop = composition === "desktop";
    const rows = desktop ? [
      { category:"normal-text", selector:".desktop-goal-meta", backgroundSelector:".desktop-surface", property:"color", token:"--d-muted", state:"initial-owner" ,threshold:4.5 },
      { category:"large-text", selector:".desktop-goal-identity h1", backgroundSelector:".desktop-surface", property:"color", token:"desktop goal heading", state:"initial-owner", threshold:3 },
      { category:"status-warning", selector:".desktop-state-phase", backgroundSelector:".desktop-surface", property:"color", token:"--d-owner", state:"initial-owner", threshold:4.5 },
      { category:"actionable-control", selector:".desktop-tab[aria-selected='true']", backgroundSelector:".desktop-inspector", property:"boxShadow", token:"--d-owner selected-tab indicator", state:"initial-owner", threshold:3 },
      { category:"focus-indicator", selector:".desktop-tab[aria-selected='true']", backgroundSelector:".desktop-surface", property:"outlineColor", token:"#f0bd72 focus ring", state:"initial-owner-focus", threshold:3, focus:true },
    ] : [
      { category:"normal-text", selector:".mobile-goal-meta", backgroundSelector:".mobile-room", property:"color", token:"--muted", state:"initial-owner", threshold:4.5 },
      { category:"large-text", selector:".mobile-goal-title", backgroundSelector:".mobile-room", property:"color", token:"mobile goal heading", state:"initial-owner", threshold:3 },
      { category:"status-warning", selector:".mobile-brand", backgroundSelector:".mobile-room", property:"color", token:"--owner", state:"initial-owner", threshold:4.5 },
      { category:"actionable-control", selector:".mobile-tab[aria-selected='true']", backgroundSelector:".mobile-tab-bar", property:"boxShadow", token:"--owner selected-tab indicator", state:"initial-owner", threshold:3 },
      { category:"focus-indicator", selector:".mobile-tab[aria-selected='true']", backgroundSelector:".mobile-tab-bar", property:"outlineColor", token:"#f0bd72 focus ring", state:"initial-owner-focus", threshold:3, focus:true },
    ];
    for (const row of rows) await captureContrast({ composition, ...row });
  }
  async function captureVerdictContrast(verdict, composition, width, height) {
    await setViewport(width, height); await wait(50);
    const desktop = composition === "desktop";
    await click(desktop ? "#desktop-tab-proof" : "#mobile-tab-proof");
    await captureContrast({
      composition,
      category: verdict === "PASS" ? "status-success" : "status-fail",
      selector: desktop ? `.desktop-candidate-history li[data-verdict='${verdict}'] strong` : `.mobile-candidate-history li[data-verdict='${verdict}'] strong`,
      backgroundSelector: desktop ? ".desktop-inspector" : ".mobile-room",
      property: "color",
      token: desktop ? (verdict === "PASS" ? "--d-pass" : "--d-fail") : (verdict === "PASS" ? "--pass" : "--fail"),
      state: verdict === "PASS" ? "candidate-v2-pass" : "candidate-v1-fail",
      threshold: 4.5,
    });
    await click(desktop ? "#desktop-tab-goal" : "#mobile-tab-goal");
  }
  function checkpoint(label, actor, trigger, value) {
    return { label, actor, trigger, stateVersion: value.currentStateVersion, phase: value.phase, currentActor: value.currentActor, nextLegalAction: value.nextLegalAction, candidate: value.candidate, verification: value.verification };
  }
  const checkpoints = [];
  await setViewport(1440, 900);
  await call("Page.navigate", { url: `${origin}/index.html` });
  await waitFor(async () => evaluate("document.readyState === 'complete' && window.__productionJourney.registrations.length === 6"), "production entry and six registrations");
  const registration = await evaluate("window.__productionJourney.registrations");
  const expectedTools = ["get_goal_room_state", "propose_goal_contract", "propose_plan", "claim_step", "submit_artifact", "request_completion"];
  if (JSON.stringify(registration.map(({ name }) => name)) !== JSON.stringify(expectedTools)) throw new Error("Registered surface mismatch");
  let current = await expectState(0, "INTENT_DRAFT");
  checkpoints.push(checkpoint("fresh", "owner", "production load", current));

  await captureInitialContrast("desktop", 1440, 900);
  await captureInitialContrast("mobile", 393, 852);
  await setViewport(720, 450); await wait(50);
  const requiredZoomSelectors = [
    ".mobile-goal-title", ".mobile-actor", ".mobile-frontier-title", ".mobile-frontier-live", ".mobile-boundary",
    "#mobile-owner-intent", ".mobile-intent-form button[type='submit']", "#mobile-tab-goal", "#mobile-tab-plan", "#mobile-tab-proof", "#mobile-tab-activity", ".judge-help summary",
  ];
  const requiredContent = [];
  for (const selector of requiredZoomSelectors) {
    requiredContent.push(await evaluate(`(() => { const selector=${JSON.stringify(selector)},e=document.querySelector(selector); if(!e)return {selector,rendered:false,reachable:false}; const rendered=getComputedStyle(e).display!=='none'&&e.getClientRects().length>0; e.scrollIntoView({block:'center',inline:'nearest'}); const r=e.getBoundingClientRect(); return {selector,rendered,reachable:rendered&&r.right>0&&r.left<innerWidth&&r.bottom>0&&r.top<innerHeight}; })()`));
  }
  const zoomComposition = await evaluate(`(() => { const shown=e=>getComputedStyle(e).display!=='none'&&e.getClientRects().length>0; const active=[document.querySelector('#mobile-room'),document.querySelector('.desktop-surface')].filter(shown).map(e=>e.id||e.className); return {active}; })()`);
  const zoomTree = await call("Accessibility.getFullAXTree");
  zoomComposition.axMainNames = zoomTree.nodes.filter((node) => !node.ignored && node.role?.value === "main").map((node) => node.name?.value ?? "");
  const zoomViewport = await evaluate(`({innerWidth,innerHeight,devicePixelRatio,visualViewport:{width:visualViewport.width,height:visualViewport.height,scale:visualViewport.scale},overflow:{documentX:document.documentElement.scrollWidth-document.documentElement.clientWidth,bodyX:document.body.scrollWidth-document.body.clientWidth}})`);
  const zoom200 = {
    route: "/index.html", method: "halved-css-viewport-equivalent", referenceViewport: { width: 1440, height: 900 },
    cssViewport: { innerWidth: zoomViewport.innerWidth, innerHeight: zoomViewport.innerHeight }, effectiveScale: 1440 / zoomViewport.innerWidth,
    devicePixelRatio: zoomViewport.devicePixelRatio, visualViewport: zoomViewport.visualViewport, overflow: zoomViewport.overflow,
    composition: zoomComposition, requiredContent,
    assertion: "A 720x450 measured CSS viewport is the effective 200% equivalent of the 1440x900 reference viewport; production /index.html remains scroll-reachable without horizontal overflow.",
  };
  if (zoom200.effectiveScale !== 2 || zoom200.cssViewport.innerWidth !== 720 || zoom200.cssViewport.innerHeight !== 450 || zoom200.visualViewport.width !== 720 || zoom200.visualViewport.height !== 450 || zoom200.overflow.documentX || zoom200.overflow.bodyX || zoomComposition.active.length !== 1 || zoomComposition.active[0] !== "mobile-room" || zoomComposition.axMainNames.length !== 1 || requiredContent.some((row) => !row.rendered || !row.reachable)) throw new Error(`Effective production 200% zoom failed: ${JSON.stringify(zoom200)}`);
  await screenshot("effective-200pct-production", 720, 450);
  await setViewport(1440, 900);

  const initialDigestCount = await evaluate("window.__productionJourney.digests.length");
  const unknown = await invoke("propose_goal_contract", { expectedStateVersion: 0, idempotencyKey: "pj-unknown", actor: "owner" });
  if (unknown.reasonCode !== "INVALID_TOOL_INPUT" || (await state()).currentStateVersion !== 0 || await evaluate("window.__productionJourney.digests.length") !== initialDigestCount) throw new Error("Unknown-key/actor probe mutated");
  const earlyClaim = await invoke("claim_step", { expectedStateVersion: 0, idempotencyKey: "pj-premature-claim", planVersion: 1, stepId: "release" });
  if (earlyClaim.accepted !== false) throw new Error("Premature claim accepted");

  await type("#desktop-owner-intent", hostile(1000)); await click(".desktop-intent-form button[type=submit]");
  current = await expectState(1, "INTENT_DRAFT"); checkpoints.push(checkpoint("owner-intent", "owner", "visible desktop intent form", current));
  const max = hostile(1000), maxItem = hostile(500);
  const goal1Input = { expectedStateVersion: 1, idempotencyKey: "pj-goal-v1", goal: max, why: max, doneLooksLike: [maxItem], constraints: [maxItem], nonGoals: [maxItem], evidenceRequired: [maxItem], openQuestions: [maxItem] };
  const goal1 = await invoke("propose_goal_contract", goal1Input); if (!goal1.accepted) throw new Error("Goal v1 refused");
  const goal1Retry = await invoke("propose_goal_contract", structuredClone(goal1Input)); if (JSON.stringify(goal1Retry) !== JSON.stringify(goal1)) throw new Error("Goal exact retry changed result");
  const changedReuse = await invoke("propose_goal_contract", { ...goal1Input, goal: `${max.slice(0, 999)}Y` });
  if (changedReuse.reasonCode !== "IDEMPOTENCY_KEY_REUSE") throw new Error("Changed idempotency reuse did not fail closed");
  current = await expectState(2, "GOAL_CONTRACT_PROPOSED"); checkpoints.push(checkpoint("goal-v1", "agent", "captured propose_goal_contract callback", current));
  const hostileDom = await evaluate(`({injectionCalls:window.__productionJourney.injectionCalls,injectedNodes:document.querySelectorAll('img[src="x"]').length,literal:document.body.textContent.includes(${JSON.stringify(maxItem)})})`);
  if (hostileDom.injectionCalls || hostileDom.injectedNodes || !hostileDom.literal) throw new Error(`Hostile maximum content was not literal: ${JSON.stringify(hostileDom)}`);
  await click(".desktop-owner-action .desktop-action.secondary"); await type("#revision-input", "Replace hostile stress copy with the exact public-safe Goal and close the question."); await click("#revision-form button[type=submit]");
  current = await expectState(3, "GOAL_CONTRACT_REVISION_REQUESTED"); checkpoints.push(checkpoint("goal-revision", "owner", "visible revision dialog", current)); await screenshot("goal-revision");
  const staleGoal = await invoke("propose_goal_contract", { ...goal1Input, expectedStateVersion: 2, idempotencyKey: "pj-stale-goal" });
  if (staleGoal.reasonCode !== "STALE_STATE") throw new Error("Stale version probe did not fail closed");
  const goal2Input = { expectedStateVersion: 3, idempotencyKey: "pj-goal-v2", goal: "Qualify the complete governed production journey", why: "Keep Agent, Owner, and System authority observable.", doneLooksLike: ["Owner accepts corrected Candidate v2 only after deterministic PASS"], constraints: ["No external effects"], nonGoals: ["Autonomous model selection"], evidenceRequired: ["Hash-linked replay-clean receipt ledger"], openQuestions: [] };
  await invoke("propose_goal_contract", goal2Input); await click(".desktop-owner-action .desktop-action.primary");
  current = await expectState(5, "GOAL_CONTRACT_CONFIRMED"); checkpoints.push(checkpoint("goal-v2-confirmed", "owner", "visible confirm control after callback proposal", current));

  const plan1Input = { expectedStateVersion: 5, idempotencyKey: "pj-plan-v1", goalContractVersion: 2, steps: [{ id: "release", title: "Produce governed release evidence" }] };
  await invoke("propose_plan", plan1Input); await click(".desktop-owner-action .desktop-action.secondary"); await type("#revision-input", "Bind the step explicitly to corrected Candidate v2 and deterministic evidence."); await click("#revision-form button[type=submit]");
  current = await expectState(7, "PLAN_REVISION_REQUESTED"); checkpoints.push(checkpoint("plan-revision", "owner", "visible revision dialog", current)); await screenshot("plan-revision");
  const plan2Input = { expectedStateVersion: 7, idempotencyKey: "pj-plan-v2", goalContractVersion: 2, steps: [{ id: "release", title: "Produce corrected Candidate v2 and deterministic evidence" }] };
  await invoke("propose_plan", plan2Input); await click(".desktop-owner-action .desktop-action.primary");
  current = await expectState(9, "PLAN_CONFIRMED"); checkpoints.push(checkpoint("plan-v2-confirmed", "owner", "visible confirm control after callback proposal", current));
  const wrongPlan = await invoke("claim_step", { expectedStateVersion: 9, idempotencyKey: "pj-wrong-plan", planVersion: 1, stepId: "release" });
  const wrongStep = await invoke("claim_step", { expectedStateVersion: 9, idempotencyKey: "pj-wrong-step", planVersion: 2, stepId: "other" });
  if (wrongPlan.accepted !== false || wrongStep.accepted !== false) throw new Error("Wrong Plan/step probe accepted");
  await invoke("claim_step", { expectedStateVersion: 9, idempotencyKey: "pj-claim", planVersion: 2, stepId: "release" });
  current = await expectState(10, "STEP_CLAIMED"); checkpoints.push(checkpoint("claim", "agent", "captured claim_step callback", current));
  const badDigest = await invoke("submit_artifact", { expectedStateVersion: 10, idempotencyKey: "pj-bad-digest", planVersion: 2, stepId: "release", content: "{}", sha256: "0".repeat(64) });
  if (badDigest.accepted !== false) throw new Error("Digest mismatch accepted");

  const failedContent = JSON.stringify({ publicUrl: "http://example.test/production", demoDurationSeconds: 181, verificationCommand: "npm run build" });
  const failedSha = sha256(failedContent);
  const submit1Input = { expectedStateVersion: 10, idempotencyKey: "pj-candidate-v1", planVersion: 2, stepId: "release", content: failedContent, sha256: failedSha };
  const submit1 = await invoke("submit_artifact", submit1Input); if (!submit1.accepted) throw new Error("Candidate v1 refused");
  current = await expectState(12, "VERIFICATION_FAILED"); checkpoints.push(checkpoint("candidate-v1-fail", "system", "production systemVerifierAdapter automatic observation", current)); await screenshot("candidate-v1-fail");
  const failScrollY = await evaluate("scrollY");
  await captureVerdictContrast("FAIL", "desktop", 1440, 900);
  await captureVerdictContrast("FAIL", "mobile", 393, 852);
  await setViewport(1440, 900); await evaluate(`scrollTo(0,${failScrollY})`);
  const receiptsBeforeDuplicate = (await evaluate("window.__productionJourney.digests.length"));
  const duplicate = await invoke("submit_artifact", structuredClone(submit1Input));
  await wait(100);
  if (JSON.stringify(duplicate) !== JSON.stringify(submit1) || (await state()).currentStateVersion !== 12 || await evaluate("window.__productionJourney.digests.length") !== receiptsBeforeDuplicate) throw new Error("Duplicate Candidate callback changed authority");
  const prematureCompletion = await invoke("request_completion", { expectedStateVersion: 12, idempotencyKey: "pj-premature-completion", candidateSha256: failedSha });
  if (prematureCompletion.accepted !== false) throw new Error("Premature completion accepted");
  const v1 = structuredClone(current.state.candidateHistory[0]); const failRecord = structuredClone(current.state.verificationHistory[0]);

  const passedContent = JSON.stringify({ publicUrl: "https://example.test/production", demoDurationSeconds: 180, verificationCommand: "npm test" });
  const passedSha = sha256(passedContent);
  await invoke("submit_artifact", { expectedStateVersion: 12, idempotencyKey: "pj-candidate-v2", planVersion: 2, stepId: "release", content: passedContent, sha256: passedSha });
  current = await expectState(14, "VERIFICATION_PASSED");
  const passScrollY = await evaluate("scrollY");
  await captureVerdictContrast("PASS", "desktop", 1440, 900);
  await captureVerdictContrast("PASS", "mobile", 393, 852);
  await setViewport(1440, 900); await evaluate(`scrollTo(0,${passScrollY})`);
  if (JSON.stringify(current.state.candidateHistory[0]) !== JSON.stringify(v1) || JSON.stringify(current.state.verificationHistory[0]) !== JSON.stringify(failRecord)) throw new Error("Candidate v1/FAIL history mutated");
  const s12Controls = await evaluate(`([...document.querySelectorAll('.desktop-owner-action button')].filter(e=>getComputedStyle(e).display!=='none').map(e=>e.textContent.trim()))`);
  if (s12Controls.some((label) => /accept/i.test(label))) throw new Error("S12 exposed Owner acceptance");
  checkpoints.push(checkpoint("candidate-v2-pass-s12", "system", "production systemVerifierAdapter automatic observation", current)); await screenshot("candidate-v2-pass-s12");
  await invoke("request_completion", { expectedStateVersion: 14, idempotencyKey: "pj-completion", candidateSha256: passedSha });
  current = await expectState(15, "COMPLETION_REQUESTED"); checkpoints.push(checkpoint("completion-s13", "agent", "captured request_completion callback", current));

  const stateBeforeModal = structuredClone(current.state); const digestCountBeforeModal = await evaluate("window.__productionJourney.digests.length");
  const triggerSelector = ".desktop-owner-action .desktop-action.primary";
  await evaluate(`window.__pjAcceptanceTrigger=document.querySelector(${JSON.stringify(triggerSelector)})`);
  await click(triggerSelector);
  const modal = await evaluate(`(() => { const d=document.querySelector('#acceptance-dialog'); return {open:d.open,version:document.querySelector('#acceptance-candidate-version').textContent,digest:document.querySelector('#acceptance-candidate-digest').textContent,ruleSet:document.querySelector('#acceptance-rule-set').textContent,consequence:document.querySelector('#acceptance-dialog-consequence').textContent,focusInside:d.contains(document.activeElement)}; })()`);
  if (!modal.open || !modal.version.startsWith("Candidate v2 ") || modal.digest !== passedSha || modal.ruleSet !== "workhub_goal_room_release/v1" || !modal.consequence.includes("irreversible") || !modal.focusInside) throw new Error(`S13 modal binding mismatch: ${JSON.stringify(modal)}`);
  await screenshot("s13-exact-candidate-modal");
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  const escape = await evaluate(`({open:document.querySelector('#acceptance-dialog').open,focusReturned:document.activeElement===window.__pjAcceptanceTrigger})`);
  const escapeState = await state(); const escapeDigestCount = await evaluate("window.__productionJourney.digests.length");
  if (escape.open || !escape.focusReturned || JSON.stringify(escapeState.state) !== JSON.stringify(stateBeforeModal) || escapeDigestCount !== digestCountBeforeModal) throw new Error(`Escape mutated state or failed focus return: ${JSON.stringify({escape,stateEqual:JSON.stringify(escapeState.state)===JSON.stringify(stateBeforeModal),digestCountBeforeModal,escapeDigestCount,active:await evaluate("document.activeElement?.textContent?.trim()")})}`);
  await evaluate(`window.__pjAcceptanceTrigger=document.querySelector(${JSON.stringify(triggerSelector)})`);
  await click(triggerSelector); await click("#cancel-acceptance");
  const cancel = await evaluate(`({open:document.querySelector('#acceptance-dialog').open,focusReturned:document.activeElement===window.__pjAcceptanceTrigger})`);
  const cancelState = await state(); const cancelDigestCount = await evaluate("window.__productionJourney.digests.length");
  if (cancel.open || !cancel.focusReturned || JSON.stringify(cancelState.state) !== JSON.stringify(stateBeforeModal) || cancelDigestCount !== digestCountBeforeModal) throw new Error(`Cancel mutated state or failed focus return: ${JSON.stringify({cancel,stateEqual:JSON.stringify(cancelState.state)===JSON.stringify(stateBeforeModal),digestCountBeforeModal,cancelDigestCount,activeEqualsTrigger:await evaluate("document.activeElement===window.__pjAcceptanceTrigger")})}`);
  await evaluate(`window.__pjAcceptanceTrigger=document.querySelector(${JSON.stringify(triggerSelector)})`);
  await click(triggerSelector); await click("#confirm-acceptance");
  current = await expectState(16, "GOAL_ACCEPTED"); checkpoints.push(checkpoint("sealed-s14", "owner", "visible exact-candidate confirmation dialog", current));
  const terminal = await evaluate(`({buttons:[...document.querySelectorAll('.desktop-owner-action button')].filter(e=>getComputedStyle(e).display!=='none').length,actor:document.querySelector('.desktop-now')?.dataset.actor,copy:document.querySelector('.desktop-owner-action')?.textContent})`);
  const modalMutationCount = await evaluate("window.__productionJourney.digests.length") - digestCountBeforeModal;
  if (current.currentActor !== "none" || current.nextLegalAction !== "GOAL_ACCEPTED_NO_FURTHER_ACTION" || terminal.actor !== "none" || terminal.buttons !== 0 || modalMutationCount !== 1) throw new Error(`S14 is not sealed: ${JSON.stringify({currentActor:current.currentActor,nextLegalAction:current.nextLegalAction,terminal,modalMutationCount})}`);
  await screenshot("s14-sealed", 1440, 900); await screenshot("s14-mobile", 393, 852);

  const compositions = [];
  for (const [width, height] of [[320,568],[393,852],[1199,900],[1200,900],[1440,900]]) {
    await setViewport(width, height); await wait(50);
    const row = await evaluate(`(() => { const m=document.querySelector('#mobile-room'),d=document.querySelector('.desktop-surface'); const shown=e=>getComputedStyle(e).display!=='none'&&e.getClientRects().length>0; const ax=[m,d].filter(shown); return {innerWidth,active:ax.map(e=>e.id||e.className),documentOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,bodyOverflow:document.body.scrollWidth-document.body.clientWidth,minControlHeight:Math.min(...[...document.querySelectorAll('button,textarea')].filter(e=>shown(e)).map(e=>e.getBoundingClientRect().height))}; })()`);
    const expected = width < 1200 ? "mobile-room" : "desktop-surface";
    if (row.active.length !== 1 || row.active[0] !== expected || row.documentOverflow || row.bodyOverflow || row.minControlHeight < 43.5) throw new Error(`Composition failure ${width}: ${JSON.stringify(row)}`);
    const tree = await call("Accessibility.getFullAXTree");
    row.axMainNames = tree.nodes.filter((node) => !node.ignored && node.role?.value === "main").map((node) => node.name?.value ?? "");
    if (row.axMainNames.length !== 1) throw new Error(`AX XOR failure ${width}`);
    compositions.push({ width, height, expected, ...row });
    if (width === 1199 || width === 1200) await screenshot("breakpoint-xor", width, height);
  }

  const digestRows = await evaluate("window.__productionJourney.digests");
  const receipts = digestRows.flatMap(({ text, hash }) => { try { const value=JSON.parse(text); return value && Number.isInteger(value.sequence) && value.command && typeof value.previousHash==='string' && typeof value.accepted==='boolean' ? [{...value,hash}] : []; } catch { return []; } });
  if (receipts.length !== 22) throw new Error(`Expected 22 authoritative receipts, got ${receipts.length}`);
  receipts.forEach((receipt, index) => {
    if (receipt.sequence !== index + 1 || receipt.previousHash !== (index ? receipts[index - 1].hash : "GENESIS") || !/^[0-9a-f]{64}$/.test(receipt.hash)) throw new Error(`Receipt chain mismatch at ${index + 1}`);
  });
  const actorCounts = Object.fromEntries(["owner","agent","system"].map((actor) => [actor, receipts.filter((receipt) => receipt.command.actor === actor).length]));
  if (actorCounts.owner !== 6 || actorCounts.agent !== 14 || actorCounts.system !== 2) throw new Error(`Actor custody mismatch: ${JSON.stringify(actorCounts)}`);
  const finalState = current.state;

  const contrastCounts = {
    total: contrastInventory.length,
    byComposition: Object.fromEntries(["desktop", "mobile"].map((value) => [value, contrastInventory.filter((row) => row.composition === value).length])),
    byCategory: Object.fromEntries([...new Set(contrastInventory.map((row) => row.category))].sort().map((value) => [value, contrastInventory.filter((row) => row.category === value).length])),
  };
  const contrast = { source: "computed production rendered styles", route: "/index.html", inventory: contrastInventory, counts: contrastCounts, failureCount: contrastInventory.filter((row) => !row.pass).length };

  await call("Page.reload", { ignoreCache: true });
  await wait(200);
  await waitFor(async () => evaluate("document.readyState === 'complete' && window.__productionJourney.registrations.length === 6 && window.__productionJourney.tools.has('get_goal_room_state')"), "fresh reload");
  const reset = await state();
  if (reset.currentStateVersion !== 0 || reset.phase !== "INTENT_DRAFT" || reset.ownerIntent !== null) throw new Error("Reload did not reset browser-local room");

  const evidence = {
    schemaVersion: 1,
    kind: "goal-room-real-production-journey",
    testedSource: { commit: "e3e13db45ac8c54959cad3ec702298ffb6a2883b", tree: "e578012de3dd82f7f08c037aaf902dfaec947952", note: "Reviewed production parent; Phase 3 harness/evidence is externally bound after commit." },
    route: { url: `${origin}/index.html`, entry: "/index.html", sourceEntry: "src/main.ts", localHttp: true, fixtureImports: [], bundleLeaks },
    browser: { executable: "redacted resolved task browser", version: browserVersion, isolatedDisposableProfile: true, headless: true },
    invocation: { class: "captured-registered-webmcp-descriptor-callbacks", browserNativeTestingApi: false, autonomousModelSelection: false, claim: "Production callback integration proof only; Phase 4 alone proves native browser getTools/executeTool." },
    tools: registration,
    checkpoints,
    negatives: { unknownKeyActorInjection: "INVALID_TOOL_INPUT/zero mutation", staleVersion: staleGoal.reasonCode, prematureClaim: earlyClaim.reasonCode, wrongPlan: wrongPlan.reasonCode, wrongStep: wrongStep.reasonCode, digestMismatch: badDigest.reasonCode, prematureCompletion: prematureCompletion.reasonCode, privilegedToolDescriptorsAbsent: !registration.some(({ name }) => /verify|accept/.test(name)), changedIdempotencyReuse: changedReuse.reasonCode, duplicateCandidateCallback: "prior result/no new receipt/no duplicate verifier", reporterFailure: { productionBrowserInjected: false, proofClass: "focused unit/source check; production composition has no safe reporter injection seam" }, hostileMaximum: hostileDom },
    modal: { binding: modal, escape, cancel, mutationCount: modalMutationCount },
    terminal: { ...terminal, currentActor: current.currentActor, nextLegalAction: current.nextLegalAction },
    compositions,
    accessibility: { zoom200, contrast },
    receipts,
    receiptSummary: { count: receipts.length, finalHash: receipts.at(-1).hash, actorCounts, ordered: true, hashLinked: true, appendOnly: true, replay: "validated by test:production-journey against replayGoalRoom" },
    finalState,
    reloadReset: { phase: reset.phase, stateVersion: reset.currentStateVersion, ownerIntent: reset.ownerIntent, disclosedAsBrowserLocalReset: true },
    screenshots,
    cleanup: { profilePath: "redacted disposable task profile; removed in finally", localPort: address.port },
  };
  await writeFile(join(output, "journey.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ passed: true, checkpoints: checkpoints.length, receipts: receipts.length, finalHash: receipts.at(-1).hash, screenshots: screenshots.length, browserVersion, invocationClass: evidence.invocation.class }, null, 2));
} finally {
  socket?.close(); chrome?.kill("SIGTERM");
  await new Promise((resolveClose) => server.close(resolveClose));
  await wait(150); if (chrome?.exitCode === null) chrome.kill("SIGKILL");
  for (let attempt = 0; attempt < 5; attempt += 1) { try { await rm(profile, { recursive: true, force: true }); break; } catch (error) { if (attempt === 4) throw error; await wait(100); } }
}
