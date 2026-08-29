#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { SOURCE_COMMIT, SOURCE_TREE, CAPTURE_DATE, RECORDER_SHA256, SCREENSHOTS, CUES, REQUIRED_ARTIFACTS, RECONSTRUCTED_INTERVALS, VIDEO_DISCLOSURE } from './submission-v3-contract.mjs';

const root = process.cwd();
const failures = [];
const ok = (condition, message) => { if (!condition) failures.push(message); };
const text = async (path) => readFile(resolve(root, path), 'utf8');
const json = async (path) => JSON.parse(await text(path));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const exists = async (path) => { try { await stat(resolve(root, path)); return true; } catch { return false; } };
const git = (args, encoding = 'utf8') => spawnSync('git', args, { cwd: root, encoding, maxBuffer: 50 * 1024 * 1024 });
const prebind = process.argv.slice(2).length === 1 && process.argv[2] === '--prebind';
ok(prebind || process.argv.length === 2, 'only supported option is --prebind');
const tools = ['get_goal_room_state','propose_goal_contract','propose_plan','claim_step','submit_artifact','request_completion'];
const currentDocs = ['README.md','submission/DEVPOST_SUBMISSION.md','submission/DEMO_SCRIPT.md','submission/V3_REQUIREMENTS.md','submission/V3_CLAIMS.md','submission/V3_AUDIT.md'];
const historicalOriginalPaths = [
  'submission/DEMO_SCRIPT.md','submission/DEVPOST_SUBMISSION.md','submission/PHASE7_AUDIT.md','submission/PHASE7_CLAIMS.md','submission/PHASE7_REQUIREMENTS.md','submission/assets/live-demo-capture.json',
  'submission/assets/screenshots/01-plan-owner-gate.png','submission/assets/screenshots/02-plan-confirmed.png','submission/assets/screenshots/03-step-claimed.png','submission/assets/screenshots/04-candidate-v1.png','submission/assets/screenshots/05-verification-failed.png','submission/assets/screenshots/06-candidate-v2.png','submission/assets/screenshots/07-verification-passed.png','submission/assets/screenshots/08-completion-requested.png','submission/assets/screenshots/09-goal-accepted.png','submission/assets/screenshots/10-receipt-history.png','submission/assets/screenshots/manifest.json','submission/assets/workhub-goal-room-architecture.html','submission/assets/workhub-goal-room-architecture.png','submission/assets/workhub-goal-room-architecture.svg','submission/assets/workhub-goal-room-demo-narration.ogg','submission/assets/workhub-goal-room-demo.en.srt','submission/assets/workhub-goal-room-demo.mp4','submission/scripts/record-live-demo.py','submission/scripts/v3-native-webmcp-proof.mjs'
];

// 1. Exact historical custody and inventory.
const historical = await json('submission/historical/v2-five-tool/manifest.json');
ok(historical?.schemaVersion === 1 && historical?.claimClass === 'historical-v2-five-tool' && historical?.productCommit === SOURCE_COMMIT && historical?.productTree === SOURCE_TREE && historical?.captureDate === CAPTURE_DATE, 'historical manifest identity/source/date');
ok(Array.isArray(historical?.entries) && historical.entryCount === 25 && historical.entries.length === 25, 'historical entries.length=entryCount=25');
ok(new Set(historical.entries?.map((entry) => entry.originalPath)).size === 25, 'historical original paths unique');
ok(JSON.stringify(historical.entries?.map((entry) => entry.originalPath)) === JSON.stringify(historicalOriginalPaths), 'historical exact original inventory/order');
for (const entry of historical.entries ?? []) {
  ok(entry && typeof entry.originalPath === 'string' && typeof entry.historicalPath === 'string' && Number.isInteger(entry.bytes) && /^[0-9a-f]{64}$/.test(entry.sha256), `historical entry shape ${JSON.stringify(entry)}`);
  if (!entry?.historicalPath) continue;
  const bytes = await readFile(resolve(root, entry.historicalPath));
  ok(bytes.length === entry.bytes && digest(bytes) === entry.sha256, `historical hash ${entry.historicalPath}`);
  const source = git(['show', `${SOURCE_COMMIT}:${entry.originalPath}`], null);
  ok(source.status === 0 && Buffer.compare(source.stdout, bytes) === 0, `historical source-product parity ${entry.originalPath}`);
}

// 2. Current six-tool truth and bounded claims.
const docs = (await Promise.all(currentDocs.map(text))).join('\n');
const stale = [/exactly five/i,/five WebMCP/i,/Discovers 5/i,/\b90\/90\b/i,/ninety tests/i,/e5740dc/i,/8a174561/i,/nine immutable receipts/i,/six-stage lifecycle/i,/current.{0,20}Phase 7/i];
for (const pattern of stale) ok(!pattern.test(docs), `stale current token ${pattern}`);
const readme = await text('README.md');
const devpost = await text('submission/DEVPOST_SUBMISSION.md');
const claims = await text('submission/V3_CLAIMS.md');
const demoScript = await text('submission/DEMO_SCRIPT.md');
ok(readme.includes(VIDEO_DISCLOSURE.readme), 'README exact continuous-live/reconstructed-tail disclosure');
ok(devpost.includes(VIDEO_DISCLOSURE.devpost), 'Devpost exact continuous-live/reconstructed-tail disclosure');
ok(claims.includes(VIDEO_DISCLOSURE.claims), 'claims exact continuous-live/reconstructed-tail disclosure');
ok(demoScript.includes(VIDEO_DISCLOSURE.demoScript), 'demo script exact continuous-live/reconstructed-tail disclosure');
for (const pattern of [/does not (?:depict|claim) one continuous authority transaction/i, /video is (?:explicitly )?(?:a )?(?:disclosed )?fresh-checkpoint reconstruction/i, /narrated evidence reconstruction/i]) ok(!pattern.test(docs), `false whole-video reconstruction wording ${pattern}`);
for (const tool of tools) ok(devpost.includes(`\`${tool}\``), `Devpost missing tool ${tool}`);
ok(devpost.includes('exactly six') && devpost.includes('PASS does not mean accepted.'), 'six-tool/nonacceptance copy');

// 3. Prior qualification truth.
const production = await json('evaluation/production-journey/qualification-receipt.json');
const native = await json('evaluation/native-webmcp-v3/native-webmcp-receipt.json');
const phase5 = await json('evaluation/phase5-qualification.json');
const journey = await json('evaluation/production-journey/journey.json');
ok(production?.results?.checkpoints === 12 && production?.results?.receipts === 22 && production?.results?.finalPhase === 'GOAL_ACCEPTED', 'production summary');
ok(native?.descriptors?.length === 6 && native?.browserEnumerationOrder?.length === 6 && native?.registrationOrder?.length === 6, 'native exact six');
ok(new Set(native.descriptors?.map(({name}) => name)).size === 6 && tools.every((name) => native.descriptors.some((row) => row.name === name)), 'native tool names');
ok(native?.browser?.version === 'Google Chrome 154.0.8028.0 canary', 'native Canary build');
ok(phase5?.findings?.P0 === 0 && phase5?.findings?.P1 === 0 && phase5?.security?.externalEffects === false, 'Phase 5 evidence boundary');
const terminal = journey.checkpoints?.find(({label}) => label === 'sealed-s14');
ok(terminal?.currentActor === 'none' && terminal?.nextLegalAction === 'GOAL_ACCEPTED_NO_FURTHER_ACTION', 'S14 sealed frontier');

// 4. Screenshot provenance, dimensions, actor/frontier mapping, and source receipt.
const screenshotManifestPath = 'submission/assets/screenshots/manifest.json';
const shots = await json(screenshotManifestPath);
const canonicalShotFrames = SCREENSHOTS.map(({sourceObjectPath: _sourceObjectPath, ...frame}) => frame);
const immutableProductionReceiptRun = git(['show', `${SOURCE_COMMIT}:evaluation/production-journey/qualification-receipt.json`]);
let immutableProductionReceipt = {}; try { immutableProductionReceipt = JSON.parse(immutableProductionReceiptRun.stdout); } catch {}
ok(immutableProductionReceiptRun.status === 0, 'immutable production screenshot receipt');
const immutableReceiptShots = new Map((immutableProductionReceipt.screenshotHashes ?? []).map((row) => [row.path, row]));
ok(shots?.schemaVersion === 3 && shots?.frameCount === 10 && shots?.frames?.length === 10 && new Set(shots.frames.map(({path}) => path)).size === 10, 'screenshot exact unique count');
ok(JSON.stringify(shots.frames) === JSON.stringify(canonicalShotFrames), 'screenshot exact validator-owned manifest contract');
for (const contract of SCREENSHOTS) {
  const frame = shots.frames?.find(({path}) => path === contract.path);
  ok(Boolean(frame), `missing screenshot ${contract.path}`); if (!frame) continue;
  const bytes = await readFile(resolve(dirname(resolve(root,screenshotManifestPath)),frame.path));
  ok(bytes.length === contract.bytes && digest(bytes) === contract.sha256 && bytes.readUInt32BE(16) === contract.width && bytes.readUInt32BE(20) === contract.height, `screenshot canonical bytes/dimensions ${frame.path}`);
  ok(await exists(contract.sourceReceipt), `screenshot source receipt ${frame.path}`);
  if (contract.sourceObjectPath) {
    const receiptRow = immutableReceiptShots.get(contract.sourceObjectPath);
    ok(receiptRow?.sha256 === contract.sha256 && receiptRow?.bytes === contract.bytes && receiptRow?.width === contract.width && receiptRow?.height === contract.height, `screenshot immutable receipt mapping ${frame.path}`);
    const sourceObject = git(['show', `${SOURCE_COMMIT}:${contract.sourceObjectPath}`], null);
    ok(sourceObject.status === 0 && sourceObject.stdout.length === contract.bytes && digest(sourceObject.stdout) === contract.sha256 && Buffer.compare(sourceObject.stdout, bytes) === 0, `screenshot immutable product object parity ${frame.path}`);
  }
}

// 5. Architecture semantic edges and representation parity.
const edgeSpec = await json('submission/assets/workhub-goal-room-architecture.edges.json');
const expectedEdges = [
 ['edge-owner-ui-kernel','owner-ui','authority-kernel','owner'],['edge-agent-tools-kernel','six-webmcp-tools','authority-kernel','agent'],['edge-kernel-verifier','authority-kernel','production-verifier-adapter','system'],['edge-verifier-rules','production-verifier-adapter','deterministic-rules','system'],['edge-rules-kernel','deterministic-rules','authority-kernel','system'],['edge-agent-completion-kernel','agent-completion-request','authority-kernel','agent'],['edge-owner-acceptance-kernel','owner-acceptance','authority-kernel','owner']
];
ok(edgeSpec?.schemaVersion === 1 && edgeSpec?.kind === 'workhub-goal-room-authority-edge-spec', 'architecture edge spec identity');
ok(JSON.stringify(edgeSpec?.colors) === JSON.stringify({agent:'#22d3ee',system:'#a78bfa',owner:'#fbbf24'}), 'architecture frozen authority colors');
ok(JSON.stringify(edgeSpec?.edges?.map(({id,from,to,authority}) => [id,from,to,authority])) === JSON.stringify(expectedEdges), 'architecture exact semantic edge list');
const svg = await text('submission/assets/workhub-goal-room-architecture.svg');
const html = await text('submission/assets/workhub-goal-room-architecture.html');
for (const [id,from,to,authority] of expectedEdges) {
  const fragment = `id="${id}" data-from="${from}" data-to="${to}" data-authority="${authority}"`;
  ok(svg.includes(fragment) && html.includes(fragment), `architecture edge parity ${id}`);
  ok(svg.includes(`${fragment} d=`) && new RegExp(`id="${id}"[^>]+class="${authority}"[^>]+marker-end="url\\(#${authority}Arrow\\)"`).test(svg), `architecture edge color/arrow ${id}`);
}
ok(!/data-from="authority-kernel" data-to="deterministic-rules" data-authority="agent"/.test(svg), 'no Agent kernel-to-rules bypass');
ok(!/data-to="owner-acceptance"/.test(svg), 'no PASS/System/Agent direct acceptance edge');
const htmlSvg = html.slice(html.indexOf('<svg'), html.indexOf('</svg>') + 6);
ok(htmlSvg === svg.trim(), 'architecture HTML/SVG exact representation parity');
const png = await readFile(resolve(root,'submission/assets/workhub-goal-room-architecture.png'));
ok(png.readUInt32BE(16) === 1600 && png.readUInt32BE(20) === 1000 && digest(png) === '64f65ce10a2e7f0cab463fb077bb652d19ce039c0652c8bfb13a493a565fe096', 'architecture frozen rendered PNG');

// 6. Recorder exact source plus structural and controlled executable smoke.
const recorderPath = 'submission/scripts/record-live-demo.py';
const recorder = await text(recorderPath);
ok(digest(Buffer.from(recorder)) === RECORDER_SHA256, 'recorder exact validator-owned SHA-256');
const astProgram = `import ast,json,sys\nt=ast.parse(open(sys.argv[1],encoding='utf8').read())\nclasses={n.name for n in ast.walk(t) if isinstance(n,ast.ClassDef)}\nfuncs={n.name for n in ast.walk(t) if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))}\nattrs={n.attr for n in ast.walk(t) if isinstance(n,ast.Attribute)}\nprint(json.dumps({'classes':sorted(classes),'functions':sorted(funcs),'attributes':sorted(attrs)}))`;
const astRun = spawnSync('python3',['-c',astProgram,resolve(root,recorderPath)],{cwd:root,encoding:'utf8'});
let ast = {}; try { ast=JSON.parse(astRun.stdout); } catch {}
ok(astRun.status === 0 && ['CDP','Recorder'].every((name)=>ast.classes?.includes(name)) && ['record','encode','frame','agent','click','type'].every((name)=>ast.functions?.includes(name)) && ['Popen','terminate','read_bytes','write_text'].every((name)=>ast.attributes?.includes(name)), 'recorder AST structural contract');
const recorderSmoke = spawnSync('python3',[resolve(root,recorderPath),'--self-test'],{cwd:root,encoding:'utf8'});
let recorderCapabilities = {}; try { recorderCapabilities=JSON.parse(recorderSmoke.stdout); } catch {}
ok(recorderSmoke.status === 0 && recorderCapabilities.controlledPaths === true && ['functionalRecorder','launch','nativeDiscovery','trustedOwnerInput','screencast','encode','receipt','cleanup'].every((key) => recorderCapabilities[key] === true), 'recorder controlled executable behavior smoke');
for (const pattern of [/descriptor\.execute/i,/tool\.execute\s*\(/i,/__phase7Exec/i,/advance-demo/i,/replayGoalRoom/i,/recordVerification/i,/acceptGoal/i,/ownerController/i,/systemVerifierAdapter\./i]) ok(!pattern.test(recorder), `forbidden recorder path ${pattern}`);

// 7. Media codec/decode/audio/black frame checks.
const mediaPath = 'submission/assets/workhub-goal-room-demo.mp4'; const media = resolve(root,mediaPath);
const probeRun = spawnSync('ffprobe',['-v','error','-show_entries','format=duration,size','-show_entries','stream=codec_name,codec_type,profile,width,height,sample_rate,channels','-of','json',media],{encoding:'utf8'});
ok(probeRun.status === 0, 'ffprobe'); const probe = probeRun.status === 0 ? JSON.parse(probeRun.stdout) : {streams:[],format:{duration:0}}; const duration=Number(probe.format.duration);
ok(duration > 153.2 && duration < 180, 'video duration contains all cues under 180s');
ok(probe.streams.some((s) => s.codec_type==='video' && s.codec_name==='h264' && s.profile==='High' && s.width===1440 && s.height===900), 'H.264 High 1440x900');
ok(probe.streams.some((s) => s.codec_type==='audio' && s.codec_name==='aac' && s.profile==='LC' && s.sample_rate==='48000'), 'AAC-LC 48kHz');
ok(spawnSync('ffmpeg',['-v','error','-i',media,'-f','null','-']).status === 0, 'full media decode');
const black = spawnSync('ffmpeg',['-v','info','-i',media,'-vf','blackdetect=d=0.4:pix_th=0.05','-an','-f','null','-'],{encoding:'utf8',maxBuffer:20*1024*1024});
ok(black.status===0 && !/black_start:/.test(black.stderr), 'no black frames >=0.4s');
const volume = spawnSync('ffmpeg',['-v','info','-i',media,'-af','volumedetect','-vn','-f','null','-'],{encoding:'utf8',maxBuffer:20*1024*1024});
const meanVolume=Number(volume.stderr.match(/mean_volume:\s*(-?[0-9.]+)/)?.[1]); const maxVolume=Number(volume.stderr.match(/max_volume:\s*(-?[0-9.]+)/)?.[1]);
ok(Number.isFinite(meanVolume) && meanVolume > -35 && Number.isFinite(maxVolume) && maxVolume <= 0 && maxVolume > -12, `usable unclipped audio mean=${meanVolume} max=${maxVolume}`);

// 8. Captions and all 13 semantic scene bindings with frozen SSIM floor/hashes.
const srt = await text('submission/assets/workhub-goal-room-demo.en.srt');
const cueBlocks=srt.trim().split(/\n\s*\n/); const timePattern=/(\d\d):(\d\d):(\d\d),(\d\d\d) --> (\d\d):(\d\d):(\d\d),(\d\d\d)/;
const times=cueBlocks.map((block) => { const m=block.match(timePattern); return m ? [Number(m[1])*3600+Number(m[2])*60+Number(m[3])+Number(m[4])/1000,Number(m[5])*3600+Number(m[6])*60+Number(m[7])+Number(m[8])/1000] : null; });
ok(times.length===13 && times.every(Boolean), 'exact 13 SRT cues'); for(let i=0;i<times.length;i++){ok(times[i][1]>times[i][0],`cue ${i+1} positive`);if(i)ok(times[i][0]>=times[i-1][1],`cue ${i+1} nonoverlap`);} ok(times.at(-1)?.[1] <= duration,'captions contained');
const scenes=await json('submission/assets/workhub-goal-room-demo-scenes.json');
ok(scenes?.schemaVersion===2 && scenes?.frozenSimilarityFloor===0.995 && scenes?.cues?.length===13, 'scene manifest identity/count/frozen floor');
ok(JSON.stringify(scenes.cues)===JSON.stringify(CUES),'exact validator-owned cue contract (including cue 12)');
for(let i=0;i<13;i++){
 const cue=CUES[i], caption=cueBlocks[i]?.split('\n').slice(2).join(' ') ?? '';
 ok(cue.cue===i+1 && cue.startSeconds===times[i][0] && cue.endSeconds===times[i][1] && cue.caption===caption,`cue ${i+1} frozen caption/time binding`);
 ok(cue.expectedSemanticTokens.every((token)=>caption.toLowerCase().includes(token.toLowerCase())),`cue ${i+1} frozen semantic tokens`);
 ok(cue.similarity.metric==='ffmpeg-ssim-all'&&cue.similarity.minimum>=0.995,`cue ${i+1} frozen SSIM`);
 const visual=await readFile(resolve(root,cue.expectedVisual.path)); ok(visual.length===cue.expectedVisual.bytes&&digest(visual)===cue.expectedVisual.sha256&&cue.expectedVisual.width===1440&&cue.expectedVisual.height===900,`cue ${i+1} canonical visual hash/dimensions`);
 for(const second of cue.representativeSeconds){const run=spawnSync('ffmpeg',['-v','info','-ss',String(second),'-i',media,'-i',resolve(root,cue.expectedVisual.path),'-filter_complex','[0:v][1:v]ssim','-frames:v','1','-f','null','-'],{encoding:'utf8',maxBuffer:10*1024*1024});const similarity=Number([...run.stderr.matchAll(/All:([0-9.]+)/g)].at(-1)?.[1]);ok(run.status===0&&similarity>=0.995,`cue ${i+1} representative SSIM ${similarity}`);}
}

// 9. Genuine interactivity: receipt classes/state plus source-bound video changes in every live interval.
const capture=await json('submission/assets/live-demo-capture.json');
ok(capture?.schemaVersion===4 && capture?.kind==='workhub-v3-interactive-native-demo-receipt' && capture?.captureMode===VIDEO_DISCLOSURE.captureMode && capture?.continuousAuthorityLineage?.startSeconds===0 && capture?.continuousAuthorityLineage?.completeJourney===true && capture.continuousAuthorityLineage.endSeconds===126.8, 'interactive receipt identity/mode/lineage');
ok(capture?.productCommit===SOURCE_COMMIT && capture?.productTree===SOURCE_TREE && capture?.browser?.version==='Google Chrome 154.0.8028.0 canary' && capture?.browser?.signatureVerified===true && capture?.browser?.notarized===true && capture?.browser?.isolatedUnsignedInProfile===true, 'interactive receipt source/browser');
ok(capture?.nativeTools?.length===6 && new Set(capture.nativeTools.map(({name})=>name)).size===6 && tools.every((name)=>capture.nativeTools.some((row)=>row.name===name)), 'interactive receipt six browser-returned tools');
ok(capture?.capture?.api==='Page.startScreencast' && capture.capture.frameCount>=100 && capture.capture.uniqueFrameCount>=100 && capture.capture.transitionCount>=100, 'interactive screencast frame/transition evidence');
ok(capture?.media?.sha256===digest(await readFile(media)) && capture.media.bytes===(await stat(media)).size, 'interactive receipt media binding');
ok(capture?.finalState?.phase==='GOAL_ACCEPTED'&&capture.finalState?.stateVersion===16&&capture.finalState?.currentActor==='none'&&capture.finalState?.nextLegalAction==='GOAL_ACCEPTED_NO_FURTHER_ACTION','interactive final S14');
const eventClasses=new Set(capture.events?.map(({class:className})=>className)); for(const className of ['browser-native-agent-call','trusted-owner-input','automatic-system-verdict','checkpoint-reconstruction'])ok(eventClasses.has(className),`interactive event class ${className}`);
ok(capture.events?.filter(({class:className})=>className==='automatic-system-verdict').map(({verdict})=>verdict).join(',')==='FAIL,PASS','automatic FAIL then PASS');
ok(capture.events?.some(({class:className,operation})=>className==='trusted-owner-input'&&operation==='keyboard')&&capture.events?.some(({class:className,operation})=>className==='trusted-owner-input'&&operation==='click'),'trusted Owner keyboard/mouse events');
ok(capture.events?.filter(({class:className})=>className==='browser-native-agent-call').every(({mechanism})=>mechanism==='document.modelContext.getTools() -> browser-returned RegisteredTool -> document.modelContext.executeTool(tool, JSON.stringify(input))'),'native mechanism every Agent call');
for(const interval of capture.liveIntervals??[]){
 const rows=capture.events.filter(({seconds})=>seconds>=interval.start&&seconds<=interval.end); for(const required of interval.required)ok(rows.some(({class:className})=>className===required),`live interval ${interval.id} event ${required}`);
 const samples=[interval.start+.5,(interval.start+interval.end)/2,interval.end-.5]; const hashes=[];
 for(const second of samples){const run=spawnSync('ffmpeg',['-v','error','-ss',String(second),'-i',media,'-frames:v','1','-f','md5','-'],{encoding:'utf8'});hashes.push(run.stdout.trim());}
 ok(new Set(hashes).size===3,`live interval ${interval.id} actual video frame changes`);
}
ok(JSON.stringify(capture.reconstructedIntervals?.map(({scene})=>scene))===JSON.stringify(['mobile/breakpoint','architecture/honest limits']),'exact disclosed reconstructed intervals');
ok(capture.reconstructedIntervals?.[0]?.start===RECONSTRUCTED_INTERVALS[0].start && capture.reconstructedIntervals?.[0]?.end===RECONSTRUCTED_INTERVALS[0].end && capture.reconstructedIntervals?.[1]?.start===RECONSTRUCTED_INTERVALS[1].start, 'frozen reconstructed interval starts/mobile end');
ok(capture.reconstructedIntervals?.every(({start,end})=>Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end>start&&end<=duration) && Math.abs(capture.reconstructedIntervals[1].end-duration)<0.001, 'receipt reconstructed intervals bounded by authoritative media duration');
ok(Number(capture.media?.probe?.format?.duration)===duration, 'receipt probe duration equals authoritative ffprobe duration');
ok(scenes.reconstructedIntervals?.[0]?.startSeconds===RECONSTRUCTED_INTERVALS[0].start && scenes.reconstructedIntervals?.[0]?.endSeconds===RECONSTRUCTED_INTERVALS[0].end && scenes.reconstructedIntervals?.[1]?.startSeconds===RECONSTRUCTED_INTERVALS[1].start && Math.abs(scenes.reconstructedIntervals?.[1]?.endSeconds-duration)<0.001, 'scene reconstruction intervals bounded by authoritative media duration');

// 10. Exact package inventory, immutable Git-object hashes, parent/tree binding, and child scope.
const packageManifest=await json('submission/package-manifest.json');
ok(packageManifest?.sourceProduct?.commit===SOURCE_COMMIT&&packageManifest?.sourceProduct?.tree===SOURCE_TREE,'package source product');
ok(Array.isArray(packageManifest?.artifacts)&&packageManifest.artifactCount===packageManifest.artifacts.length&&packageManifest.verifiedArtifactCount===packageManifest.artifacts.length,'package exact artifact counts');
ok(new Set(packageManifest.artifacts?.map(({path})=>path)).size===packageManifest.artifacts?.length,'package artifact paths unique');
ok(JSON.stringify(packageManifest.artifacts?.map(({path})=>path))===JSON.stringify(REQUIRED_ARTIFACTS),'package exact validator-owned required artifact inventory/order');
const sentinel=packageManifest.packageCommit==='PACKAGE_COMMIT_SENTINEL'&&packageManifest.packageTree==='PACKAGE_TREE_SENTINEL';
const bound=/^[0-9a-f]{40}$/.test(packageManifest.packageCommit)&&/^[0-9a-f]{40}$/.test(packageManifest.packageTree);
ok(prebind ? sentinel : bound,'package binding form for selected mode');
if(!prebind&&bound){
 const object=git(['cat-file','-t',packageManifest.packageCommit]); const tree=git(['rev-parse',`${packageManifest.packageCommit}^{tree}`]);
 ok(object.status===0&&object.stdout.trim()==='commit','packageCommit real commit object'); ok(tree.status===0&&tree.stdout.trim()===packageManifest.packageTree,'packageTree exact commit tree');
 const headParent=git(['rev-parse','HEAD^']); ok(headParent.status===0&&headParent.stdout.trim()===packageManifest.packageCommit,'packageCommit exact HEAD parent');
 const childPaths=git(['diff','--name-only','HEAD^..HEAD']).stdout.trim().split('\n').filter(Boolean).sort(); ok(JSON.stringify(childPaths)===JSON.stringify(['submission/V3_AUDIT.md','submission/package-manifest.json']),'metadata child only allowed files');
}
for(const artifact of packageManifest.artifacts??[]){
 ok(artifact&&typeof artifact.path==='string'&&Number.isInteger(artifact.bytes)&&/^[0-9a-f]{64}$/.test(artifact.sha256),`artifact shape ${JSON.stringify(artifact)}`); if(!artifact?.path)continue;
 const bytes=await readFile(resolve(root,artifact.path)); ok(bytes.length===artifact.bytes&&digest(bytes)===artifact.sha256,`artifact working bytes ${artifact.path}`);
 if(!prebind&&bound){const object=git(['show',`${packageManifest.packageCommit}:${artifact.path}`],null);ok(object.status===0&&object.stdout.length===artifact.bytes&&digest(object.stdout)===artifact.sha256,`artifact immutable package Git object ${artifact.path}`);}
}

// 11. Exact publication sentinels and broad overclaim rejection.
const expectedPublication={publicUrl:'PENDING_OWNER_GATED_PUBLIC_URL',repositoryUrl:'PENDING_OWNER_GATED_REPOSITORY_URL',youtubeUrl:'PENDING_OWNER_GATED_YOUTUBE_URL',devpostStatus:'PENDING_OWNER_GATED_DEVPOST_SUBMISSION'};
ok(JSON.stringify(packageManifest.publication)===JSON.stringify(expectedPublication),'exact four publication sentinels only'); for(const marker of Object.values(expectedPublication))ok(devpost.includes(marker),`Devpost marker ${marker}`);
const publicText=`${docs}\n${srt}\n${JSON.stringify(scenes)}\n${JSON.stringify(capture.claimBoundary)}`;
const overclaims=[/proves?\s+autonomous\s+model\s+reliability/i,/enterprise[- ](?:grade|secure|ready)/i,/production[- ]ready/i,/ready\s+for\s+(?:use\s+in\s+)?production/i,/secure\s+and\s+ready\s+for\s+production/i,/safe\s+for\s+production/i,/fully\s+secure/i,/security[- ]certified/i,/deploy(?:ment)?[- ]ready/i,/durable\s+backend\s+persistence/i,/creates?\s+external\s+effects/i,/guarantees?\s+(?:security|privacy|reliability)/i];
for(const pattern of overclaims)ok(!pattern.test(publicText),`affirmative overclaim ${pattern}`);

// 12. Protected authority parity.
for(const [path,expected] of Object.entries(phase5.protectedStartGitObjects??{})){const actual=git(['hash-object',path]).stdout.trim();ok(actual===expected,`protected parity ${path}`);}

if(failures.length){console.error(`qa:submission:v3${prebind?' --prebind':''} FAIL (${failures.length})\n- ${failures.join('\n- ')}`);process.exit(1);}
if(prebind) console.log(`qa:submission:v3 --prebind builder checks complete · NON-QUALIFYING · no final gate verdict`);
else console.log(`qa:submission:v3 PASS · exact-package qualification · 15 anchored gates · ${shots.frames.length} screenshots · ${duration.toFixed(3)}s H.264 High/AAC-LC · 13/13 cue visuals · ${capture.capture.uniqueFrameCount} unique live frames`);
