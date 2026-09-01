import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createAgentChangeAssurancePlugin, isLoopbackAddress, isLoopbackRequest } from "./agent-change-assurance-vite-plugin.mjs";

const BASE_SHA = "a".repeat(40);
const start = async (collect, options = {}) => {
  let middleware;
  const baseCommit = Object.hasOwn(options, "baseCommit") ? options.baseCommit : BASE_SHA;
  const plugin = createAgentChangeAssurancePlugin({ repositoryRoot: process.cwd(), baseCommit, collect });
  const httpServer = http.createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end("html fallback"); }));
  const cleanup = plugin.configureServer({ middlewares: { use: (path, fn) => { assert.equal(path, "/__agent-change-assurance"); middleware = fn; } }, httpServer });
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${httpServer.address().port}`;
  return { url: `${origin}/__agent-change-assurance`, origin, close: () => { cleanup?.(); return new Promise((resolve) => httpServer.close(resolve)); } };
};
const post = (server, overrides = {}) => fetch(server.url, {
  method: "POST",
  headers: { origin: server.origin, "content-type": "application/json", "x-workhub-local-verifier": "observe-v2", ...(overrides.headers ?? {}) },
  body: Object.hasOwn(overrides, "body") ? overrides.body : "",
});

test("GET is capability-only and never invokes observation", async (t) => {
  let calls = 0; const server = await start(async () => { calls++; return {}; }); t.after(server.close);
  const response = await fetch(server.url);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { schema: "agent-change-assurance/capability-v2", available: true, authority: "NONE", explicitBaseConfigured: true });
  assert.equal(calls, 0);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("POST requires exact same origin, custom header, JSON type, and an empty body", async (t) => {
  let received; const server = await start(async (_root, base, request) => { received = { base, request }; return { schema: "agent-change-assurance/connected-v2" }; }); t.after(server.close);
  const ok = await post(server); assert.equal(ok.status, 200); assert.deepEqual(received, { base: BASE_SHA, request: {} });
  for (const [name, response] of [
    ["origin", await post(server, { headers: { origin: "https://attacker.invalid" } })],
    ["header", await post(server, { headers: { "x-workhub-local-verifier": "" } })],
    ["content", await post(server, { headers: { "content-type": "text/plain" } })],
    ["body", await post(server, { body: "{}" })],
  ]) { assert.notEqual(response.status, 200, name); }
  const method = await fetch(server.url, { method: "PUT" }); assert.equal(method.status, 405);
});

test("request capability attempts are rejected because any nonempty body is forbidden", async (t) => {
  let calls = 0; const server = await start(async () => { calls++; return {}; }); t.after(server.close);
  for (const key of ["candidate", "base", "ref", "claims", "root", "path", "check", "command", "argv", "env", "timeout", "output", "scratch"]) {
    const response = await post(server, { body: JSON.stringify({ [key]: "x" }) });
    assert.equal(response.status, 400, key); assert.equal((await response.json()).code, "EMPTY_BODY_REQUIRED");
  }
  assert.equal(calls, 0);
});

test("one active run returns deterministic BUSY and close cancels it", async () => {
  let release; let aborted = false;
  const server = await start(async (_root, _base, _request, options) => new Promise((resolve) => {
    release = resolve; options.signal.addEventListener("abort", () => { aborted = true; resolve({ cancelled: true }); });
  }));
  const first = post(server); await new Promise((resolve) => setTimeout(resolve, 20));
  const second = await post(server); assert.equal(second.status, 409); assert.equal((await second.json()).code, "BUSY");
  await server.close(); assert.equal(aborted, true); release?.({}); await first;
});

test("known fail-closed codes are preserved while errors remain sanitized", async (t) => {
  for (const code of ["BASE_UNRESOLVED", "BASE_NOT_ANCESTOR", "EMPTY_CHANGE", "SOURCE_MOVED"]) {
    const server = await start(async () => { throw new Error(`${code} /Users/private secret`); }); t.after(server.close);
    const response = await post(server); const body = await response.text();
    assert.equal(response.status, 422); assert.match(body, new RegExp(code)); assert.doesNotMatch(body, /Users|private|secret/);
  }
});

test("missing startup base is visible and cannot route", async (t) => {
  const server = await start(async () => ({}), { baseCommit: null }); t.after(server.close);
  const capability = await fetch(server.url); assert.equal((await capability.json()).explicitBaseConfigured, false);
  const response = await post(server); assert.equal(response.status, 422); assert.equal((await response.json()).code, "BASE_UNRESOLVED");
});

test("loopback gate recognizes only loopback addresses", () => {
  for (const value of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) assert.equal(isLoopbackAddress(value), true);
  for (const value of ["0.0.0.0", "192.168.1.2", "8.8.8.8", undefined]) assert.equal(isLoopbackAddress(value), false);
});

test("capability and observation routes both require loopback socket pairs", () => {
  assert.equal(isLoopbackRequest({ socket: { localAddress: "127.0.0.1", remoteAddress: "::1" } }), true);
  assert.equal(isLoopbackRequest({ socket: { localAddress: "127.0.0.1", remoteAddress: "192.168.1.2" } }), false);
  assert.equal(isLoopbackRequest({ socket: { localAddress: "192.168.1.2", remoteAddress: "127.0.0.1" } }), false);
});
