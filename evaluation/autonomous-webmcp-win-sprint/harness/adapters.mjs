function ensureLoopbackBase(baseUrl) {
  let parsed;
  try { parsed = new URL(baseUrl); } catch { throw new Error("LOOPBACK_ONLY: invalid base URL"); }
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    throw new Error("LOOPBACK_ONLY: provider base URL must use local HTTP");
  }
  return parsed.toString().replace(/\/$/, "");
}

export function createLoopbackOpenAIProvider({ baseUrl, fetchImpl = fetch, timeoutMs = 300_000 }) {
  const safeBase = ensureLoopbackBase(baseUrl);
  return {
    async complete(request) {
      const response = await fetchImpl(`${safeBase}/chat/completions`, {
        method: "POST",
        headers: {
          "authorization": "Bearer evaluation-client",
          "content-type": "application/json",
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`MODEL_HTTP_${response.status}: ${text.slice(0, 500)}`);
      try { return JSON.parse(text); } catch { throw new Error("INVALID_MODEL_JSON"); }
    },
  };
}

export async function createCdpBrowser({ cdpPort, pageUrl, fetchImpl = fetch, WebSocketImpl = WebSocket, timeoutMs = 30_000 }) {
  if (!Number.isInteger(cdpPort) || cdpPort < 1 || cdpPort > 65535) throw new Error("INVALID_CDP_PORT");
  const targetUrl = new URL(pageUrl).toString();
  const listResponse = await fetchImpl(`http://127.0.0.1:${cdpPort}/json`);
  if (!listResponse.ok) throw new Error(`CDP_TARGET_LIST_HTTP_${listResponse.status ?? "ERROR"}`);
  const targets = await listResponse.json();
  const target = targets.find((row) => row.type === "page" && new URL(row.url).toString() === targetUrl);
  if (!target?.webSocketDebuggerUrl) throw new Error("EXACT_PAGE_TARGET_NOT_FOUND");
  const socket = new WebSocketImpl(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP_OPEN_TIMEOUT")), timeoutMs);
    socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP_OPEN_FAILURE")); }, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const row = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(row.timer);
    if (message.error) row.reject(new Error(`CDP_ERROR: ${message.error.message}`)); else row.resolve(message.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP_TIMEOUT: ${method}`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await call("Runtime.enable");
  async function evaluate(expression) {
    const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "CDP_EVALUATION_FAILURE");
    return result.result.value;
  }
  async function getDescriptors() {
    return evaluate(`(async()=>{/*__WORKHUB_DESCRIPTORS__*/const tools=await document.modelContext.getTools();return tools.map((tool)=>({name:tool.name,title:tool.title,description:tool.description,inputSchema:tool.inputSchema,annotations:tool.annotations}));})()`);
  }
  async function invoke(name, args, marker) {
    const value = await evaluate(`(async()=>{/*${marker}*/const tools=await document.modelContext.getTools();const tool=tools.find((item)=>item.name===${JSON.stringify(name)});if(!tool)throw new Error("missing browser-returned tool");const raw=await document.modelContext.executeTool(tool,JSON.stringify(${JSON.stringify(args)}));return{raw,parsed:typeof raw==="string"?JSON.parse(raw):raw};})()`);
    return value.parsed;
  }
  return {
    getDescriptors,
    executeModelTool: (name, args) => invoke(name, args, "__WORKHUB_EXECUTE__"),
    readEvaluatorState: () => invoke("get_goal_room_state", {}, "__WORKHUB_EVALUATOR_STATE__"),
    readDom: () => evaluate(`(()=>{/*__WORKHUB_DOM__*/const phaseText=document.querySelector('.desktop-state-phase')?.textContent??document.querySelector('[data-mobile-phase]')?.textContent??'';const match=phaseText.match(/STATE v(\\d+) · (.+)/);const receiptText=document.querySelector('.desktop-detail:last-child summary')?.textContent??'';return{phase:match?.[2]??phaseText,stateVersion:match?Number(match[1]):-1,actor:document.querySelector('.desktop-now')?.dataset.actor??document.querySelector('[data-actor]')?.dataset.actor??'',receiptCount:Number(receiptText.match(/Receipts · (\\d+)/)?.[1]??0),frontier:document.querySelector('#desktop-now-heading')?.textContent??document.querySelector('[aria-live]')?.textContent??'',url:location.href};})()`),
    async close() { socket.close(); },
  };
}
