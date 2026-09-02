import { realpathSync } from "node:fs";
import { collectConnectedAssurance } from "./agent-change-assurance-connected.mjs";

const ROUTE = "/__agent-change-assurance";
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const KNOWN_CODES = new Set(["BASE_UNRESOLVED", "BASE_NOT_ANCESTOR", "EMPTY_CHANGE", "SOURCE_MOVED", "HEAD_UNRESOLVED", "GIT_OBSERVATION_TIMEOUT", "REPOSITORY_ROOT_MISMATCH", "TREE_MODE_UNSUPPORTED", "TREE_PATH_INVALID_UTF8", "TREE_PATH_NONCANONICAL", "TREE_PATH_DUPLICATE", "TREE_PATH_COLLISION", "TREE_PATH_LIMIT", "TREE_FILE_COUNT_LIMIT", "TREE_FILE_SIZE_LIMIT", "TREE_AGGREGATE_SIZE_LIMIT", "DIFF_INVALID_UTF8", "TRACKED_PATH_INVALID_UTF8", "UNTRACKED_PATH_INVALID_UTF8"]);
export const isLoopbackAddress = (value) => value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1";
export const isLoopbackRequest = (request) => isLoopbackAddress(request?.socket?.localAddress) && isLoopbackAddress(request?.socket?.remoteAddress);
const send = (response, status, body) => {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.end(JSON.stringify(body));
};
const readEmptyBody = (request, limit = 1) => new Promise((resolve, reject) => {
  let size = 0;
  request.on("data", (chunk) => { size += chunk.length; if (size >= limit) reject(new Error("EMPTY_BODY_REQUIRED")); });
  request.on("end", () => size === 0 ? resolve() : reject(new Error("EMPTY_BODY_REQUIRED")));
  request.on("error", reject);
});
const requestOrigin = (request) => `${request.socket.encrypted ? "https" : "http"}://${request.headers.host ?? ""}`;
const errorCode = (error) => {
  const code = String(error?.message ?? "").split(/\s|:/, 1)[0];
  return KNOWN_CODES.has(code) ? code : "OBSERVATION_FAILED";
};

export function createAgentChangeAssurancePlugin(options = {}) {
  const repositoryRoot = realpathSync(options.repositoryRoot ?? process.cwd());
  const baseCommit = SHA.test(options.baseCommit ?? "") ? options.baseCommit : null;
  const collect = options.collect ?? collectConnectedAssurance;
  let active = null;
  const install = (server) => {
    server.middlewares.use(ROUTE, async (request, response) => {
      if (!isLoopbackRequest(request)) { send(response, 403, { code: "LOOPBACK_REQUIRED" }); return; }
      if (request.method === "GET") {
        send(response, 200, { schema: "agent-change-assurance/capability-v2", available: true, authority: "NONE", explicitBaseConfigured: baseCommit !== null }); return;
      }
      if (request.method !== "POST") { response.setHeader("allow", "GET, POST"); send(response, 405, { code: "METHOD_NOT_ALLOWED" }); return; }
      if (request.headers.origin !== requestOrigin(request)) { send(response, 403, { code: "SAME_ORIGIN_REQUIRED" }); return; }
      if (request.headers["x-workhub-local-verifier"] !== "observe-v2") { send(response, 403, { code: "VERIFIER_HEADER_REQUIRED" }); return; }
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")) { send(response, 415, { code: "JSON_REQUIRED" }); return; }
      if (active) { send(response, 409, { code: "BUSY" }); return; }
      try { await readEmptyBody(request); } catch { send(response, 400, { code: "EMPTY_BODY_REQUIRED" }); return; }
      if (!baseCommit) { send(response, 422, { code: "BASE_UNRESOLVED", authority: "NONE" }); return; }
      const controller = new AbortController(); active = controller;
      const cancel = () => controller.abort(); response.once("close", cancel);
      try {
        const result = await collect(repositoryRoot, baseCommit, {}, { signal: controller.signal });
        response.off("close", cancel);
        if (!response.destroyed) send(response, 200, result);
      } catch (error) {
        response.off("close", cancel);
        if (!response.destroyed) send(response, 422, { code: controller.signal.aborted ? "OBSERVATION_CANCELLED" : errorCode(error), authority: "NONE" });
      } finally { if (active === controller) active = null; }
    });
    const cancelActive = () => active?.abort();
    server.httpServer?.once("close", cancelActive);
    return () => { server.httpServer?.off("close", cancelActive); cancelActive(); };
  };
  return { name: "agent-change-assurance-connected", apply: "serve", configureServer: install };
}
