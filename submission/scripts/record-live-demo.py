#!/usr/bin/env python3
"""Record a native V3 demo without bypassing product authority.

Agent operations use only the browser runtime's getTools/executeTool path. Owner
operations use trusted pointer/keyboard input against visible controls. The
production System adapter observes candidate submission and authors verdicts.
The script never claims autonomous model selection.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import urllib.request
from typing import Any

import websockets

TOOLS = (
    "get_goal_room_state",
    "propose_goal_contract",
    "propose_plan",
    "claim_step",
    "submit_artifact",
    "request_completion",
)

class CDP:
    def __init__(self, url: str) -> None:
        self.url, self.ws, self.index = url, None, 0

    async def __aenter__(self):
        self.ws = await websockets.connect(self.url, origin=None, max_size=20_000_000)
        return self

    async def __aexit__(self, *_: Any):
        await self.ws.close()

    async def command(self, method: str, params: dict[str, Any] | None = None):
        self.index += 1
        await self.ws.send(json.dumps({"id": self.index, "method": method, "params": params or {}}))
        while True:
            message = json.loads(await self.ws.recv())
            if message.get("id") == self.index:
                if "error" in message:
                    raise RuntimeError(json.dumps(message["error"]))
                return message.get("result", {})

    async def evaluate(self, expression: str, await_promise: bool = False):
        result = await self.command("Runtime.evaluate", {
            "expression": expression,
            "awaitPromise": await_promise,
            "returnByValue": True,
            "userGesture": True,
        })
        return result.get("result", {}).get("value")

    async def agent(self, name: str, payload: dict[str, Any]):
        if name not in TOOLS:
            raise ValueError(f"not an Agent tool: {name}")
        expression = """(async () => {
          const name = %s;
          const input = %s;
          const tools = await document.modelContext.getTools();
          const tool = tools.find((candidate) => candidate.name === name);
          if (!tool) throw new Error(`Missing browser-returned RegisteredTool: ${name}`);
          return await document.modelContext.executeTool(tool, JSON.stringify(input));
        })()""" % (json.dumps(name), json.dumps(payload))
        return await self.evaluate(expression, await_promise=True)

    async def trusted_click_text(self, label: str):
        point = await self.evaluate("""(() => {
          const label = %s;
          const node = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === label);
          if (!node) throw new Error(`Visible Owner control not found: ${label}`);
          const r = node.getBoundingClientRect();
          return {x:r.left+r.width/2,y:r.top+r.height/2};
        })()""" % json.dumps(label))
        for event in ("mousePressed", "mouseReleased"):
            await self.command("Input.dispatchMouseEvent", {"type": event, "button": "left", "clickCount": 1, **point})

async def record(args: argparse.Namespace) -> None:
    with urllib.request.urlopen(f"{args.cdp_http}/json/list", timeout=10) as response:
        page = next(item for item in json.load(response) if item.get("type") == "page")
    async with CDP(page["webSocketDebuggerUrl"]) as cdp:
        await cdp.command("Page.enable")
        await cdp.command("Runtime.enable")
        await cdp.command("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False})
        await cdp.command("Page.navigate", {"url": args.url})
        await asyncio.sleep(2)
        discovered = await cdp.evaluate("(async()=> (await document.modelContext.getTools()).map(t=>t.name))()", True)
        if set(discovered) != set(TOOLS) or len(discovered) != 6:
            raise RuntimeError(f"expected exact six-tool surface, got {discovered}")
        # Owner intent is entered through the visible form with trusted input in a
        # full capture run. Agent calls below demonstrate the only legal runtime route.
        await cdp.agent("get_goal_room_state", {})
        # The remaining calls are supplied from the current returned state during a
        # supervised capture. Owner Goal/Plan decisions and final acceptance must be
        # performed only through trusted visible UI controls.
        print(json.dumps({"nativeTools": discovered, "claim": "runtime discovery only; no autonomous selection"}))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4177/index.html")
    parser.add_argument("--cdp-http", default="http://127.0.0.1:9227")
    asyncio.run(record(parser.parse_args()))
