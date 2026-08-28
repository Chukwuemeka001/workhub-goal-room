import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const evidence = join(root, "evaluation", "desktop-phase6");
const port = 4179;
const origin = `http://127.0.0.1:${port}`;
const chromePath = [process.env.CHROME_BIN, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", `${process.env.HOME}/Applications/BrowserOS.app/Contents/MacOS/BrowserOS`].find((candidate) => candidate && existsSync(candidate));
if (!chromePath) throw new Error("Set CHROME_BIN to a Chromium-compatible browser executable");
const profile = await mkdtemp(join(tmpdir(), "workhub-desktop-qa-"));
let server; let chrome;
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
async function waitFor(predicate, label, attempts = 120) { for (let i=0;i<attempts;i+=1) { try { const value=await predicate(); if(value)return value; } catch {} await wait(50); } throw new Error(`Timed out waiting for ${label}`); }

try {
  await mkdir(evidence, { recursive: true });
  server = spawn("npm", ["run","dev","--","--host","127.0.0.1","--port",String(port),"--strictPort"], { cwd: root, stdio: "ignore" });
  await waitFor(async()=> (await fetch(`${origin}/qa/desktop-fixture.html`)).ok, "Vite");
  chrome = spawn(chromePath,["--headless=new","--disable-gpu","--disable-extensions","--disable-component-extensions-with-background-pages","--hide-scrollbars","--remote-debugging-port=0",`--user-data-dir=${profile}`,"about:blank"],{stdio:"ignore"});
  const activePort = await waitFor(async()=> (await readFile(join(profile,"DevToolsActivePort"),"utf8")).split("\n")[0],"Chrome DevTools");
  const tabs = await (await fetch(`http://127.0.0.1:${activePort}/json`)).json();
  const socket = new WebSocket(tabs[0].webSocketDebuggerUrl);
  await new Promise((resolveOpen,reject)=>{socket.addEventListener("open",resolveOpen,{once:true});socket.addEventListener("error",reject,{once:true});});
  let nextId=0; const pending=new Map();
  socket.addEventListener("message",event=>{const message=JSON.parse(event.data);if(!message.id)return;const request=pending.get(message.id);if(!request)return;pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);});
  const call=(method,params={})=>new Promise((resolveCall,reject)=>{const id=++nextId;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},15000);pending.set(id,{resolve:resolveCall,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  await call("Page.enable"); await call("Runtime.enable");
  async function navigate(url,width,height,qa=true){await call("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:false,screenWidth:width,screenHeight:height});await call("Page.navigate",{url});await waitFor(async()=>{const result=await call("Runtime.evaluate",{expression:`document.readyState==='complete' && ${qa?"Boolean(window.__desktopQa)":"true"}`,returnByValue:true});return result.result.value;},url);}
  async function evaluate(expression){const result=await call("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);return result.result.value;}
  async function screenshot(path){const result=await call("Page.captureScreenshot",{format:"png",fromSurface:true,captureBeyondViewport:false});await writeFile(path,Buffer.from(result.data,"base64"));}
  async function pressKey(key,code){const vk=key==="Home"?36:key==="End"?35:key==="ArrowLeft"?37:key==="Enter"?13:key===" "?32:39;await call("Input.dispatchKeyEvent",{type:"keyDown",key,code,windowsVirtualKeyCode:vk});await call("Input.dispatchKeyEvent",{type:"keyUp",key,code,windowsVirtualKeyCode:vk});}

  const states=["goal","plan","fail","pass","completion","accepted","max"];
  const viewports=[[1440,900],[1280,800],[1728,1117]];
  const measurements=[];
  for(const [width,height] of viewports) for(const state of states){await navigate(`${origin}/qa/desktop-fixture.html?state=${state}`,width,height);measurements.push(await evaluate("window.__desktopQa.measurements()"));}
  for(const state of ["goal","plan","fail","pass","completion","accepted"]){await navigate(`${origin}/qa/desktop-fixture.html?state=${state}`,1440,900);await screenshot(join(evidence,`${state}-1440x900.png`));}

  await navigate(`${origin}/qa/desktop-fixture.html?state=goal`,1440,900);
  const authorityBefore=await evaluate("JSON.stringify(window.__desktopQa.view)");
  await evaluate("document.querySelector('#desktop-tab-goal').focus()");
  const keyboardSequence=[];
  const readKeyboard=async(key)=>keyboardSequence.push(await evaluate(`({key:${JSON.stringify(key)},focusedTabId:document.activeElement?.id??null,selectedTab:window.__desktopQa.selectedTab(),panelBinding:document.querySelector('[role=tabpanel]')?.getAttribute('aria-labelledby')??null,authorityStable:JSON.stringify(window.__desktopQa.view)===${JSON.stringify(authorityBefore)},ownerCalls:window.__desktopQa.ownerCalls()})`));
  await readKeyboard("initial");
  for(const [key,code,label] of [["ArrowRight","ArrowRight","ArrowRight"],["End","End","End"],["ArrowRight","ArrowRight","ArrowRight"],["ArrowLeft","ArrowLeft","ArrowLeft"],["Home","Home","Home"],["Enter","Enter","Enter"],[" ","Space","Space"]]){await pressKey(key,code);await readKeyboard(label);}
  const keyboardEvents=await evaluate("window.__desktopQa.keyboardEvents()");

  await navigate(`${origin}/`,1440,900,false);
  const productionSmoke=await evaluate(`({desktopVisible:getComputedStyle(document.querySelector('.desktop-surface')).display!=='none',mobileHidden:getComputedStyle(document.querySelector('.mobile-room')).display==='none',goalTitle:document.querySelector('.desktop-goal-identity h1')?.textContent,ownerIntent:Boolean(document.querySelector('#desktop-owner-intent')),tabCount:document.querySelectorAll('.desktop-tab').length,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth})`);

  const expected=[["desktop-tab-goal","goal","desktop-tab-goal"],["desktop-tab-plan","plan","desktop-tab-plan"],["desktop-tab-activity","activity","desktop-tab-activity"],["desktop-tab-goal","goal","desktop-tab-goal"],["desktop-tab-activity","activity","desktop-tab-activity"],["desktop-tab-goal","goal","desktop-tab-goal"],["desktop-tab-goal","goal","desktop-tab-goal"],["desktop-tab-goal","goal","desktop-tab-goal"]];
  const failures=measurements.filter(entry=>entry.documentOverflow!==0||entry.bodyOverflow!==0||entry.rootOverflow!==0||!entry.controlsWithinHorizontalBounds||entry.minControlHeight<44||entry.controlCollisions!==0||!entry.frontierDominant||!entry.inspector.visible||!entry.lifecycleVisible||(entry.state!=="max"&&!entry.lifecycleAboveFold)||!entry.desktopVisible||!entry.mobileHidden||!entry.authoritativeWraps||!entry.hostileLiteral||entry.injectedElements!==0);
  if(keyboardSequence.some((entry,index)=>entry.focusedTabId!==expected[index][0]||entry.selectedTab!==expected[index][1]||entry.panelBinding!==expected[index][2]||!entry.authorityStable||entry.ownerCalls.length!==0)||keyboardEvents.length!==7||keyboardEvents.some((entry,index)=>!entry.trusted||(index<5?!entry.defaultPrevented:entry.defaultPrevented)))failures.push({keyboardSequence,keyboardEvents});
  if(!productionSmoke.desktopVisible||!productionSmoke.mobileHidden||productionSmoke.goalTitle!=="Goal not yet admitted"||!productionSmoke.ownerIntent||productionSmoke.tabCount!==4||productionSmoke.overflow!==0)failures.push({productionSmoke});
  await writeFile(join(evidence,"measurements.json"),`${JSON.stringify({generatedBy:"npm run qa:desktop",measurements,keyboardSequence,keyboardEvents,productionSmoke,failures},null,2)}\n`);
  const contact=`<!doctype html><style>body{margin:0;background:#050607;color:#eee;font:14px system-ui}main{display:grid;grid-template-columns:repeat(3,456px);gap:18px;padding:18px}figure{margin:0}img{display:block;width:456px;height:285px;object-fit:cover;object-position:top;border:1px solid #333}figcaption{padding:6px 0 0}</style><main>${["goal","plan","fail","pass","completion","accepted"].map(state=>`<figure><img src="/evaluation/desktop-phase6/${state}-1440x900.png"><figcaption>${state}</figcaption></figure>`).join("")}</main>`;
  await writeFile(join(evidence,"contact-sheet.html"),contact);await navigate(`${origin}/evaluation/desktop-phase6/contact-sheet.html`,1440,660,false);await screenshot(join(evidence,"contact-sheet.png"));
  socket.close();
  if(failures.length)throw new Error(`Desktop QA failed ${failures.length} rows`);
  console.log(JSON.stringify({states:states.length,viewportRows:measurements.length,keyboardSteps:keyboardSequence.length,screenshots:7,failures:0,evidence},null,2));
} finally {
  server?.kill("SIGTERM");chrome?.kill("SIGTERM");await wait(100);for(const child of [server,chrome].filter(Boolean))if(child.exitCode===null)child.kill("SIGKILL");for(let attempt=0;attempt<5;attempt+=1){try{await rm(profile,{recursive:true,force:true});break;}catch(error){if(attempt===4)throw error;await wait(100);}}
}
