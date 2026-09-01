import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { closeSync, readFileSync, readSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureSnapshot, createSnapshotTarStream, revalidateSnapshot } from "./snapshot.mjs";
import { createDockerCliIO, createDurableJournal, qualifyDocker, recoverJournal, runSnapshotChecks } from "./docker.mjs";
import { admitConnectedV3Envelope, admitConnectedV4Envelope, createCheckReceipt, createConnectedV3Envelope, createConnectedV4Envelope } from "./receipt.mjs";
import { verifyInstalledController } from "./install.mjs";
import { GITHUB_FAILURES, acquireGithubCredential, createClosedGithubHttpsAdapter, createFixtureGithubEngine, validateGithubStartup } from "./github.mjs";

const UI_HTML = readFileSync(new URL("./ui.html", import.meta.url), "utf8");
const UI_JS = readFileSync(new URL("./ui.js", import.meta.url), "utf8");
const UI_CSS = readFileSync(new URL("./ui.css", import.meta.url), "utf8");
const json = (response, status, value, headers = {}) => { response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; frame-ancestors 'none'", ...headers }); response.end(JSON.stringify(value)); };
const loopback = request => request.socket.localAddress === "127.0.0.1" && request.socket.remoteAddress === "127.0.0.1";
const emptyBody = request => new Promise((resolve, reject) => { let bytes = 0; request.on("data", chunk => { bytes += chunk.length; if (bytes > 0) reject(new Error("EMPTY_BODY_REQUIRED")); }); request.on("end", () => bytes === 0 ? resolve() : reject(new Error("EMPTY_BODY_REQUIRED"))); request.on("error", reject); });
const same = (left, right) => { if (typeof left !== "string" || typeof right !== "string") return false; const a = Buffer.from(left), b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); };
const securityHeaders = Object.freeze({ "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'", "referrer-policy": "no-referrer" });
const externalUnavailable=(local,reason)=>Object.freeze({schema:"agent-change-assurance/external-unavailable-v1",local,external:Object.freeze({availability:"UNAVAILABLE",subject:"UNKNOWN",lifecycle:"NOT_OBSERVED",outcome:"NOT_OBSERVED",reason,checkRuns:Object.freeze([]),statuses:Object.freeze([]),authority:"NONE"}),authority:"NONE"});

function createControllerServer(engine, createHttpServer = createServer) {
  const capability = randomBytes(32).toString("hex");
  let authority = "";
  let active = null;
  const authorized = request => {
    if (!loopback(request) || request.headers.host !== authority || request.headers["x-forwarded-host"] !== undefined || request.headers.forwarded !== undefined) return "AUTHORITY_REQUIRED";
    if (request.headers.origin !== `http://${authority}`) return "ORIGIN_REQUIRED";
    if (request.headers["content-type"] !== "application/json") return "JSON_REQUIRED";
    if (!same(request.headers["x-workhub-aca-session"], capability)) return "SESSION_REQUIRED";
    const site = request.headers["sec-fetch-site"], mode = request.headers["sec-fetch-mode"], destination = request.headers["sec-fetch-dest"];
    if ((site !== undefined && site !== "same-origin") || (mode !== undefined && mode !== "cors") || (destination !== undefined && destination !== "empty")) return "FETCH_METADATA_REQUIRED";
    return null;
  };
  const server = createHttpServer(async (request, response) => {
    if (!loopback(request)) { json(response, 403, { code: "LOOPBACK_REQUIRED" }); return; }
    if (request.headers.host !== authority || request.headers["x-forwarded-host"] !== undefined || request.headers.forwarded !== undefined) { json(response, 403, { code: "AUTHORITY_REQUIRED" }); return; }
    if (request.method === "GET" && request.url === "/") { response.writeHead(200, { ...securityHeaders, "content-type": "text/html; charset=utf-8" }); response.end(UI_HTML.replace("__ACA_SESSION__", capability)); return; }
    if (request.method === "GET" && request.url === "/ui.js") { response.writeHead(200, { ...securityHeaders, "content-type": "text/javascript; charset=utf-8" }); response.end(UI_JS); return; }
    if (request.method === "GET" && request.url === "/ui.css") { response.writeHead(200, { ...securityHeaders, "content-type": "text/css; charset=utf-8" }); response.end(UI_CSS); return; }
    if (request.method === "GET" && request.url === "/api/status") { json(response, 200, { schema: "agent-change-assurance/controller-capability-v1", available: true, authority: "NONE" }); return; }
    if (request.method === "OPTIONS") { json(response, 405, { code: "OPTIONS_REJECTED" }); return; }
    if (request.method !== "POST" || !["/api/observe", "/api/cancel"].includes(request.url)) { json(response, 404, { code: "NOT_FOUND" }); return; }
    const refusal = authorized(request);
    if (refusal) { json(response, refusal === "JSON_REQUIRED" ? 415 : 403, { code: refusal }); return; }
    try { await emptyBody(request); } catch { json(response, 400, { code: "EMPTY_BODY_REQUIRED" }); return; }
    if (request.url === "/api/cancel") {
      if (!active) { json(response, 409, { code: "NO_ACTIVE_GENERATION", authority: "NONE" }); return; }
      const target = active; target.abort.abort();
      try { await target.promise; } catch { /* the runner owns the terminal classification */ }
      json(response, 200, { state: "INDETERMINATE", reason: "CANCELLED", authority: "NONE" });
      return;
    }
    if (active || engine.isParked?.()) { json(response, 409, { code: "BUSY", authority: "NONE" }); return; }
    const abort = new AbortController();
    const generation = { abort, promise: null };
    const operation = Promise.resolve().then(() => engine.observe({ signal: abort.signal }));
    generation.promise = operation; active = generation;
    try { json(response, 200, await operation, { "x-workhub-aca-admission": engine.admissionHeader ?? "connected-v3-exact" }); }
    catch(error) { const code=abort.signal.aborted?"CANCELLED":GITHUB_FAILURES.includes(error?.code)?error.code:"CONTROLLER_FAILURE";json(response, 500, { code, authority: "NONE" }); }
    finally { if (active === generation) active = null; }
  });
  return Object.freeze({ server, setAuthority: value => { authority = value; } });
}

async function startControllerEngine(engine, { createHttpServer } = {}) {
  const controller = createControllerServer(engine, createHttpServer);
  await new Promise((resolve, reject) => { controller.server.once("error", reject); controller.server.listen(0, "127.0.0.1", resolve); });
  const address = controller.server.address();
  const port = address.port;
  const authority = `127.0.0.1:${port}`;
  controller.setAuthority(authority);
  let closed = false;
  return Object.freeze({ host: "127.0.0.1", port, authority, close: () => { if (closed) return Promise.resolve(); closed = true; return new Promise((resolve, reject) => controller.server.close(error => { engine.destroy?.(); error ? reject(error) : resolve(); })); } });
}

const CONFIG_KEYS = Object.freeze(["schema", "installRoot", "repositoryRoot", "displayName", "scratchParent", "journalPath", "parentCommit", "baseCommit", "baseTree", "allowedPaths", "requiredOverlayPaths", "excludedPrefixes", "lockfile", "docker", "verifierSpecDigest"]);
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/, DIGEST = /^[0-9a-f]{64}$/, IMAGE = /^sha256:[0-9a-f]{64}$/;
const ordinary = value => value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => ordinary(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const absolute = value => typeof value === "string" && value.startsWith("/") && !value.includes("\0");
function validateProductionConfig(config) {
  const keys=config?.github===undefined?CONFIG_KEYS:[...CONFIG_KEYS,"github"];
  if (!exact(config, keys) || config.schema !== "aca-production-controller-config/v1" || ![config.installRoot, config.repositoryRoot, config.scratchParent, config.journalPath].every(absolute)
    || typeof config.displayName !== "string" || !config.displayName || /[\\/\0-\x1f\x7f]/.test(config.displayName) || !SHA.test(config.parentCommit) || !SHA.test(config.baseCommit) || !SHA.test(config.baseTree) || !DIGEST.test(config.verifierSpecDigest)
    || !Array.isArray(config.allowedPaths) || !Array.isArray(config.requiredOverlayPaths) || !Array.isArray(config.excludedPrefixes) || !ordinary(config.lockfile) || !SHA.test(config.lockfile.blobId) || !Number.isSafeInteger(config.lockfile.bytes) || config.lockfile.bytes < 0 || !DIGEST.test(config.lockfile.digest)
    || !ordinary(config.docker) || !IMAGE.test(config.docker.imageId) || config.docker.policyVersion !== "aca-isolation-v1" || !ordinary(config.docker.expectedLabels) || config.docker.expectedLabels["aca.spec"] !== config.verifierSpecDigest) throw new Error("CONTROLLER_CONFIG_REFUSED");
  validateGithubStartup(config.github);
  return Object.freeze(structuredClone(config));
}

const readCredentialFd=async fd=>{const chunks=[],buffer=Buffer.alloc(4097);let offset=0;while(offset<buffer.length){const count=readSync(fd,buffer,offset,buffer.length-offset,null);if(!count)break;offset+=count}chunks.push(buffer.subarray(0,offset));return Buffer.concat(chunks)};
const DEFAULT_ADAPTERS = Object.freeze({ verifyInstalledController, createDurableJournal, createDockerCliIO, recoverJournal, qualifyDocker, captureSnapshot, revalidateSnapshot, createSnapshotTarStream, runSnapshotChecks, createCheckReceipt, createConnectedV3Envelope, admitConnectedV3Envelope,createConnectedV4Envelope,admitConnectedV4Envelope,acquireGithubCredential,createGithubTransport:createClosedGithubHttpsAdapter,createGithubEngine:createFixtureGithubEngine,readCredentialFd,closeCredentialFd:async fd=>closeSync(fd) });
const emptyOutput = () => Object.freeze({ sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", observedBytes: 0, preview: "", truncated: false, limitExceeded: false });
const commandIds = Object.freeze({ unit: ["unit-vitest"], build: ["build-typescript", "build-vite"] });
const sameQualification = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const classifyTerminalReason = (value, aborted = false) => {
  if (aborted) return "CANCELLED"; const text = String(value ?? "DOCKER_FAILURE");
  if (text.includes("CLEANUP_UNRESOLVED")) return "CLEANUP_UNRESOLVED";
  for (const reason of ["TIMEOUT", "CANCELLED", "OUTPUT_LIMIT", "RUNNER_INFRASTRUCTURE", "SOURCE_MOVED", "IMAGE_POLICY_MISMATCH"]) if (text === reason || text.startsWith(`${reason} `)) return reason;
  return "DOCKER_FAILURE";
};

async function createProductionEngine(config, suppliedAdapters = {}) {
  const adapters = { ...DEFAULT_ADAPTERS, ...suppliedAdapters };
  await adapters.verifyInstalledController(config.installRoot);
  let githubEngine=null,githubTransport=null,token=null;
  if(config.github){
    if(config.github.permissionAttestation!=="READ_ONLY_DECLARED")throw new Error("CREDENTIAL_SCOPE_UNQUALIFIED");
    token=await adapters.acquireGithubCredential(config.github,{readFd:adapters.readCredentialFd,closeFd:adapters.closeCredentialFd});
    try{githubTransport=adapters.createGithubTransport(config.github,token);githubEngine=adapters.createGithubEngine(config.github,{request:(coordinate,options)=>githubTransport.request(coordinate,options),revalidateLocal:async(local,options)=>{if(options?.signal?.aborted)throw new Error("CANCELLED");const fresh=await adapters.captureSnapshot({root:config.repositoryRoot,scratchParent:config.scratchParent,parentCommit:config.parentCommit,baseCommit:config.baseCommit,baseTree:config.baseTree,allowedPaths:config.allowedPaths,requiredOverlayPaths:config.requiredOverlayPaths,excludedPrefixes:config.excludedPrefixes});try{if(fresh.snapshotDigest!==local.snapshotDigest)throw new Error("LOCAL_SOURCE_MOVED")}finally{await fresh.cleanup()}}})}catch(error){githubTransport?.destroy?.();token?.fill?.(0);throw error}
  }
  try {
  const journal = await adapters.createDurableJournal(config.journalPath);
  const dockerConfig = Object.freeze({ ...config.docker, controllerNonce: randomBytes(16).toString("hex"), journal });
  const io = adapters.createDockerCliIO(dockerConfig);
  const recovery = await adapters.recoverJournal(journal.records(), io);
  if (recovery.unresolved.length) throw new Error("RECOVERY_UNRESOLVED");
  const startupQualification = await adapters.qualifyDocker(dockerConfig, io);
  const operationIo = {
    ...io,
    async requalify() {
      const fresh = await adapters.qualifyDocker(dockerConfig, io);
      if (!sameQualification(startupQualification, fresh)) throw new Error("IMAGE_POLICY_MISMATCH");
      return fresh;
    },
  };
  const observe = async ({ signal }) => {
    const attemptId = `aca-${randomBytes(16).toString("hex")}`, startedAt = new Date().toISOString(); let shot; let settled; let terminalReason = null; let cleanupConfirmed = false;
    try {
      shot = await adapters.captureSnapshot({ root: config.repositoryRoot, scratchParent: config.scratchParent, parentCommit: config.parentCommit, baseCommit: config.baseCommit, baseTree: config.baseTree, allowedPaths: config.allowedPaths, requiredOverlayPaths: config.requiredOverlayPaths, excludedPrefixes: config.excludedPrefixes });
      const runIo = { ...operationIo, async revalidateSource() { await adapters.revalidateSnapshot(config.repositoryRoot, shot); }, async removeScratch() {} };
      settled = await adapters.runSnapshotChecks(dockerConfig, { attemptId, creationNonce: randomBytes(16).toString("hex"), creationNonces: { unit: randomBytes(16).toString("hex"), build: randomBytes(16).toString("hex") }, snapshotDigest: shot.snapshotDigest, innerDigest: shot.sealed.sha256, outerDigest: shot.sealed.outerDigest, outerBytes: shot.sealed.outerBytes, tarStream: () => adapters.createSnapshotTarStream(shot.sealed), signal }, runIo);
      await adapters.revalidateSnapshot(config.repositoryRoot, shot);
      if (settled.state !== "SETTLED") terminalReason = classifyTerminalReason(settled.reason);
    } catch (error) {
      terminalReason = classifyTerminalReason(error?.message, signal?.aborted);
    }
    try { await shot?.cleanup(); cleanupConfirmed = true; } catch { terminalReason = "CLEANUP_UNRESOLVED"; }
    if (!shot) throw new Error(terminalReason ?? "SNAPSHOT_CAPTURE_FAILED");
    const finishedAt = new Date().toISOString(); const results = new Map((settled?.results ?? []).map(result => [result.checkId, result]));
    const receipts = ["unit", "build"].map(checkId => {
      const completed = results.get(checkId);
      const outcome = completed ?? (terminalReason
        ? { state: "INDETERMINATE", reason: terminalReason, execution: ["TIMEOUT", "OUTPUT_LIMIT", "RUNNER_INFRASTRUCTURE"].includes(terminalReason) ? "RUN" : "NOT_RUN" }
        : { state: "INDETERMINATE", reason: "DOCKER_FAILURE", execution: "NOT_RUN" });
      const commands = commandIds[checkId].map((commandId, index) => {
        const command = outcome.commands?.[index]; const stdout = command?.stdout ?? outcome.stdout ?? emptyOutput(), stderr = command?.stderr ?? outcome.stderr ?? emptyOutput();
        return { commandId, exitCode: command?.exitCode ?? (outcome.execution === "RUN" ? outcome.exitCode ?? (outcome.state === "PASS" ? 0 : outcome.state === "FAIL" ? 1 : null) : null), signal: command?.signal ?? outcome.signal ?? null, timeout: outcome.reason === "TIMEOUT", outputLimit: outcome.reason === "OUTPUT_LIMIT", stdout, stderr };
      });
      return adapters.createCheckReceipt({ attemptId, checkId, snapshotDigest: shot.snapshotDigest, parentCommit: shot.parentCommit, parentTree: shot.parentTree, baseCommit: shot.baseCommit, baseTree: shot.baseTree, manifestDigest: shot.manifestDigest, contentManifestDigest: shot.contentManifestDigest, diffDigest: shot.diff.diffDigest, lockfile: config.lockfile, imageId: startupQualification.imageId, imageLabels: { contract: "aca-sandbox/v1", spec: config.verifierSpecDigest }, verifierSpecDigest: config.verifierSpecDigest, policyVersion: startupQualification.policyVersion, startedAt, finishedAt, state: outcome.state, reason: outcome.reason, execution: outcome.execution, commands, cleanup: outcome.reason === "CLEANUP_UNRESOLVED" || !cleanupConfirmed ? "UNRESOLVED" : "CONFIRMED" });
    });
    const repository = { displayName: config.displayName, snapshotDigest: shot.snapshotDigest, parentCommit: shot.parentCommit, parentTree: shot.parentTree, baseCommit: shot.baseCommit, baseTree: shot.baseTree, manifestDigest: shot.manifestDigest, contentManifestDigest: shot.contentManifestDigest, diffDigest: shot.diff.diffDigest, diffRows: shot.diff.rows, changedPaths: shot.diff.changedPaths, additions: shot.diff.additions, deletions: shot.diff.deletions };
    const qualification = { status: "QUALIFIED", policyVersion: startupQualification.policyVersion, imageId: startupQualification.imageId, verifierSpecDigest: config.verifierSpecDigest };
    const envelope = adapters.createConnectedV3Envelope({ repository, qualification, receipts });
    const admission = adapters.admitConnectedV3Envelope(envelope, { repository, qualification, lockfile: config.lockfile }); if (!admission.valid) throw new Error("CONTROLLER_ENVELOPE_REFUSED");
    if(!githubEngine)return admission.envelope;
    let external;try{external=await githubEngine.observe({local:{snapshotDigest:repository.snapshotDigest,parentCommit:repository.parentCommit,baseCommit:repository.baseCommit,trackedState:"DIRTY"},signal})}catch(error){if(signal?.aborted)throw Object.assign(new Error("CANCELLED"),{code:"CANCELLED"});if(error?.code==="LOCAL_SOURCE_MOVED"||error?.code==="CANCELLED")throw error;if(GITHUB_FAILURES.includes(error?.code))return externalUnavailable(admission.envelope,error.code);throw error}
    if(signal?.aborted)throw Object.assign(new Error("CANCELLED"),{code:"CANCELLED"});
    const github=githubEngine.trustedTuple(external),v4=adapters.createConnectedV4Envelope({local:admission.envelope,external,github}),v4Admission=adapters.admitConnectedV4Envelope(v4,github);if(!v4Admission.valid)throw new Error("CONTROLLER_ENVELOPE_REFUSED");return v4Admission.envelope;
  };
  return Object.freeze({ observe, admissionHeader:githubEngine?"connected-v4-exact":"connected-v3-exact", isParked: () => Boolean(operationIo.isParked?.()),destroy:()=>{githubTransport?.destroy?.();token?.fill?.(0)} });
  } catch (error) {
    githubTransport?.destroy?.(); token?.fill?.(0); throw error;
  }
}

export async function startProductionController(rawConfig, adapters = {}) {
  const config = validateProductionConfig(rawConfig); let engine;
  try { engine = await createProductionEngine(config, adapters); return await startControllerEngine(engine, { createHttpServer: adapters.createHttpServer }); }
  catch (error) { engine?.destroy?.(); throw error; }
}

export async function startFixtureQualificationController({ localEngine, githubEngine, compose }) {
  if (!localEngine || !githubEngine || typeof localEngine.observe !== "function" || typeof githubEngine.observe !== "function" || typeof compose !== "function") throw new Error("FIXTURE_CONFIG_REFUSED");
  const engine = Object.freeze({
    admissionHeader: "connected-v4-exact",
    async observe({ signal }) {
      const local = await localEngine.observe({ signal });
      if (signal.aborted) throw Object.assign(new Error("CANCELLED"), { code: "CANCELLED" });
      let external;try{external=await githubEngine.observe({ local: local.repository, signal })}catch(error){if(signal.aborted)throw Object.assign(new Error("CANCELLED"),{code:"CANCELLED"});if(error?.code==="LOCAL_SOURCE_MOVED"||error?.code==="CANCELLED")throw error;if(GITHUB_FAILURES.includes(error?.code))return externalUnavailable(local,error.code);throw error}
      if (signal.aborted) throw Object.assign(new Error("CANCELLED"), { code: "CANCELLED" });
      return compose(local, external);
    },
  });
  return startControllerEngine(engine);
}

async function startInstalledEntrypoint() {
  const installRoot = dirname(fileURLToPath(import.meta.url)); const configPath = process.argv[2] ?? join(installRoot, "controller-config.json");
  if (configPath !== join(installRoot, "controller-config.json")) throw new Error("CONTROLLER_CONFIG_REFUSED");
  const config = JSON.parse(await readFile(configPath, "utf8")); if (config.installRoot !== installRoot) throw new Error("CONTROLLER_CONFIG_REFUSED"); process.chdir(installRoot);
  const service = await startProductionController(config); process.stdout.write(`${JSON.stringify({ schema: "aca-controller-started/v1", authority: service.authority, ownerAuthority: "NONE" })}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) startInstalledEntrypoint().catch(error => { const reason=/^[A-Z][A-Z0-9_]{1,63}$/.test(error?.code??"")?error.code:/^[A-Z][A-Z0-9_]{1,63}$/.test(error?.message??"")?error.message:"CONTROLLER_START_FAILED";process.stderr.write(`${reason}\n`); process.exitCode = 1; });
