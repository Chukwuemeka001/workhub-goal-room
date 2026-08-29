import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

export function createCdpCaller(socket, { timeoutMs = 30_000 } = {}) {
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
  });
  return (method, params = {}, options = {}) => new Promise((resolveCall, reject) => {
    const id = ++nextId;
    const methodTimeout = options.timeoutMs ?? timeoutMs;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, methodTimeout);
    pending.set(id, { resolve: resolveCall, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

export async function captureScreenshotWithRetry(capture, { attempts = 2, settle = async () => {} } = {}) {
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error("Screenshot attempt budget must be a positive integer");
  let finalError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await settle(attempt);
      const result = await capture();
      return Buffer.from(result.data, "base64");
    } catch (error) {
      finalError = error;
      if (attempt === attempts) throw error;
    }
  }
  throw finalError;
}

export async function createEvidenceCustody({ env = process.env, outputDirectory, temporaryRoot } = {}) {
  const requested = outputDirectory ?? env.WORKHUB_QA_EVIDENCE_DIR;
  if (requested) {
    const directory = resolve(requested);
    await mkdir(directory, { recursive: true });
    return { directory, temporary: false, cleanup: async () => {} };
  }
  const directory = await mkdtemp(join(temporaryRoot, "workhub-desktop-evidence-"));
  return {
    directory,
    temporary: true,
    cleanup: async () => { await rm(directory, { recursive: true, force: true }); },
  };
}
