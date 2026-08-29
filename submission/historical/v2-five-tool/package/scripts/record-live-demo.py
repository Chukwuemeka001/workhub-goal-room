#!/usr/bin/env python3
"""Record the Phase 7 judge demo through Chrome DevTools screencast.

The script captures actual page presentation frames while exercising the local
competition app. Its inspector is populated from real registerTool descriptors
and calls the captured native callbacks; it does not simulate an autonomous
model or widen product authority.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import time
import urllib.request
from pathlib import Path
from typing import Any

import websockets


class Cdp:
    def __init__(self, websocket_url: str, frames_dir: Path) -> None:
        self.websocket_url = websocket_url
        self.frames_dir = frames_dir
        self.ws: Any = None
        self.next_id = 0
        self.pending: dict[int, asyncio.Future[Any]] = {}
        self.reader_task: asyncio.Task[Any] | None = None
        self.frame_times: list[float] = []
        self.started = 0.0

    async def __aenter__(self) -> "Cdp":
        self.ws = await websockets.connect(self.websocket_url, origin=None, max_size=20_000_000)
        self.reader_task = asyncio.create_task(self._reader())
        return self

    async def __aexit__(self, *_: Any) -> None:
        if self.reader_task:
            self.reader_task.cancel()
        if self.ws:
            await self.ws.close()

    async def _reader(self) -> None:
        assert self.ws is not None
        async for raw in self.ws:
            message = json.loads(raw)
            if "id" in message:
                future = self.pending.pop(message["id"], None)
                if future and not future.done():
                    if "error" in message:
                        future.set_exception(RuntimeError(json.dumps(message["error"])))
                    else:
                        future.set_result(message.get("result", {}))
                continue
            if message.get("method") == "Page.screencastFrame":
                params = message["params"]
                index = len(self.frame_times)
                (self.frames_dir / f"frame-{index:05d}.jpg").write_bytes(
                    base64.b64decode(params["data"])
                )
                self.frame_times.append(time.monotonic() - self.started)
                await self.send_no_reply(
                    "Page.screencastFrameAck", {"sessionId": params["sessionId"]}
                )

    async def send_no_reply(self, method: str, params: dict[str, Any] | None = None) -> None:
        assert self.ws is not None
        self.next_id += 1
        await self.ws.send(json.dumps({"id": self.next_id, "method": method, "params": params or {}}))

    async def command(self, method: str, params: dict[str, Any] | None = None) -> Any:
        assert self.ws is not None
        self.next_id += 1
        identifier = self.next_id
        future: asyncio.Future[Any] = asyncio.get_running_loop().create_future()
        self.pending[identifier] = future
        await self.ws.send(json.dumps({"id": identifier, "method": method, "params": params or {}}))
        return await future

    async def evaluate(self, expression: str, await_promise: bool = False) -> Any:
        result = await self.command(
            "Runtime.evaluate",
            {
                "expression": expression,
                "awaitPromise": await_promise,
                "returnByValue": True,
                "userGesture": True,
            },
        )
        return result.get("result", {}).get("value")


CAPTURE_REGISTRATIONS = r"""
(() => {
  const context = document.modelContext;
  window.__phase7Tools = [];
  window.__phase7Exec = {};
  if (!context) return;
  const original = context.registerTool.bind(context);
  context.registerTool = (descriptor) => {
    window.__phase7Tools.push({
      name: descriptor.name,
      title: descriptor.title,
      description: descriptor.description,
      inputSchema: descriptor.inputSchema,
      annotations: descriptor.annotations,
    });
    window.__phase7Exec[descriptor.name] = descriptor.execute;
    return original(descriptor);
  };
})();
"""

INSTALL_OVERLAY = r"""
(() => {
  const panel = document.createElement('aside');
  panel.id = 'phase7-demo-panel';
  panel.style.cssText = `position:fixed;right:24px;top:24px;width:470px;max-height:820px;
    overflow:auto;z-index:2147483646;background:rgba(2,6,23,.97);color:#e2e8f0;
    border:2px solid #22d3ee;border-radius:18px;padding:22px;box-shadow:0 24px 70px #000b;
    font:15px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;`;
  document.body.append(panel);
  const cursor = document.createElement('div');
  cursor.id = 'phase7-demo-cursor';
  cursor.style.cssText = `position:fixed;left:80px;top:120px;width:22px;height:22px;
    z-index:2147483647;border:3px solid #67e8f9;border-radius:50%;background:#22d3ee55;
    box-shadow:0 0 0 8px #22d3ee22;pointer-events:none;transition:left .75s ease,top .75s ease;`;
  document.body.append(cursor);
  window.__phase7Panel = panel;
  window.__phase7Cursor = cursor;
})();
"""


def panel_html(title: str, body: str, accent: str = "#67e8f9") -> str:
    return (
        f"<div style='color:{accent};font-size:12px;letter-spacing:1.7px;font-weight:700'>"
        "LIVE WEBMCP INSPECTOR</div>"
        f"<h2 style='font:700 22px system-ui;margin:10px 0 12px'>{title}</h2>"
        f"<div>{body}</div>"
        "<div style='margin-top:16px;color:#94a3b8;font-size:12px'>"
        "Captured from document.modelContext.registerTool · deterministic operator demo · not autonomous model execution"
        "</div>"
    )


async def set_panel(cdp: Cdp, title: str, body: str, accent: str = "#67e8f9") -> None:
    html = json.dumps(panel_html(title, body, accent))
    await cdp.evaluate(f"window.__phase7Panel.innerHTML={html}")


async def click(cdp: Cdp, element_id: str) -> None:
    point = await cdp.evaluate(
        f"""(() => {{ const r=document.getElementById({json.dumps(element_id)}).getBoundingClientRect();
        return {{x:r.left+r.width/2,y:r.top+r.height/2}}; }})()"""
    )
    await cdp.evaluate(
        f"window.__phase7Cursor.style.left='{point['x'] - 11}px';"
        f"window.__phase7Cursor.style.top='{point['y'] - 11}px'"
    )
    await asyncio.sleep(1.0)
    await cdp.command("Input.dispatchMouseEvent", {"type": "mouseMoved", **point})
    await cdp.command(
        "Input.dispatchMouseEvent",
        {"type": "mousePressed", "button": "left", "clickCount": 1, **point},
    )
    await asyncio.sleep(0.18)
    await cdp.command(
        "Input.dispatchMouseEvent",
        {"type": "mouseReleased", "button": "left", "clickCount": 1, **point},
    )


async def record(args: argparse.Namespace) -> None:
    frames_dir = Path(args.frames_dir)
    frames_dir.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(f"{args.cdp_http}/json/list", timeout=10) as response:
        targets = json.load(response)
    page = next(target for target in targets if target.get("type") == "page")

    async with Cdp(page["webSocketDebuggerUrl"], frames_dir) as cdp:
        await cdp.command("Page.enable")
        await cdp.command("Runtime.enable")
        await cdp.command(
            "Emulation.setDeviceMetricsOverride",
            {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False},
        )
        await cdp.command("Page.addScriptToEvaluateOnNewDocument", {"source": CAPTURE_REGISTRATIONS})
        await cdp.command("Page.navigate", {"url": args.url})
        await asyncio.sleep(1.5)
        await cdp.evaluate(INSTALL_OVERLAY)
        cdp.started = time.monotonic()
        await cdp.command(
            "Page.startScreencast",
            {"format": "jpeg", "quality": 90, "maxWidth": 1440, "maxHeight": 900, "everyNthFrame": 1},
        )

        await set_panel(
            cdp,
            "WorkHub Goal Room",
            "<p style='font:18px/1.5 system-ui'>One Goal. One legal next action.</p>"
            "<p>WebMCP connected to the same governed state shown by the owner UI.</p>",
        )
        await asyncio.sleep(6)

        tools = await cdp.evaluate("window.__phase7Tools")
        items = "".join(f"<li style='margin:7px 0'>{tool['name']}</li>" for tool in tools)
        await set_panel(cdp, f"{len(tools)} native tools registered", f"<ol>{items}</ol>")
        await asyncio.sleep(11)

        state = await cdp.evaluate(
            "window.__phase7Exec.get_goal_room_state({})", await_promise=True
        )
        await set_panel(
            cdp,
            "Real read-only callback result",
            "<pre style='white-space:pre-wrap;font-size:12px'>"
            + json.dumps(state, indent=2).replace("&", "&amp;").replace("<", "&lt;")
            + "</pre>",
        )
        await asyncio.sleep(11)

        invalid = await cdp.evaluate(
            "window.__phase7Exec.claim_step({actor:'owner',expectedStateVersion:-1,"
            "idempotencyKey:'',planVersion:0,stepId:''})",
            await_promise=True,
        )
        await set_panel(
            cdp,
            "Malformed call refused",
            "<pre style='white-space:pre-wrap;font-size:12px'>"
            + json.dumps(invalid, indent=2).replace("&", "&amp;").replace("<", "&lt;")
            + "</pre><p style='color:#fda4af'>State and receipt count remain unchanged.</p>",
            "#fb7185",
        )
        await asyncio.sleep(10)
        await cdp.evaluate("window.__phase7Panel.style.display='none'")
        await asyncio.sleep(2)

        for element_id, pause in [
            ("confirm-plan", 8),
            ("advance-demo", 8),
            ("advance-demo", 8),
            ("advance-demo", 10),
            ("advance-demo", 8),
            ("advance-demo", 10),
            ("advance-demo", 11),
            ("accept-goal", 10),
        ]:
            await click(cdp, element_id)
            await asyncio.sleep(pause)

        await cdp.evaluate(
            "document.getElementById('receipt-list').scrollIntoView({behavior:'smooth',block:'center'})"
        )
        await asyncio.sleep(10)
        await cdp.evaluate("scrollTo({top:0,behavior:'smooth'})")
        await asyncio.sleep(3)
        await cdp.evaluate("window.__phase7Panel.style.display='block'")
        await set_panel(
            cdp,
            "Goal accepted by owner",
            "<p style='font:18px/1.5 system-ui'>Every lifecycle stage is complete.</p>"
            "<p>No further governed action.</p><p>Humans and agents share state—not authority.</p>",
            "#34d399",
        )
        await asyncio.sleep(13)
        duration = time.monotonic() - cdp.started
        await cdp.command("Page.stopScreencast")
        await asyncio.sleep(0.5)

    manifest = {
        "schemaVersion": 1,
        "mode": "continuous Chrome DevTools Page.startScreencast of the functioning app",
        "browser": "Chrome/154.0.8027.0",
        "url": args.url,
        "durationSeconds": duration,
        "frameCount": len(cdp.frame_times),
        "frameTimes": cdp.frame_times,
        "claimBoundary": "Native descriptor/callback inspection plus deterministic operator clicks; not autonomous model execution.",
    }
    Path(args.manifest).write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({key: manifest[key] for key in ("durationSeconds", "frameCount", "mode")}))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4191/")
    parser.add_argument("--cdp-http", default="http://127.0.0.1:9333")
    parser.add_argument("--frames-dir", required=True)
    parser.add_argument("--manifest", required=True)
    asyncio.run(record(parser.parse_args()))


if __name__ == "__main__":
    main()
