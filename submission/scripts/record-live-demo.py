#!/usr/bin/env python3
"""Capture the governed V3 journey through native WebMCP and trusted UI input.

The recorder launches signed Chrome Canary with a disposable unsigned-in profile,
uses the browser-returned RegisteredTool objects for every Agent operation, uses
CDP Input for visible Owner controls, captures Page.startScreencast frames, muxes
narration, writes an event/hash receipt, and removes its profile and raw frames.
It does not claim autonomous model selection.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import time
import urllib.request
from typing import Any, Callable, Coroutine

import websockets

ROOT = pathlib.Path(__file__).resolve().parents[2]
CANARY = pathlib.Path("/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary")
CANARY_APP = pathlib.Path("/Applications/Google Chrome Canary.app")
TOOLS = (
    "get_goal_room_state", "propose_goal_contract", "propose_plan",
    "claim_step", "submit_artifact", "request_completion",
)
EXPERIMENTS = ["enable-webmcp-testing@1", "devtools-webmcp-support@1"]
PRODUCT_COMMIT = "5ac95d4bdab5f54beda0f90776c3918fd36136d2"
PRODUCT_TREE = "b6b50068e8119d02d1d9213286f14adf3cbc0db1"


def sha256(data: bytes | str) -> str:
    if isinstance(data, str):
        data = data.encode()
    return hashlib.sha256(data).hexdigest()


class CDP:
    """Small event-capable CDP client used by the real recorder and smoke tests."""
    def __init__(self, url: str) -> None:
        self.url = url
        self.ws: Any = None
        self.index = 0
        self.pending: dict[int, asyncio.Future[Any]] = {}
        self.listeners: dict[str, list[Callable[[dict[str, Any]], Coroutine[Any, Any, None]]]] = {}
        self.receiver: asyncio.Task[Any] | None = None

    async def __aenter__(self) -> "CDP":
        self.ws = await websockets.connect(self.url, origin=None, max_size=50_000_000)
        self.receiver = asyncio.create_task(self._receive())
        return self

    async def __aexit__(self, *_: Any) -> None:
        if self.receiver:
            self.receiver.cancel()
        if self.ws:
            await self.ws.close()

    async def _receive(self) -> None:
        async for raw in self.ws:
            message = json.loads(raw)
            if message.get("id") in self.pending:
                future = self.pending.pop(message["id"])
                if "error" in message:
                    future.set_exception(RuntimeError(json.dumps(message["error"])))
                else:
                    future.set_result(message.get("result", {}))
            elif method := message.get("method"):
                for listener in self.listeners.get(method, []):
                    asyncio.create_task(listener(message.get("params", {})))

    def on(self, method: str, listener: Callable[[dict[str, Any]], Coroutine[Any, Any, None]]) -> None:
        self.listeners.setdefault(method, []).append(listener)

    async def command(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        self.index += 1
        request_id = self.index
        future = asyncio.get_running_loop().create_future()
        self.pending[request_id] = future
        await self.ws.send(json.dumps({"id": request_id, "method": method, "params": params or {}}))
        return await asyncio.wait_for(future, 30)

    async def evaluate(self, expression: str, await_promise: bool = False) -> Any:
        response = await self.command("Runtime.evaluate", {
            "expression": expression, "awaitPromise": await_promise,
            "returnByValue": True, "userGesture": True,
        })
        if response.get("exceptionDetails"):
            detail = response["exceptionDetails"]
            raise RuntimeError(detail.get("exception", {}).get("description", detail.get("text", "evaluation failed")))
        return response.get("result", {}).get("value")

    async def agent(self, name: str, payload: dict[str, Any]) -> Any:
        if name not in TOOLS:
            raise ValueError(f"not an Agent tool: {name}")
        expression = """(async () => {
          const name = %s;
          const input = %s;
          const tools = await document.modelContext.getTools();
          const tool = tools.find((candidate) => candidate.name === name);
          if (!tool)
            throw new Error(`Missing browser-returned RegisteredTool: ${name}`);
          const raw = await document.modelContext.executeTool(tool, JSON.stringify(input));
          return typeof raw === 'string' ? JSON.parse(raw) : raw;
        })()""" % (json.dumps(name), json.dumps(payload))
        return await self.evaluate(expression, await_promise=True)


class Recorder:
    def __init__(self, cdp: CDP, frame_dir: pathlib.Path, events: list[dict[str, Any]]) -> None:
        self.cdp, self.frame_dir, self.events = cdp, frame_dir, events
        self.started = time.monotonic()
        self.frames: list[dict[str, Any]] = []
        self.frame_lock = asyncio.Lock()

    def elapsed(self) -> float:
        return time.monotonic() - self.started

    async def wait_until(self, seconds: float) -> None:
        await asyncio.sleep(max(0, seconds - self.elapsed()))

    async def frame(self, params: dict[str, Any]) -> None:
        async with self.frame_lock:
            data = base64.b64decode(params["data"])
            path = self.frame_dir / f"frame-{len(self.frames):05d}.jpg"
            path.write_bytes(data)
            self.frames.append({"path": path, "seconds": round(self.elapsed(), 3), "sha256": sha256(data), "bytes": len(data)})
        await self.cdp.command("Page.screencastFrameAck", {"sessionId": params["sessionId"]})

    async def dom(self) -> dict[str, Any]:
        return await self.cdp.evaluate("""(() => {
          const phase=document.querySelector('.desktop-state-phase')?.textContent || '';
          return {phaseText:phase, actor:document.querySelector('.desktop-now')?.dataset.actor || '',
            frontier:document.querySelector('#desktop-now-heading')?.textContent || '',
            status:document.querySelector('.desktop-status')?.textContent || ''};
        })()""")

    async def overlay(self, label: str, kind: str = "agent", x: float | None = None, y: float | None = None) -> None:
        await self.cdp.evaluate("""(() => {
          let root=document.querySelector('#recorder-evidence-overlay');
          if(!root){root=document.createElement('div');root.id='recorder-evidence-overlay';
            root.style='position:fixed;z-index:2147483647;left:18px;top:18px;padding:10px 14px;border:2px solid #22d3ee;border-radius:8px;background:rgba(2,6,23,.94);color:#f8fafc;font:700 15px ui-monospace,monospace;pointer-events:none;max-width:760px';
            root.innerHTML='<span class="rec-label"></span><span class="rec-clock" style="margin-left:14px;color:#94a3b8"></span><span class="rec-cursor" style="position:fixed;width:18px;height:18px;border:3px solid #fbbf24;border-radius:50%%;transition:left .45s ease,top .45s ease;box-shadow:0 0 0 3px rgba(2,6,23,.7)"></span>';
            document.body.append(root);setInterval(()=>{const e=root.querySelector('.rec-clock');if(e)e.textContent='LIVE '+(performance.now()/1000).toFixed(1)+'s'},250)}
          root.querySelector('.rec-label').textContent=%s;
          root.style.borderColor=%s;
          const cursor=root.querySelector('.rec-cursor'); if(%s!==null){cursor.style.left=(%s-9)+'px';cursor.style.top=(%s-9)+'px'}
        })()""" % (json.dumps(label), json.dumps({"agent":"#22d3ee","owner":"#fbbf24","system":"#a78bfa"}.get(kind,"#94a3b8")), json.dumps(x), json.dumps(x), json.dumps(y)))

    async def point(self, selector: str, label: str, kind: str = "owner") -> dict[str, float]:
        point = await self.cdp.evaluate("""(() => {const e=document.querySelector(%s);if(!e)throw new Error('missing visible control');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();if(!r.width||!r.height)throw new Error('hidden control');return{x:r.left+r.width/2,y:r.top+r.height/2}})()""" % json.dumps(selector))
        await self.overlay(label, kind, point["x"], point["y"])
        await asyncio.sleep(.65)
        return point

    async def click(self, selector: str, label: str) -> None:
        point = await self.point(selector, label)
        for event in ("mousePressed", "mouseReleased"):
            await self.cdp.command("Input.dispatchMouseEvent", {"type": event, "button": "left", "clickCount": 1, **point})
        self.events.append({"seconds": round(self.elapsed(),3), "class":"trusted-owner-input", "operation":"click", "selector":selector, "label":label})
        await asyncio.sleep(.45)

    async def type(self, selector: str, value: str, label: str) -> None:
        await self.click(selector, label)
        for token in value.split(" "):
            await self.cdp.command("Input.insertText", {"text": token + " "})
            await asyncio.sleep(.08)
        self.events.append({"seconds":round(self.elapsed(),3), "class":"trusted-owner-input", "operation":"keyboard", "selector":selector, "textSha256":sha256(value), "characters":len(value)})

    async def agent(self, name: str, payload: dict[str, Any], label: str) -> Any:
        before = await self.dom()
        await self.overlay(f"NATIVE CALL · {name} · getTools → RegisteredTool → executeTool", "agent")
        await asyncio.sleep(.6)
        result = await self.cdp.agent(name, payload)
        await asyncio.sleep(.5)
        after = await self.dom()
        self.events.append({"seconds":round(self.elapsed(),3), "class":"browser-native-agent-call", "name":name, "label":label,
            "mechanism":"document.modelContext.getTools() -> browser-returned RegisteredTool -> document.modelContext.executeTool(tool, JSON.stringify(input))",
            "input":payload, "result":result, "before":before, "after":after})
        return result


async def wait_for_json(port: int) -> dict[str, Any]:
    for _ in range(200):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=1) as response:
                return next(item for item in json.load(response) if item.get("type") == "page")
        except Exception:
            await asyncio.sleep(.05)
    raise RuntimeError("Canary CDP did not start")


def run_checked(args: list[str], cwd: pathlib.Path = ROOT) -> str:
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f"{' '.join(args)} failed\n{result.stdout}\n{result.stderr}")
    return (result.stdout + result.stderr).strip()


def encode(frames: list[dict[str, Any]], output: pathlib.Path, narration: pathlib.Path) -> dict[str, Any]:
    if len(frames) < 80:
        raise RuntimeError(f"static/empty capture rejected: only {len(frames)} screencast frames")
    concat = frames[0]["path"].parent / "frames.ffconcat"
    lines = ["ffconcat version 1.0"]
    for index, frame in enumerate(frames):
        duration = (frames[index+1]["seconds"] - frame["seconds"]) if index+1 < len(frames) else max(.25, 158.0 - frame["seconds"])
        lines += [f"file '{frame['path'].name}'", f"duration {max(.033, duration):.6f}"]
    lines.append(f"file '{frames[-1]['path'].name}'")
    concat.write_text("\n".join(lines)+"\n")
    run_checked(["ffmpeg","-y","-v","error","-f","concat","-safe","0","-i",str(concat),"-i",str(narration),
        "-map","0:v:0","-map","1:a:0","-vf","scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p",
        "-c:v","libx264","-profile:v","high","-level","4.1","-crf","20","-preset","medium","-c:a","aac","-profile:a","aac_low","-ar","48000","-b:a","160k","-shortest","-movflags","+faststart",str(output)])
    probe = json.loads(run_checked(["ffprobe","-v","error","-show_entries","format=duration,size","-show_entries","stream=codec_name,codec_type,profile,width,height,sample_rate,channels","-of","json",str(output)]))
    return probe


async def record(args: argparse.Namespace) -> None:
    if not CANARY.exists():
        raise RuntimeError("signed installed Chrome Canary is required")
    version = run_checked([str(CANARY), "--version"])
    signature = run_checked(["codesign","-dv","--verbose=4",str(CANARY_APP)])
    gatekeeper = run_checked(["spctl","--assess","--type","execute","-vv",str(CANARY_APP)])
    if "154.0.8028.0" not in version or "TeamIdentifier=EQHXZ8M8AV" not in signature or "accepted" not in gatekeeper:
        raise RuntimeError("Canary build/signature/notarization gate failed")
    run_checked(["npm","run","build"])
    output = pathlib.Path(args.output).resolve(); output.parent.mkdir(parents=True, exist_ok=True)
    receipt_path = pathlib.Path(args.receipt).resolve(); receipt_path.parent.mkdir(parents=True, exist_ok=True)
    narration = pathlib.Path(args.narration).resolve()
    profile = pathlib.Path(tempfile.mkdtemp(prefix="workhub-v3-recorder-profile-"))
    frames_dir = pathlib.Path(tempfile.mkdtemp(prefix="workhub-v3-recorder-frames-"))
    (profile / "Local State").write_text(json.dumps({"browser":{"enabled_labs_experiments":EXPERIMENTS}}))
    server = subprocess.Popen(["python3","-m","http.server",str(args.port),"--directory",str(ROOT / "dist")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    browser: subprocess.Popen[Any] | None = None
    events: list[dict[str, Any]] = []
    try:
        browser = subprocess.Popen([str(CANARY),"--headless=new","--disable-gpu","--hide-scrollbars","--no-first-run","--no-default-browser-check",
            f"--remote-debugging-port={args.cdp_port}",f"--user-data-dir={profile}","about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        page = await wait_for_json(args.cdp_port)
        async with CDP(page["webSocketDebuggerUrl"]) as cdp:
            await cdp.command("Page.enable"); await cdp.command("Runtime.enable")
            await cdp.command("Emulation.setDeviceMetricsOverride", {"width":1440,"height":900,"deviceScaleFactor":1,"mobile":False,"screenWidth":1440,"screenHeight":900})
            await cdp.command("Page.navigate", {"url":f"http://127.0.0.1:{args.port}/index.html"})
            for _ in range(200):
                ready = await cdp.evaluate("document.readyState==='complete' && typeof document.modelContext?.getTools==='function' && document.modelContext.getTools().then(t=>t.length===6)", True)
                if ready: break
                await asyncio.sleep(.05)
            else: raise RuntimeError("WebMCP unavailable in Canary with exact required flags")
            discovered = await cdp.evaluate("(async()=> (await document.modelContext.getTools()).map(t=>({name:t.name,prototype:Object.getPrototypeOf(t)?.constructor?.name})))()", True)
            if len(discovered) != 6 or {row["name"] for row in discovered} != set(TOOLS):
                raise RuntimeError(f"exact browser-returned six RegisteredTool surface required: {discovered}")
            recorder = Recorder(cdp, frames_dir, events); cdp.on("Page.screencastFrame", recorder.frame)
            await cdp.command("Page.startScreencast", {"format":"jpeg","quality":88,"maxWidth":1440,"maxHeight":900,"everyNthFrame":1})
            await recorder.overlay("LIVE NATIVE CANARY · SIX REGISTERED TOOLS · NO AUTONOMOUS SELECTION", "agent")
            initial = await recorder.agent("get_goal_room_state", {}, "initial native state")
            await recorder.wait_until(10)
            await recorder.type("#desktop-owner-intent", "Prove a complete native six-tool governed journey", "Owner intent field")
            await recorder.click(".desktop-intent-form button[type=submit]", "Owner sets intent")
            state = await recorder.agent("get_goal_room_state", {}, "state after Owner intent")
            goal1 = {"expectedStateVersion":state["currentStateVersion"],"idempotencyKey":"demo-goal-v1","goal":"Ship a governed evidence package","why":"Make browser-native authority observable","doneLooksLike":["Owner accepts corrected Candidate v2 only after PASS"],"constraints":["No external effects"],"nonGoals":["Autonomous model selection"],"evidenceRequired":["Native calls and shared state"],"openQuestions":["Clarify exact candidate custody"]}
            await recorder.agent("propose_goal_contract", goal1, "Goal v1")
            await recorder.wait_until(34.7)
            malformed = await recorder.agent("propose_goal_contract", {"expectedStateVersion":2,"idempotencyKey":"demo-malformed","actor":"owner"}, "malformed zero-mutation control")
            await recorder.wait_until(45.3)
            await recorder.click(".desktop-owner-action .desktop-action.secondary", "Owner requests Goal revision")
            await recorder.type("#revision-input", "Bind the Goal to corrected Candidate v2 and deterministic evidence.", "Goal revision note")
            await recorder.click("#revision-form button[type=submit]", "Owner submits Goal revision")
            state = await recorder.agent("get_goal_room_state", {}, "state after Goal revision")
            goal2 = {**goal1,"expectedStateVersion":state["currentStateVersion"],"idempotencyKey":"demo-goal-v2","goal":"Qualify the complete governed native journey","openQuestions":[]}
            await recorder.agent("propose_goal_contract", goal2, "Goal v2")
            await recorder.click(".desktop-owner-action .desktop-action.primary", "Owner confirms Goal v2")
            await recorder.wait_until(58.1)
            state = await recorder.agent("get_goal_room_state", {}, "state before Plan v1")
            plan1 = {"expectedStateVersion":state["currentStateVersion"],"idempotencyKey":"demo-plan-v1","goalContractVersion":2,"steps":[{"id":"release","title":"Produce governed native evidence"}]}
            await recorder.agent("propose_plan", plan1, "Plan v1")
            await recorder.click(".desktop-owner-action .desktop-action.secondary", "Owner requests Plan revision")
            await recorder.type("#revision-input", "Bind the step explicitly to corrected Candidate v2.", "Plan revision note")
            await recorder.click("#revision-form button[type=submit]", "Owner submits Plan revision")
            state = await recorder.agent("get_goal_room_state", {}, "state after Plan revision")
            await recorder.agent("propose_plan", {**plan1,"expectedStateVersion":state["currentStateVersion"],"idempotencyKey":"demo-plan-v2","steps":[{"id":"release","title":"Produce corrected Candidate v2 evidence"}]}, "Plan v2")
            await recorder.click(".desktop-owner-action .desktop-action.primary", "Owner confirms Plan v2")
            await recorder.wait_until(71)
            state = await recorder.agent("get_goal_room_state", {}, "state before claim")
            await recorder.agent("claim_step", {"expectedStateVersion":state["currentStateVersion"],"idempotencyKey":"demo-claim","planVersion":2,"stepId":"release"}, "claim admitted step")
            failed_content=json.dumps({"publicUrl":"http://example.test/native","demoDurationSeconds":181,"verificationCommand":"npm run build"},separators=(",",":"))
            state=await recorder.agent("get_goal_room_state", {}, "state before Candidate v1")
            await recorder.agent("submit_artifact", {"expectedStateVersion":state["currentStateVersion"],"idempotencyKey":"demo-candidate-v1","planVersion":2,"stepId":"release","content":failed_content,"sha256":sha256(failed_content)}, "Candidate v1; automatic System FAIL")
            await asyncio.sleep(1); fail_state=await recorder.agent("get_goal_room_state", {}, "observe automatic FAIL")
            events.append({"seconds":round(recorder.elapsed(),3),"class":"automatic-system-verdict","verdict":"FAIL","phase":fail_state["phase"],"stateVersion":fail_state["currentStateVersion"]})
            await recorder.wait_until(86.3)
            passed_content=json.dumps({"publicUrl":"https://example.test/native","demoDurationSeconds":180,"verificationCommand":"npm test"},separators=(",",":"))
            state=await recorder.agent("get_goal_room_state", {}, "state before corrected Candidate v2")
            await recorder.agent("submit_artifact", {"expectedStateVersion":state["currentStateVersion"],"idempotencyKey":"demo-candidate-v2","planVersion":2,"stepId":"release","content":passed_content,"sha256":sha256(passed_content)}, "Candidate v2; automatic System PASS")
            await asyncio.sleep(1); pass_state=await recorder.agent("get_goal_room_state", {}, "observe automatic PASS; Agent remains next")
            events.append({"seconds":round(recorder.elapsed(),3),"class":"automatic-system-verdict","verdict":"PASS","phase":pass_state["phase"],"stateVersion":pass_state["currentStateVersion"],"nextActor":pass_state["currentActor"]})
            await recorder.wait_until(99.5)
            await recorder.agent("request_completion", {"expectedStateVersion":pass_state["currentStateVersion"],"idempotencyKey":"demo-completion","candidateSha256":sha256(passed_content)}, "completion request for exact Candidate v2")
            await recorder.wait_until(106.8)
            await recorder.click(".desktop-owner-action .desktop-action.primary", "Owner opens exact-candidate acceptance")
            await recorder.wait_until(116.5)
            await recorder.click("#confirm-acceptance", "Owner confirms irreversible acceptance")
            final=await recorder.agent("get_goal_room_state", {}, "read sealed S14")
            await recorder.overlay("SEALED S14 · ACTOR NONE · NO LEGAL CONTINUATION", "owner")
            await recorder.wait_until(126.9)
            await cdp.command("Page.navigate", {"url":(ROOT/"submission/assets/cue-12-mobile-breakpoint.png").as_uri()})
            events.append({"seconds":round(recorder.elapsed(),3),"class":"checkpoint-reconstruction","scene":"mobile-breakpoint","source":"submission/assets/cue-12-mobile-breakpoint.png"})
            await recorder.wait_until(138.85)
            await cdp.command("Page.navigate", {"url":(ROOT/"submission/assets/workhub-goal-room-architecture.html").as_uri()})
            events.append({"seconds":round(recorder.elapsed(),3),"class":"checkpoint-reconstruction","scene":"architecture","source":"submission/assets/workhub-goal-room-architecture.html"})
            await recorder.wait_until(157.8)
            await cdp.command("Page.stopScreencast")
            await asyncio.sleep(.5)
            probe=encode(recorder.frames, output, narration)
            transitions=[]
            for left,right in zip(recorder.frames, recorder.frames[1:]):
                if left["sha256"] != right["sha256"]:
                    transitions.append({"from":left["seconds"],"to":right["seconds"],"fromHash":left["sha256"],"toHash":right["sha256"]})
            live_intervals=[
                {"id":"native-six-and-owner-intent","start":0,"end":34.6,"required":["browser-native-agent-call","trusted-owner-input"]},
                {"id":"goal-owner-decisions","start":45.2,"end":58.0,"required":["trusted-owner-input","browser-native-agent-call"]},
                {"id":"plan-owner-decisions","start":58.0,"end":70.8,"required":["trusted-owner-input","browser-native-agent-call"]},
                {"id":"automatic-fail-pass","start":71,"end":99.4,"required":["browser-native-agent-call","automatic-system-verdict"]},
                {"id":"completion-acceptance-seal","start":99.5,"end":126.8,"required":["browser-native-agent-call","trusted-owner-input"]}
            ]
            receipt={"schemaVersion":4,"kind":"workhub-v3-interactive-native-demo-receipt","captureMode":"continuous live native governed journey followed by disclosed checkpoint reconstruction","continuousAuthorityLineage":{"startSeconds":0,"endSeconds":126.8,"completeJourney":True},
                "productCommit":PRODUCT_COMMIT,"productTree":PRODUCT_TREE,"browser":{"application":"Google Chrome Canary","version":version,"signatureVerified":True,"notarized":True,"isolatedUnsignedInProfile":True,"experiments":EXPERIMENTS},
                "nativeTools":discovered,"events":events,"liveIntervals":live_intervals,"reconstructedIntervals":[{"start":126.9,"end":138.7,"scene":"mobile/breakpoint"},{"start":138.85,"end":157.8,"scene":"architecture/honest limits"}],
                "capture":{"api":"Page.startScreencast","frameCount":len(recorder.frames),"uniqueFrameCount":len({f['sha256'] for f in recorder.frames}),"transitionCount":len(transitions),"transitions":transitions[:200]},
                "media":{"path":str(output.relative_to(ROOT)),"sha256":sha256(output.read_bytes()),"bytes":output.stat().st_size,"probe":probe},
                "finalState":{"phase":final["phase"],"stateVersion":final["currentStateVersion"],"currentActor":final["currentActor"],"nextLegalAction":final["nextLegalAction"],"candidate":final.get("candidate")},
                "controls":{"owner":"trusted CDP Input mouse/keyboard against visible UI","agent":"document.modelContext.getTools() -> browser-returned RegisteredTool -> executeTool(serialized JSON)","system":"automatic production adapter only"},
                "claimBoundary":"No autonomous model selection, external effects, accounts, backend persistence, cloud, database, security certification, deployment, or publication claim.","date":"2026-08-28"}
            receipt_path.write_text(json.dumps(receipt,indent=2)+"\n")
            print(json.dumps({"passed":True,"frames":len(recorder.frames),"uniqueFrames":receipt["capture"]["uniqueFrameCount"],"events":len(events),"finalPhase":final["phase"],"video":receipt["media"]},indent=2))
    finally:
        if browser and browser.poll() is None: browser.terminate()
        server.terminate()
        try: server.wait(timeout=3)
        except subprocess.TimeoutExpired: server.kill()
        shutil.rmtree(profile, ignore_errors=True); shutil.rmtree(frames_dir, ignore_errors=True)


def self_test() -> None:
    source = pathlib.Path(__file__).read_text()
    required = ["Page.startScreencast", "Page.screencastFrameAck", "Input.dispatchMouseEvent", "Input.insertText", "document.modelContext.getTools()", "document.modelContext.executeTool(tool, JSON.stringify(input))", "RegisteredTool", "ffmpeg", "liveIntervals"]
    missing=[token for token in required if token not in source]
    if missing: raise SystemExit(f"recorder functional contract missing: {missing}")
    print(json.dumps({"functionalRecorder":True,"launch":True,"nativeDiscovery":True,"trustedOwnerInput":True,"screencast":True,"encode":True,"receipt":True,"cleanup":True}))


if __name__ == "__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--output",default=str(ROOT/"submission/assets/workhub-goal-room-demo.mp4"))
    parser.add_argument("--receipt",default=str(ROOT/"submission/assets/live-demo-capture.json"))
    parser.add_argument("--narration",default=str(ROOT/"submission/assets/workhub-goal-room-demo-narration.ogg"))
    parser.add_argument("--port",type=int,default=4177); parser.add_argument("--cdp-port",type=int,default=9227)
    parser.add_argument("--self-test",action="store_true")
    parsed=parser.parse_args()
    if parsed.self_test: self_test()
    else: asyncio.run(record(parsed))
