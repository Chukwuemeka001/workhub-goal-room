import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createOutputCollector } from "./output.mjs";

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const RUNNER_ENTRYPOINT = ["/usr/local/bin/node", "/verifier/runner.mjs"];
const CLI_EXIT_DEADLINE_MS = 250;
const fail = code => { throw new Error(code); };
const requireActive = signal => { if (signal?.aborted) fail("CANCELLED"); };
const UNRESOLVED_CLI_KEYS = Object.freeze(["attemptId", "checkId", "containerId", "creationNonce", "kind", "reason", "recordedAt"]);
const safeId = value => typeof value === "string" && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value);
const validUnresolvedCli = record => record?.kind === "unresolved_cli"
  && JSON.stringify(Object.keys(record).sort()) === JSON.stringify([...UNRESOLVED_CLI_KEYS].sort())
  && [record.attemptId, record.checkId, record.creationNonce, record.containerId].every(safeId)
  && record.reason === "CLI_EXTINCTION_UNPROVEN"
  && typeof record.recordedAt === "string" && Number.isFinite(Date.parse(record.recordedAt));
const validJournalRecord = record => validUnresolvedCli(record)
  || Boolean(record && typeof record === "object" && ["container", "image"].includes(record.resource) && typeof record.attemptId === "string" && record.labels && typeof record.labels === "object");

export async function createDurableJournal(path) {
  if (typeof path !== "string" || !path.startsWith("/")) fail("JOURNAL_PATH_REFUSED");
  let state = { schema: "aca-controller-journal/v1", records: [] };
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (!parsed || parsed.schema !== state.schema || !Array.isArray(parsed.records) || parsed.records.some(record => !validJournalRecord(record))) fail("JOURNAL_REFUSED");
    state = parsed;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const persist = async next => {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await writeFile(temporary, `${JSON.stringify(next)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  };
  const identity = record => record.kind === "unresolved_cli"
    ? `unresolved_cli:${record.attemptId}:${record.checkId}:${record.creationNonce}:${record.containerId}`
    : record.creationNonce
    ? `${record.resource}:${record.attemptId}:${record.role}:${record.creationNonce}`
    : record.resource === "image" ? `image:${record.imageId}` : `container:${record.containerId}`;
  const insert = async record => {
    if (!validJournalRecord(record)) fail("JOURNAL_RECORD_REFUSED");
    const key = identity(record); if (state.records.some(existing => identity(existing) === key)) fail("JOURNAL_RECORD_MISMATCH");
    const next = { ...state, records: [...state.records, structuredClone(record)] }; await persist(next); state = next;
  };
  return Object.freeze({
    records: () => structuredClone(state.records),
    record: insert,
    reserve: insert,
    update: async (record, replacement) => {
      if (!validJournalRecord(replacement)) fail("JOURNAL_RECORD_REFUSED");
      const key = identity(record), index = state.records.findIndex(existing => identity(existing) === key && JSON.stringify(existing) === JSON.stringify(record));
      if (index < 0 || identity(replacement) !== key) fail("JOURNAL_RECORD_MISMATCH");
      const records = [...state.records]; records[index] = structuredClone(replacement); const next = { ...state, records }; await persist(next); state = next;
    },
    settle: async record => {
      const key = identity(record), index = state.records.findIndex(existing => identity(existing) === key && JSON.stringify(existing) === JSON.stringify(record));
      if (index < 0) fail("JOURNAL_RECORD_MISMATCH");
      const next = { ...state, records: state.records.filter((_, candidate) => candidate !== index) }; await persist(next); state = next;
    },
  });
}

const executionImage = (config, run) => run.imageId ?? config.imageId;
const expectedOwned = (config, run) => run.ownedLabels ?? {
  ...(run.imageLabels ?? config.expectedLabels ?? {}),
  "aca.attempt": run.attemptId,
  "aca.check": run.checkId,
  "aca.controller": config.controllerNonce,
  "aca.creation": run.creationNonce,
  "aca.image": executionImage(config, run),
  "aca.role": "check",
};
const stageLabels = (config, stage) => ({
  "aca.attempt": stage.attemptId,
  "aca.base": config.imageId,
  "aca.controller": config.controllerNonce,
  "aca.creation": stage.creationNonce,
  "aca.inner": stage.innerDigest,
  "aca.outer": stage.outerDigest,
  "aca.role": "snapshot-stage",
  "aca.snapshot": stage.snapshotDigest,
});
const imageLabels = (config, stage) => ({
  "aca.attempt": stage.attemptId,
  "aca.base": config.imageId,
  "aca.contract": "aca-snapshot-image/v1",
  "aca.controller": config.controllerNonce,
  "aca.creation": stage.creationNonce,
  "aca.inner": stage.innerDigest,
  "aca.outer": stage.outerDigest,
  "aca.policy": config.policyVersion,
  "aca.role": "snapshot-image",
  "aca.snapshot": stage.snapshotDigest,
});
const exactLabels = (actual, expected) => {
  if (!actual || !expected || typeof actual !== "object" || typeof expected !== "object") return false;
  const actualKeys = Object.keys(actual).sort(), expectedKeys = Object.keys(expected).sort();
  return JSON.stringify(actualKeys) === JSON.stringify(expectedKeys) && expectedKeys.every(key => actual[key] === expected[key]);
};
const validStage = (config, stage) => SHA256.test(config.imageId) && [stage.snapshotDigest, stage.innerDigest, stage.outerDigest].every(value => DIGEST.test(value)) && typeof stage.attemptId === "string" && typeof stage.creationNonce === "string";

export function buildStageCreateArgs(config, stage) {
  if (!validStage(config, stage)) fail("DOCKER_CONFIG_REFUSED");
  const labels = stageLabels(config, stage);
  return [
    "create", "--pull", "never", "--network", "none",
    ...Object.entries(labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]),
    config.imageId,
  ];
}

export function buildRemoveImageArgs(id) {
  if (!SHA256.test(id)) fail("INTERMEDIATE_IMAGE_MISMATCH");
  return ["image", "rm", "--no-prune", id];
}

export function buildCreateArgs(config, run) {
  const imageId = executionImage(config, run);
  if (!SHA256.test(imageId) || !["unit", "build"].includes(run.checkId)) fail("DOCKER_CONFIG_REFUSED");
  const labels = expectedOwned(config, { ...run, imageId });
  return [
    "create", "--pull", "never", "--network", "none", "--read-only",
    "--user", "65532:65532", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--pids-limit", "128", "--memory", "1073741824", "--memory-swap", "1073741824", "--cpus", "2",
    "--mount", "type=tmpfs,destination=/work,tmpfs-size=402653184,tmpfs-mode=1777",
    "--mount", "type=tmpfs,destination=/output,tmpfs-size=33554432,tmpfs-mode=1777",
    "--mount", "type=tmpfs,destination=/tmp,tmpfs-size=67108864,tmpfs-mode=1777",
    "--env", "HOME=/nonexistent", "--env", "PATH=/usr/local/bin:/usr/bin:/bin", "--env", "CI=1",
    "--env", "LANG=C.UTF-8", "--env", "LC_ALL=C.UTF-8", "--env", `ACA_CHECK_ID=${run.checkId}`,
    ...Object.entries(labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]),
    imageId, ...RUNNER_ENTRYPOINT,
  ];
}

export async function qualifyDocker(config, io) {
  if (typeof config?.dockerCli !== "string" || !config.dockerCli.startsWith("/") || typeof config.dockerConfig !== "string" || !config.dockerConfig.startsWith("/") || !SHA256.test(config.imageId) || typeof config.dockerHost !== "string" || !config.dockerHost.startsWith("unix:///")) fail("DOCKER_CONFIG_REFUSED");
  const socket = config.dockerHost.slice(7);
  if (socket !== config.authorizedSocket || await io.realpath(socket) !== socket) fail("DOCKER_SOCKET_MOVED");
  const daemon = await io.inspectEndpoint();
  if (daemon.os !== "linux" || daemon.arch !== "arm64" || daemon.cgroupVersion !== "2" || !daemon.daemonId || !Array.isArray(daemon.securityOptions) || !daemon.securityOptions.some(value => value.includes("seccomp")) || !daemon.securityOptions.some(value => value.includes("apparmor")) || !daemon.securityOptions.some(value => value.includes("cgroupns"))) fail("DAEMON_POLICY_MISMATCH");
  const image = await io.inspectImage(config.imageId);
  if (image.id !== config.imageId || image.os !== "linux" || image.architecture !== "arm64") fail("IMAGE_ID_MISMATCH");
  if (!exactLabels(image.labels, config.expectedLabels ?? {})) fail("IMAGE_LABEL_MISMATCH");
  return Object.freeze({ qualified: true, policyVersion: config.policyVersion, imageId: config.imageId, labels: Object.freeze({ ...image.labels }), daemon: Object.freeze({ ...daemon }) });
}

export async function stageSnapshotImage(config, stage, io) {
  const labels = { ...(config.expectedLabels ?? {}), ...stageLabels(config, stage) };
  const committedLabels = { ...labels, ...imageLabels(config, stage) };
  let id = null;
  let owned = false;
  let primaryError = null;
  let result = null;
  let stageRecord = null;
  let stageIntent = null;
  let imageRecord = null;
  let imageIntent = null;
  try {
    requireActive(stage.signal);
    await io.requalify?.("snapshot-stage");
    requireActive(stage.signal);
    stageIntent = { resource: "container", role: "snapshot-stage", phase: "CREATE_INTENT", containerId: null, attemptId: stage.attemptId, creationNonce: stage.creationNonce, labels };
    if (io.reserve) await io.reserve(stageIntent);
    requireActive(stage.signal);
    id = await io.create(buildStageCreateArgs(config, stage));
    if (typeof id !== "string" || !id) fail("CREATE_FAILED");
    await io.afterCreate?.("snapshot-stage", id, stageIntent);
    stageRecord = { ...stageIntent, phase: "CREATED", containerId: id };
    try { if (io.update) await io.update(stageIntent, stageRecord); else await io.record(stageRecord); }
    catch (error) {
      try { await io.inspectOwned(id, labels); await io.remove(id); if (io.containerAbsent && !(await io.containerAbsent(id))) fail("CONTAINER_CLEANUP_UNRESOLVED"); if (io.reserve) await io.settle?.(stageIntent); id = null; stageRecord = null; stageIntent = null; }
      catch (cleanupError) { throw new Error("STAGE_CLEANUP_UNRESOLVED", { cause: cleanupError }); }
      throw error;
    }
    requireActive(stage.signal);
    const before = await io.inspectOwned(id, labels);
    if (before?.running !== false) fail("STAGE_STARTED");
    owned = true;
    await io.copy(id, stage.tarStream ?? stage.tar, { bytes: stage.outerBytes, sha256: stage.outerDigest });
    const after = await io.inspectOwned(id, labels);
    if (after?.running !== false) fail("STAGE_STARTED");
    const diff = await io.diff(id);
    // The trusted base already owns /sealed, so adding its sole child is
    // reported by Docker as C for the directory and A for the sealed file.
    const expectedDiff = [{ kind: "C", path: "/sealed" }, { kind: "A", path: "/sealed/snapshot.bin" }];
    if (JSON.stringify(diff) !== JSON.stringify(expectedDiff)) fail(`STAGE_DIFF_MISMATCH ${JSON.stringify(diff).slice(0, 512)}`);
    await io.revalidateSource?.();
    requireActive(stage.signal);
    imageIntent = { resource: "image", role: "snapshot-image", phase: "COMMIT_INTENT", imageId: null, attemptId: stage.attemptId, creationNonce: stage.creationNonce, labels: committedLabels };
    if (io.reserve) await io.reserve(imageIntent);
    requireActive(stage.signal);
    const intermediateId = await io.commit(id, committedLabels);
    if (!SHA256.test(intermediateId)) fail(`INTERMEDIATE_IMAGE_MISMATCH ${String(intermediateId).slice(0, 128)}`);
    await io.afterCommit?.(intermediateId, imageIntent);
    imageRecord = { ...imageIntent, phase: "COMMITTED", imageId: intermediateId };
    try { if (io.update) await io.update(imageIntent, imageRecord); else await io.record(imageRecord); }
    catch (error) {
      try { const image = await io.inspectIntermediate(intermediateId, committedLabels, config.imageId); if (image.id !== intermediateId || !exactLabels(image.labels, committedLabels) || (image.dependentContainers?.length ?? 0) !== 0) fail("IMAGE_OWNERSHIP_MISMATCH"); await io.removeImage(intermediateId); if (!(await io.imageAbsent(intermediateId))) fail("IMAGE_CLEANUP_UNRESOLVED"); if (io.reserve) await io.settle?.(imageIntent); imageRecord = null; imageIntent = null; }
      catch (cleanupError) { throw new Error("STAGE_CLEANUP_UNRESOLVED", { cause: cleanupError }); }
      throw error;
    }
    const image = await io.inspectIntermediate(intermediateId, committedLabels, config.imageId);
    if (image.id !== intermediateId || image.os !== "linux" || image.architecture !== "arm64" || !exactLabels(image.labels, committedLabels) || JSON.stringify(image.entrypoint) !== JSON.stringify(RUNNER_ENTRYPOINT) || !Array.isArray(image.layers) || !Array.isArray(image.baseLayers) || image.layers.length !== image.baseLayers.length + 1 || JSON.stringify(image.layers.slice(0, -1)) !== JSON.stringify(image.baseLayers) || (image.parent && image.parent !== config.imageId)) fail("INTERMEDIATE_IMAGE_MISMATCH");
    result = Object.freeze({ imageId: intermediateId, imageLabels: Object.freeze(committedLabels), journalRecord: imageRecord });
  } catch (error) {
    primaryError = error;
    if ((stageIntent && !stageRecord) || (imageIntent && !imageRecord) || String(error?.message).includes("CLEANUP_UNRESOLVED")) io.park?.();
  }
  if (id && (owned || stageRecord)) {
    try {
      await io.inspectOwned(id, labels);
      await io.remove(id);
      if (stageRecord) await io.settle?.(stageRecord);
    } catch (error) {
      primaryError = new Error("STAGE_CLEANUP_UNRESOLVED", { cause: error });
      io.park?.();
    }
  }
  if (primaryError) throw primaryError;
  return result;
}

export async function runOwnedContainer(config, run, io) {
  let id = null;
  let ownership = false;
  let candidate = null;
  let unresolved = false;
  let journalRecord = null;
  let journalIntent = null;
  let createInvoked = false;
  let started = false;
  let createdExtinct = false;
  const imageId = executionImage(config, run);
  const labels = expectedOwned(config, { ...run, imageId });
  try {
    requireActive(run.signal);
    await io.requalify?.(run.checkId);
    requireActive(run.signal);
    journalIntent = { resource: "container", role: "check", phase: "CREATE_INTENT", containerId: null, attemptId: run.attemptId, checkId: run.checkId, creationNonce: run.creationNonce, labels };
    if (io.reserve) await io.reserve(journalIntent);
    requireActive(run.signal);
    createInvoked = true;
    id = await io.create(buildCreateArgs(config, { ...run, imageId, ownedLabels: labels }));
    if (typeof id !== "string" || !id) fail("CREATE_FAILED");
    await io.afterCreate?.(run.checkId, id, journalIntent);
    journalRecord = { ...journalIntent, phase: "CREATED", containerId: id };
    try { if (io.update) await io.update(journalIntent, journalRecord); else await io.record(journalRecord); }
    catch (error) {
      try { await io.inspectOwned(id, labels); await io.remove(id); if (io.containerAbsent && !(await io.containerAbsent(id))) fail("CONTAINER_CLEANUP_UNRESOLVED"); if (io.reserve) await io.settle?.(journalIntent); id = null; journalRecord = null; journalIntent = null; createdExtinct = true; }
      catch (cleanupError) { throw new Error("CLEANUP_UNRESOLVED", { cause: cleanupError }); }
      throw error;
    }
    requireActive(run.signal);
    await io.inspectOwned(id, labels);
    ownership = true;
    if (run.tar !== undefined) {
      await io.copy(id, run.tar);
      await io.inspectOwned(id, labels);
    }
    requireActive(run.signal);
    started = true;
    candidate = await io.startAttach(id, run);
    started = candidate?.attachStarted !== false;
    if (!candidate?.cliExited) { unresolved = true; io.park?.(); }
  } catch (error) {
    if (["OWNERSHIP_MISMATCH", "CLEANUP_UNRESOLVED"].some(code => String(error?.message).includes(code)) || (createInvoked && !id && !createdExtinct)) unresolved = true;
    if (unresolved) io.park?.();
    candidate = { infrastructure: true, reason: String(error?.message ?? "DOCKER_FAILURE") };
  }
  let cleaned = false;
  try {
    if (id && (ownership || journalRecord)) {
      if (!candidate?.containerExtinct) {
        await io.inspectOwned(id, labels);
        if (candidate?.timeout || candidate?.cancelled || candidate?.outputLimit) await io.stop?.(id);
        await io.inspectOwned(id, labels);
        await io.remove(id);
        if (io.containerAbsent && !(await io.containerAbsent(id))) fail("CONTAINER_CLEANUP_UNRESOLVED");
      } else if (io.containerAbsent && !(await io.containerAbsent(id))) fail("CONTAINER_CLEANUP_UNRESOLVED");
      if (candidate?.cliExited === false) {
        if (typeof io.recordUnresolvedCli !== "function") fail("UNRESOLVED_CLI_JOURNAL_UNAVAILABLE");
        await io.recordUnresolvedCli({ kind: "unresolved_cli", attemptId: run.attemptId, checkId: run.checkId, creationNonce: run.creationNonce, containerId: id, recordedAt: new Date().toISOString(), reason: "CLI_EXTINCTION_UNPROVEN" });
      }
      if (journalRecord) await io.settle?.(journalRecord);
    }
    await io.removeScratch?.();
    await io.revalidateSource?.();
    cleaned = !unresolved;
  } catch {
    cleaned = false;
    unresolved = true;
    io.park?.();
  }
  if (!cleaned) return Object.freeze({ state: "INDETERMINATE", reason: "CLEANUP_UNRESOLVED", execution: started ? "RUN" : "NOT_RUN", unresolved: true, cliExited: candidate?.cliExited ?? null });
  if (candidate?.exitCode === 2) candidate = { ...candidate, infrastructure: true, reason: "RUNNER_INFRASTRUCTURE" };
  if (candidate?.infrastructure || candidate?.timeout || candidate?.cancelled || candidate?.outputLimit) return Object.freeze({ state: "INDETERMINATE", reason: candidate.reason ?? (candidate.timeout ? "TIMEOUT" : candidate.cancelled ? "CANCELLED" : "OUTPUT_LIMIT"), execution: started ? "RUN" : "NOT_RUN" });
  return Object.freeze({ state: candidate.exitCode === 0 ? "PASS" : "FAIL", reason: candidate.exitCode === 0 ? "CHECK_PASSED" : "CHECK_FAILED", execution: "RUN", exitCode: candidate.exitCode, stdout: candidate.stdout, stderr: candidate.stderr });
}

export async function runSnapshotChecks(config, stage, io) {
  let staged;
  let provisional = [];
  let reason = null;
  let globalCleanupUnresolved = false;
  try {
    requireActive(stage.signal);
    staged = await (io.stageSnapshotImage ?? stageSnapshotImage)(config, stage, io);
    requireActive(stage.signal);
    await io.revalidateSource?.();
    requireActive(stage.signal);
    for (const checkId of ["unit", "build"]) {
      requireActive(stage.signal);
      await io.revalidateSource?.();
      requireActive(stage.signal);
      const run = { attemptId: stage.attemptId, checkId, creationNonce: stage.creationNonces?.[checkId] ?? `${stage.creationNonce}-${checkId}`, imageId: staged.imageId, imageLabels: staged.imageLabels, signal: stage.signal };
      const outcome = await (io.runOwnedContainer ?? runOwnedContainer)(config, run, io);
      if (outcome.state === "INDETERMINATE") reason = outcome.reason;
      provisional.push(Object.freeze({ checkId, ...outcome }));
      if (reason) break;
    }
    await io.revalidateSource?.();
  } catch (error) {
    reason = String(error?.message ?? "DOCKER_FAILURE");
  }
  if (staged) {
    try {
      const inspected = await io.inspectIntermediate(staged.imageId, staged.imageLabels, config.imageId);
      if (inspected.id !== staged.imageId || !exactLabels(inspected.labels, staged.imageLabels) || (inspected.dependentContainers?.length ?? 0) !== 0) fail("IMAGE_OWNERSHIP_MISMATCH");
      await io.removeImage(staged.imageId);
      if (!(await io.imageAbsent(staged.imageId))) fail("IMAGE_CLEANUP_UNRESOLVED");
      if (staged.journalRecord) await io.settle?.(staged.journalRecord);
    } catch {
      reason = "CLEANUP_UNRESOLVED";
      globalCleanupUnresolved = true;
      io.park?.();
    }
  }
  if (reason) return Object.freeze({ state: "INDETERMINATE", reason, results: Object.freeze(globalCleanupUnresolved ? [] : provisional), unresolved: reason === "CLEANUP_UNRESOLVED" });
  return Object.freeze({ state: "SETTLED", imageId: staged.imageId, results: Object.freeze(provisional) });
}

export async function recoverJournal(records, io) {
  const unresolvedCli = records.filter(record => record?.kind === "unresolved_cli");
  if (unresolvedCli.length) {
    io.park?.();
    return Object.freeze({ unresolved: unresolvedCli });
  }
  const unresolved = [];
  for (const record of records) {
    try {
      if (record.resource === "image") {
        const candidates = record.imageId ? [record.imageId] : await io.findOwnedImages(record.labels);
        if (candidates.length === 0) { await io.settle?.(record); continue; }
        if (candidates.length !== 1) fail("IMAGE_OWNERSHIP_AMBIGUOUS"); const imageId = candidates[0];
        const image = await io.inspectIntermediate(imageId, record.labels);
        if (image.id !== imageId || !exactLabels(image.labels, record.labels) || (image.dependentContainers?.length ?? 0) !== 0) fail("IMAGE_OWNERSHIP_MISMATCH");
        await io.removeImage(imageId);
        if (!(await io.imageAbsent(imageId))) fail("IMAGE_CLEANUP_UNRESOLVED");
        await io.settle?.(record);
      } else {
        const candidates = record.containerId ? [record.containerId] : await io.findOwnedContainers(record.labels);
        if (candidates.length === 0) { await io.settle?.(record); continue; }
        if (candidates.length !== 1) fail("CONTAINER_OWNERSHIP_AMBIGUOUS"); const containerId = candidates[0];
        await io.inspectOwned(containerId, record.labels);
        await io.remove(containerId);
        if (io.containerAbsent && !(await io.containerAbsent(containerId))) fail("CONTAINER_CLEANUP_UNRESOLVED");
        await io.settle?.(record);
      }
    } catch {
      unresolved.push(record);
    }
  }
  return Object.freeze({ unresolved });
}

const ENV = Object.freeze({ PATH: "/usr/bin:/bin", HOME: "/nonexistent", LANG: "C", LC_ALL: "C" });
export function createDockerCliIO(config) {
  const prefix = ["--config", config.dockerConfig, "--host", config.dockerHost];
  let parked = Boolean(config.journal?.records?.().some(record => record?.kind === "unresolved_cli"));
  const call = (args, options = {}) => {
    const result = spawnSync(config.dockerCli, [...prefix, ...args], { env: ENV, input: options.input, encoding: null, maxBuffer: 16 * 1024 * 1024, timeout: options.timeout ?? 30_000 });
    if (result.status !== 0 && !options.allowFailure) throw new Error(`DOCKER_FAILURE ${String(result.stderr).slice(0, 1024)}`);
    return result;
  };
  const sync = (args, input) => call(args, { input }).stdout;
  const inspectRaw = id => JSON.parse(String(sync(["inspect", id, "--format", "{{json .}}"])));
  const imageRaw = id => JSON.parse(String(sync(["image", "inspect", id, "--format", "{{json .}}"])));
  const terminateOwned = async (id, labels) => {
    const value = inspectRaw(id);
    if (!exactLabels(value.Config?.Labels, labels)) fail("OWNERSHIP_MISMATCH");
    sync(["stop", "--time", "1", id]);
    const stopped = inspectRaw(id);
    if (!exactLabels(stopped.Config?.Labels, labels)) fail("OWNERSHIP_MISMATCH");
    sync(["rm", "--force", id]);
    if (call(["inspect", id], { allowFailure: true }).status === 0) fail("CONTAINER_CLEANUP_UNRESOLVED");
  };
  return {
    park() { parked = true; },
    isParked() { return parked; },
    realpath,
    async inspectEndpoint() {
      const value = JSON.parse(String(sync(["info", "--format", "{{json .}}"])));
      return { daemonId: value.ID, serverVersion: value.ServerVersion, os: value.OSType, arch: value.Architecture === "aarch64" ? "arm64" : value.Architecture, cgroupVersion: String(value.CgroupVersion), securityOptions: value.SecurityOptions, kernelVersion: value.KernelVersion, runtime: value.Driver };
    },
    async inspectImage(id) {
      const value = imageRaw(id);
      return { id: value.Id, os: value.Os, architecture: value.Architecture, labels: value.Config?.Labels ?? {}, layers: value.RootFS?.Layers ?? [], entrypoint: value.Config?.Entrypoint ?? [] };
    },
    async create(args) { return String(sync(args)).trim(); },
    async record(record) { await config.journal?.record(record); },
    async recordUnresolvedCli(record) { if (!config.journal) fail("UNRESOLVED_CLI_JOURNAL_UNAVAILABLE"); await config.journal.record(record); },
    async reserve(record) { await config.journal?.reserve(record); },
    async update(record, replacement) { await config.journal?.update(record, replacement); },
    async settle(record) { await config.journal?.settle(record); },
    async inspectOwned(id, labels) {
      const value = inspectRaw(id);
      if (!exactLabels(value.Config?.Labels, labels)) fail("OWNERSHIP_MISMATCH");
      return { running: value.State?.Running, labels: value.Config?.Labels };
    },
    async copy(id, input, expected) {
      if (Buffer.isBuffer(input)) { sync(["cp", "-", `${id}:/`], input); return; }
      const source = typeof input === "function" ? input() : input;
      if (!source || typeof source[Symbol.asyncIterator] !== "function") fail("TAR_STREAM_REQUIRED");
      const child = spawn(config.dockerCli, [...prefix, "cp", "-", `${id}:/`], { env: ENV, stdio: ["pipe", "ignore", "pipe"] });
      let diagnostic = "", bytes = 0; const digest = createHash("sha256"); const closed = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", code => resolve(code)); });
      child.stderr.setEncoding("utf8"); child.stderr.on("data", chunk => { if (diagnostic.length < 1024) diagnostic += chunk.slice(0, 1024 - diagnostic.length); });
      try {
        for await (const emitted of source) {
          const chunk = Buffer.from(emitted); if (chunk.length > 65_536) fail("TAR_CHUNK_LIMIT"); bytes += chunk.length; if (!Number.isSafeInteger(bytes) || bytes > 276_826_112) fail("TAR_SIZE_LIMIT"); digest.update(chunk);
          if (!child.stdin.write(chunk)) await once(child.stdin, "drain");
        }
        child.stdin.end(); const status = await closed; const actual = digest.digest("hex"); if (status !== 0) fail(`DOCKER_FAILURE ${diagnostic}`.slice(0, 1024)); if (expected && (bytes !== expected.bytes || actual !== expected.sha256)) fail("TAR_TRANSPORT_MISMATCH");
      } catch (error) { child.stdin.destroy(); throw error; }
    },
    async diff(id) {
      return String(sync(["diff", id])).trim().split("\n").filter(Boolean).map(line => ({ kind: line[0], path: line.slice(2) }));
    },
    async commit(id, labels) {
      const changes = Object.entries(labels).flatMap(([key, value]) => ["--change", `LABEL ${key}=${value}`]);
      return String(sync(["commit", "--no-pause", ...changes, id])).trim();
    },
    async inspectIntermediate(id, expected, baseId = config.imageId) {
      const value = imageRaw(id);
      const base = imageRaw(baseId);
      const dependentContainers = String(sync(["ps", "--all", "--filter", `ancestor=${id}`, "--format", "{{.ID}}"])) .trim().split("\n").filter(Boolean);
      return { id: value.Id, os: value.Os, architecture: value.Architecture, labels: value.Config?.Labels ?? {}, layers: value.RootFS?.Layers ?? [], baseLayers: base.RootFS?.Layers ?? [], entrypoint: value.Config?.Entrypoint ?? [], parent: value.Parent || undefined, dependentContainers, expected };
    },
    async startAttach(id, run) {
      return new Promise(resolve => {
        const stdout = createOutputCollector({ hardBytes: config.outputCeilingBytes ?? 4 * 1024 * 1024, redactions: config.redactions ?? [] });
        const stderr = createOutputCollector({ hardBytes: config.outputCeilingBytes ?? 4 * 1024 * 1024, redactions: config.redactions ?? [] });
        let child = null, terminal = null, stopping = false, settled = false, attachStarted = false, containerExtinct = false, cliExit = null;
        let timer = null, extinctionTimer = null;
        const finish = cliExited => {
          if (settled) return; settled = true; clearTimeout(timer); clearTimeout(extinctionTimer); run.signal?.removeEventListener("abort", onAbort);
          resolve({ exitCode: cliExit?.exitCode ?? null, signal: cliExit?.signal ?? null, stdout: stdout.finish(), stderr: stderr.finish(), cliExited, attachStarted, containerExtinct, ...(terminal ? { [terminal]: true, reason: terminal === "timeout" ? "TIMEOUT" : terminal === "cancelled" ? "CANCELLED" : terminal === "outputLimit" ? "OUTPUT_LIMIT" : "DOCKER_FAILURE" } : {}) });
        };
        const terminate = reason => {
          if (stopping) return; stopping = true; terminal = reason;
          void (async () => {
            try { await terminateOwned(id, expectedOwned(config, run)); containerExtinct = true; }
            catch { terminal = "infrastructure"; }
            if (cliExit) { finish(true); return; }
            extinctionTimer = setTimeout(() => finish(false), CLI_EXIT_DEADLINE_MS);
            extinctionTimer.unref?.();
          })();
        };
        const write = (collector, chunk) => { if (stopping) return; try { collector.write(chunk); } catch (error) { if (String(error?.message) === "OUTPUT_LIMIT") terminate("outputLimit"); else terminate("infrastructure"); } };
        const onAbort = () => { if (child) terminate("cancelled"); };
        run.signal?.addEventListener("abort", onAbort, { once: true });
        if (run.signal?.aborted) { run.signal.removeEventListener("abort", onAbort); terminal = "cancelled"; finish(true); return; }
        attachStarted = true;
        child = spawn(config.dockerCli, [...prefix, "start", "--attach", id], { env: ENV, stdio: ["ignore", "pipe", "pipe"] });
        child.stdout.on("data", chunk => write(stdout, chunk));
        child.stderr.on("data", chunk => write(stderr, chunk));
        timer = setTimeout(() => terminate("timeout"), config.checkTimeoutMs?.[run.checkId] ?? 120_000);
        timer.unref?.();
        child.on("error", () => terminate("infrastructure"));
        child.on("exit", (exitCode, signal) => {
          cliExit = { exitCode, signal };
          if (!stopping || containerExtinct) finish(true);
        });
      });
    },
    async stop(id) { sync(["stop", "--time", "1", id]); },
    async remove(id) { sync(["rm", "--force", id]); },
    async containerAbsent(id) { return call(["inspect", id], { allowFailure: true }).status !== 0; },
    async findOwnedContainers(labels) {
      const args = ["ps", "--all", ...Object.entries(labels).flatMap(([key, value]) => ["--filter", `label=${key}=${value}`]), "--no-trunc", "--format", "{{.ID}}"];
      return [...new Set(String(sync(args)).trim().split("\n").filter(Boolean))];
    },
    async removeImage(id) { sync(buildRemoveImageArgs(id)); },
    async imageAbsent(id) { return call(["image", "inspect", id], { allowFailure: true }).status !== 0; },
    async findOwnedImages(labels) {
      const args = ["image", "ls", ...Object.entries(labels).flatMap(([key, value]) => ["--filter", `label=${key}=${value}`]), "--no-trunc", "--format", "{{.ID}}"];
      return [...new Set(String(sync(args)).trim().split("\n").filter(Boolean))];
    },
  };
}
