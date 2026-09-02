import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createCdpBrowser, createLoopbackOpenAIProvider } from "./adapters.mjs";

async function listen(server) {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return server.address().port;
}

test("provider refuses non-loopback and posts exact OpenAI request without real credentials", async () => {
  assert.throws(() => createLoopbackOpenAIProvider({ baseUrl: "https://api.x.ai/v1" }), /LOOPBACK_ONLY/);
  let captured;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    captured = { url: request.url, authorization: request.headers.authorization, body: JSON.parse(Buffer.concat(chunks)) };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ id: "mock", choices: [{ message: { role: "assistant", content: "stop", tool_calls: [] } }] }));
  });
  const port = await listen(server);
  try {
    const provider = createLoopbackOpenAIProvider({ baseUrl: `http://127.0.0.1:${port}/v1` });
    const request = { model: "mock", messages: [{ role: "user", content: "hello" }], tools: [] };
    const result = await provider.complete(request);
    assert.equal(result.id, "mock");
    assert.equal(captured.url, "/v1/chat/completions");
    assert.equal(captured.authorization, "Bearer evaluation-client");
    assert.deepEqual(captured.body, request);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

class FakeSocket extends EventTarget {
  static instances = [];
  constructor(url) {
    super();
    this.url = url;
    this.sent = [];
    FakeSocket.instances.push(this);
    queueMicrotask(() => this.dispatchEvent(new Event("open")));
  }
  send(raw) {
    const message = JSON.parse(raw);
    this.sent.push(message);
    let value = null;
    if (message.method === "Runtime.evaluate") {
      const expression = message.params.expression;
      if (expression.includes("__WORKHUB_DESCRIPTORS__")) value = [{ name: "get_goal_room_state", description: "read", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }];
      else if (expression.includes("__WORKHUB_EXECUTE__")) value = { raw: "{\"accepted\":true}", parsed: { accepted: true } };
      else if (expression.includes("__WORKHUB_EVALUATOR_STATE__")) value = { raw: "{\"accepted\":true,\"currentStateVersion\":0,\"currentActor\":\"owner\"}", parsed: { accepted: true, currentStateVersion: 0, currentActor: "owner" } };
      else if (expression.includes("__WORKHUB_DOM__")) value = { phase: "INTENT_DRAFT", stateVersion: 0, actor: "owner", receiptCount: 0 };
    }
    queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id: message.id, result: { result: { value } } }) })));
  }
  close() { this.closed = true; }
}

test("CDP adapter selects the exact page and uses getTools RegisteredTool executeTool", async () => {
  FakeSocket.instances.length = 0;
  const fetchImpl = async (url) => {
    assert.equal(url, "http://127.0.0.1:9333/json");
    return { ok: true, json: async () => [
      { type: "page", url: "http://127.0.0.1:4177/other", webSocketDebuggerUrl: "ws://wrong" },
      { type: "page", url: "http://127.0.0.1:4177/index.html", webSocketDebuggerUrl: "ws://exact" },
    ] };
  };
  const browser = await createCdpBrowser({ cdpPort: 9333, pageUrl: "http://127.0.0.1:4177/index.html", fetchImpl, WebSocketImpl: FakeSocket });
  const descriptors = await browser.getDescriptors();
  assert.equal(descriptors[0].name, "get_goal_room_state");
  assert.deepEqual(await browser.executeModelTool("get_goal_room_state", {}), { accepted: true });
  assert.equal((await browser.readEvaluatorState()).currentStateVersion, 0);
  assert.equal((await browser.readDom()).receiptCount, 0);
  const socket = FakeSocket.instances[0];
  assert.equal(socket.url, "ws://exact");
  const expressions = socket.sent.filter((row) => row.method === "Runtime.evaluate").map((row) => row.params.expression);
  assert.ok(expressions.some((value) => value.includes("document.modelContext.getTools()")));
  assert.ok(expressions.some((value) => value.includes("document.modelContext.executeTool(tool,JSON.stringify")));
  assert.ok(expressions.some((value) => value.includes("tools.find((item)=>item.name===\"get_goal_room_state\")")));
  await browser.close();
  assert.equal(socket.closed, true);
});

test("CDP adapter rejects non-loopback ports and missing exact target", async () => {
  await assert.rejects(() => createCdpBrowser({ cdpPort: "http://remote:9333", pageUrl: "http://127.0.0.1/" }), /INVALID_CDP_PORT/);
  await assert.rejects(() => createCdpBrowser({
    cdpPort: 9333,
    pageUrl: "http://127.0.0.1:4177/missing",
    fetchImpl: async () => ({ ok: true, json: async () => [] }),
    WebSocketImpl: FakeSocket,
  }), /EXACT_PAGE_TARGET_NOT_FOUND/);
});
