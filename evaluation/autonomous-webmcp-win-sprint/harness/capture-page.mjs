#!/usr/bin/env node
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
const values = Object.fromEntries(process.argv.slice(2).reduce((rows, value, index, all) => index % 2 === 0 ? [...rows, [value.replace(/^--/, ""), all[index + 1]]] : rows, []));
const targets = await (await fetch(`http://127.0.0.1:${Number(values["cdp-port"])}/json`)).json();
const wanted = new URL(values["page-url"]).toString();
const target = targets.find((row) => row.type === "page" && new URL(row.url).toString() === wanted);
if (!target) throw new Error("EXACT_PAGE_TARGET_NOT_FOUND");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let id = 0;
const pending = new Map();
socket.addEventListener("message", (event) => { const message = JSON.parse(event.data); if (!pending.has(message.id)) return; const row = pending.get(message.id); pending.delete(message.id); message.error ? row.reject(new Error(message.error.message)) : row.resolve(message.result); });
const call = (method, params = {}) => new Promise((resolve, reject) => { const requestId = ++id; pending.set(requestId, { resolve, reject }); socket.send(JSON.stringify({ id: requestId, method, params })); });
try {
  await call("Page.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 });
  await call("Runtime.evaluate", { expression: "scrollTo(0,0)" });
  const shot = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
  const bytes = Buffer.from(shot.data, "base64");
  await writeFile(values.output, bytes);
  console.log(JSON.stringify({ output: values.output, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }));
} finally { socket.close(); }
