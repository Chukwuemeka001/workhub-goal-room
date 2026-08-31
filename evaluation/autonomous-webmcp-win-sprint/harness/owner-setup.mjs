#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function args(values) {
  const out = {};
  for (let i = 0; i < values.length; i += 2) out[values[i].replace(/^--/, "")] = values[i + 1];
  return out;
}
const input = args(process.argv.slice(2));
const cdpPort = Number(input["cdp-port"]);
const pageUrl = new URL(input["page-url"]).toString();
const intent = input.intent;
const output = resolve(input.output);
if (!Number.isInteger(cdpPort) || !intent || !output) throw new Error("INVALID_OWNER_SETUP_ARGUMENTS");
const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
const target = targets.find((row) => row.type === "page" && new URL(row.url).toString() === pageUrl);
if (!target) throw new Error("EXACT_PAGE_TARGET_NOT_FOUND");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolveOpen, reject) => { socket.addEventListener("open", resolveOpen, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let id = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const row = pending.get(message.id); pending.delete(message.id); clearTimeout(row.timer);
  if (message.error) row.reject(new Error(message.error.message)); else row.resolve(message.result);
});
const call = (method, params = {}) => new Promise((resolveCall, reject) => {
  const requestId = ++id;
  const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP_TIMEOUT:${method}`)); }, 30_000);
  pending.set(requestId, { resolve: resolveCall, reject, timer });
  socket.send(JSON.stringify({ id: requestId, method, params }));
});
const evaluate = async (expression) => {
  const response = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  return response.result.value;
};
try {
  await call("Runtime.enable");
  const read = () => evaluate(`(()=>{const phase=document.querySelector('.desktop-state-phase')?.textContent??'';const m=phase.match(/STATE v(\\d+) · (.+)/);return{phaseText:phase,stateVersion:m?Number(m[1]):-1,frontier:document.querySelector('#desktop-now-heading')?.textContent??'',inputValue:document.querySelector('#desktop-owner-intent')?.value??null};})()`);
  const before = await read();
  if (before.stateVersion !== 0) throw new Error(`OWNER_SETUP_REQUIRES_V0:${before.stateVersion}`);
  const inputBox = await evaluate(`(()=>{const e=document.querySelector('#desktop-owner-intent');if(!e)throw new Error('OWNER_INPUT_MISSING');const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x: inputBox.x, y: inputBox.y, button: "left", clickCount: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: inputBox.x, y: inputBox.y, button: "left", clickCount: 1 });
  await call("Input.insertText", { text: intent });
  const buttonBox = await evaluate(`(()=>{const e=document.querySelector('.desktop-intent-form button[type=submit]');if(!e)throw new Error('OWNER_SUBMIT_MISSING');const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x: buttonBox.x, y: buttonBox.y, button: "left", clickCount: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: buttonBox.x, y: buttonBox.y, button: "left", clickCount: 1 });
  let after;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    after = await read();
    if (after.stateVersion === 1) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  if (after.stateVersion !== 1) throw new Error(`OWNER_SETUP_FAILED:${after.stateVersion}`);
  const receipt = {
    schemaVersion: 1,
    kind: "workhub-owner-intent-setup",
    mechanism: "trusted CDP Input mouse and insertText outside the model evaluation client",
    pageUrl,
    intent,
    intentSha256: createHash("sha256").update(intent).digest("hex"),
    before,
    after,
    recordedAt: new Date().toISOString(),
  };
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.tmp-${process.pid}`;
  await writeFile(temporary, bytes, { mode: 0o600 });
  await rename(temporary, output);
  console.log(JSON.stringify({ output, sha256: createHash("sha256").update(bytes).digest("hex"), before: before.stateVersion, after: after.stateVersion, frontier: after.frontier }));
} finally {
  socket.close();
}
