#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';

const root = process.cwd();
const fail = [];
const ok = (condition, message) => { if (!condition) fail.push(message); };
const text = async (path) => readFile(resolve(root, path), 'utf8');
const json = async (path) => JSON.parse(await text(path));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const exists = async (path) => { try { await stat(resolve(root, path)); return true; } catch { return false; } };
const files = [
  'README.md', 'submission/DEVPOST_SUBMISSION.md', 'submission/DEMO_SCRIPT.md',
  'submission/V3_REQUIREMENTS.md', 'submission/V3_CLAIMS.md', 'submission/V3_AUDIT.md',
];
const tools = ['get_goal_room_state', 'propose_goal_contract', 'propose_plan', 'claim_step', 'submit_artifact', 'request_completion'];

// 1. Historical custody.
const historical = await json('submission/historical/v2-five-tool/manifest.json');
ok(historical.claimClass === 'historical-v2-five-tool' && historical.entryCount === 25, 'historical manifest identity/count');
for (const entry of historical.entries) {
  const original = resolve(root, entry.originalPath);
  const copy = resolve(root, entry.historicalPath);
  const copyBytes = await readFile(copy);
  ok(copyBytes.length === entry.bytes && hash(copyBytes) === entry.sha256, `historical hash drift: ${entry.historicalPath}`);
  // Current files may have been replaced. Historical parity is against Git product P5 bytes.
  const git = spawnSync('git', ['show', `5ac95d4bdab5f54beda0f90776c3918fd36136d2:${entry.originalPath}`], { cwd: root, maxBuffer: 25 * 1024 * 1024 });
  ok(git.status === 0 && Buffer.compare(git.stdout, copyBytes) === 0, `historical byte mismatch: ${entry.originalPath}`);
}

// 2. Current copy and exact six-tool truth.
const current = (await Promise.all(files.map(text))).join('\n');
const stale = [/exactly five/i, /five WebMCP/i, /Discovers 5/i, /\b90\/90\b/i, /ninety tests/i, /e5740dc/i, /8a174561/i, /nine immutable receipts/i, /six-stage lifecycle/i, /current.{0,20}Phase 7/i];
for (const pattern of stale) ok(!pattern.test(current), `stale current token: ${pattern}`);
const devpost = await text('submission/DEVPOST_SUBMISSION.md');
for (const tool of tools) ok(devpost.includes(`\`${tool}\``), `current Devpost missing tool ${tool}`);
ok(devpost.includes('exactly six') && devpost.includes('PASS does not mean accepted.'), 'defining six-tool/nonacceptance copy');

// 3–5. Phase 3, Phase 4, Phase 5 and journey truth.
const production = await json('evaluation/production-journey/qualification-receipt.json');
const native = await json('evaluation/native-webmcp-v3/native-webmcp-receipt.json');
const phase5 = await json('evaluation/phase5-qualification.json');
const journey = await json('evaluation/production-journey/journey.json');
ok(production.results.checkpoints === 12 && production.results.receipts === 22 && production.results.finalPhase === 'GOAL_ACCEPTED', 'production receipt summary');
ok(native.descriptors.length === 6 && native.browserEnumerationOrder.length === 6 && native.registrationOrder.length === 6, 'native exact six descriptors/orders');
ok(new Set(native.descriptors.map(({name}) => name)).size === 6 && tools.every((tool) => native.descriptors.some(({name}) => name === tool)), 'native tool names');
ok(native.browser.version.includes('154.0.8028.0'), 'native browser build');
ok(phase5.findings.P0 === 0 && phase5.findings.P1 === 0 && phase5.security.externalEffects === false && phase5.security.persistence.startsWith('none'), 'Phase 5 evidence boundary');
const labels = journey.checkpoints.map(({label}) => label);
for (const label of ['goal-revision','goal-v2-confirmed','plan-revision','plan-v2-confirmed','candidate-v1-fail','candidate-v2-pass-s12','completion-s13','sealed-s14']) ok(labels.includes(label), `journey missing ${label}`);
const terminal = journey.checkpoints.find(({label}) => label === 'sealed-s14');
ok(terminal.currentActor === 'none' && terminal.nextLegalAction === 'GOAL_ACCEPTED_NO_FURTHER_ACTION', 'S14 actorless terminal');

// 6. Public-safe screenshot manifest.
const shotsPath = 'submission/assets/screenshots/manifest.json';
const shots = await json(shotsPath);
ok(shots.frameCount === 10 && shots.frames.length === 10, 'screenshot count');
const requiredStates = ['GOAL_CONTRACT_REVISION_REQUESTED','PLAN_REVISION_REQUESTED','VERIFICATION_FAILED','VERIFICATION_PASSED','COMPLETION_REQUESTED','GOAL_ACCEPTED'];
for (const state of requiredStates) ok(shots.frames.some((frame) => frame.state === state), `screenshot state ${state}`);
for (const frame of shots.frames) {
  const path = resolve(dirname(resolve(root, shotsPath)), frame.path);
  const bytes = await readFile(path);
  ok(bytes.length === frame.bytes && hash(bytes) === frame.sha256, `screenshot hash: ${frame.path}`);
  ok(frame.width > 0 && frame.height > 0 && frame.sourceReceipt && frame.evidenceClass, `screenshot metadata: ${frame.path}`);
}

// 7. Architecture semantic assets.
const architecture = await text('submission/assets/workhub-goal-room-architecture.svg');
for (const phrase of ['Six WebMCP tools','Production verifier adapter','Not a tool · not an Owner control','Candidate version + SHA-256','PASS grants no acceptance authority','No accounts · persistence · database · cloud · external effects']) ok(architecture.includes(phrase), `architecture label: ${phrase}`);
for (const path of ['submission/assets/workhub-goal-room-architecture.html','submission/assets/workhub-goal-room-architecture.svg','submission/assets/workhub-goal-room-architecture.png']) ok(await exists(path), `architecture file ${path}`);

// 8. Recorder cannot bypass browser/runtime authority.
const recorder = await text('submission/scripts/record-live-demo.py');
for (const phrase of ['document.modelContext.getTools()', 'document.modelContext.executeTool(tool, JSON.stringify(input))', 'RegisteredTool']) ok(recorder.includes(phrase), `recorder native route: ${phrase}`);
for (const pattern of [/descriptor\.execute/i, /tool\.execute\s*\(/i, /__phase7Exec/i, /advance-demo/i, /replayGoalRoom/i, /recordVerification/i, /acceptGoal/i, /ownerController/i, /systemVerifierAdapter\./i]) ok(!pattern.test(recorder), `forbidden recorder path ${pattern}`);

// 9. MP4 decode/probe.
const media = resolve(root, 'submission/assets/workhub-goal-room-demo.mp4');
const probeRun = spawnSync('ffprobe', ['-v','error','-show_entries','format=duration','-show_entries','stream=codec_name,codec_type,width,height,sample_rate,channels','-of','json',media], {encoding:'utf8'});
ok(probeRun.status === 0, 'ffprobe failed');
const probe = probeRun.status === 0 ? JSON.parse(probeRun.stdout) : {streams:[],format:{duration:0}};
const duration = Number(probe.format.duration);
ok(duration > 0 && duration < 180, 'video duration');
ok(probe.streams.some((s) => s.codec_type === 'video' && s.codec_name === 'h264' && s.width === 1440 && s.height === 900), 'H.264 1440x900 video');
ok(probe.streams.some((s) => s.codec_type === 'audio' && s.codec_name === 'aac'), 'AAC audio');
const decode = spawnSync('ffmpeg', ['-v','error','-i',media,'-f','null','-']);
ok(decode.status === 0, 'full media decode');

// 10–11. SRT order, containment, narration tokens.
const srt = await text('submission/assets/workhub-goal-room-demo.en.srt');
const times = [...srt.matchAll(/(\d\d):(\d\d):(\d\d),(\d\d\d) --> (\d\d):(\d\d):(\d\d),(\d\d\d)/g)].map((m) => [Number(m[1])*3600+Number(m[2])*60+Number(m[3])+Number(m[4])/1000, Number(m[5])*3600+Number(m[6])*60+Number(m[7])+Number(m[8])/1000]);
ok(times.length === 13, 'SRT cue count');
for (let i=0;i<times.length;i++) { ok(times[i][1] > times[i][0], `SRT cue ${i+1} positive`); if (i) ok(times[i][0] >= times[i-1][1], `SRT cue ${i+1} overlap`); }
ok(times.at(-1)?.[1] <= duration, 'SRT final cue contained');
for (const phrase of ['six browser-native RegisteredTool descriptors','PASS does not mean accepted','no accounts, backend persistence','No model autonomously selected']) ok(srt.includes(phrase), `caption claim ${phrase}`);
for (const pattern of stale) ok(!pattern.test(srt), `stale caption token ${pattern}`);

// 12. Cue-12 visual semantics and deterministic representative-frame alignment.
const scenes = await json('submission/assets/workhub-goal-room-demo-scenes.json');
const cue12 = scenes.validatedScene;
const cue12Context = scenes.timelineContext.find(({name}) => name === 'cue-12-mobile-breakpoint');
ok(cue12?.cue === 12 && cue12?.name === 'cue-12-mobile-breakpoint', 'cue 12 scene identity');
ok(cue12Context?.startSeconds === times[11]?.[0] && cue12Context?.endSeconds === times[11]?.[1], 'cue 12 scene/SRT boundaries');
ok(scenes.timelineContext.some(({name,startSeconds,endSeconds}) => name === 'sealed-s14' && startSeconds === 118.719 && endSeconds === 126.751), 'S14 scene boundary');
ok(scenes.timelineContext.some(({name,startSeconds}) => name === 'architecture-honest-limits' && startSeconds === 138.827), 'final architecture scene boundary');
const requiredSceneLabels = ['JUDGE ZOOM · MOBILE 393×852','1199 PX · MOBILE COMPOSITION','1200 PX · DESKTOP COMPOSITION'];
ok(JSON.stringify(cue12?.requiredLabelTokens) === JSON.stringify(requiredSceneLabels), 'cue 12 required label tokens');
const expectedVisualPath = cue12?.expectedVisual?.path;
if (expectedVisualPath) {
  const expectedVisual = await readFile(resolve(root, expectedVisualPath));
  ok(expectedVisual.length === cue12.expectedVisual.bytes && hash(expectedVisual) === cue12.expectedVisual.sha256, 'cue 12 expected visual hash');
} else ok(false, 'cue 12 expected visual path');
const requiredSceneSources = new Map([
  ['submission/assets/screenshots/mobile-s14-frontier.png','e655f8cca051a6681acfa9b6b98123338d555b8e7aa180bce3b3d1b572018ccb'],
  ['submission/assets/screenshots/boundary-1199-mobile.png','b2eaf0454940ea862fe973fe07a14db6bcf95119a69243f1b79c8903dc8ea503'],
  ['submission/assets/screenshots/boundary-1200-desktop.png','16f99404504d3c5bff1d56385a63bad4a2c83fb4ddd33f620521e555dc547828'],
]);
for (const [path, expectedHash] of requiredSceneSources) {
  const source = cue12?.sources?.find((entry) => entry.path === path);
  ok(source?.sha256 === expectedHash && hash(await readFile(resolve(root, path))) === expectedHash, `cue 12 source hash ${path}`);
}
ok(JSON.stringify(cue12?.representativeSeconds) === JSON.stringify([130,135]) && cue12?.similarity?.metric === 'ffmpeg-ssim-all', 'cue 12 representative frame contract');
for (const second of cue12?.representativeSeconds ?? []) {
  const similarityRun = spawnSync('ffmpeg', ['-v','info','-ss',String(second),'-i',media,'-i',resolve(root, expectedVisualPath),'-filter_complex','[0:v][1:v]ssim','-frames:v','1','-f','null','-'], {encoding:'utf8',maxBuffer:10*1024*1024});
  const similarity = Number([...similarityRun.stderr.matchAll(/All:([0-9.]+)/g)].at(-1)?.[1]);
  ok(similarityRun.status === 0 && Number.isFinite(similarity) && similarity >= cue12.similarity.minimum, `cue 12 frame similarity at ${second}s (${similarity})`);
}

// 13. Package manifest hashes and sentinel/bound pattern.
const packageManifest = await json('submission/package-manifest.json');
ok(packageManifest.sourceProduct.commit === '5ac95d4bdab5f54beda0f90776c3918fd36136d2' && packageManifest.sourceProduct.tree === 'b6b50068e8119d02d1d9213286f14adf3cbc0db1', 'source product binding');
ok(packageManifest.artifactCount === packageManifest.artifacts.length && packageManifest.artifactCount >= 25, 'artifact manifest count');
for (const path of ['submission/assets/cue-12-mobile-breakpoint.png','submission/assets/workhub-goal-room-demo-scenes.json']) ok(packageManifest.artifacts.some((artifact) => artifact.path === path), `scene artifact manifest ${path}`);
for (const artifact of packageManifest.artifacts) { const bytes = await readFile(resolve(root, artifact.path)); ok(bytes.length === artifact.bytes && hash(bytes) === artifact.sha256, `artifact hash ${artifact.path}`); }
const sentinel = packageManifest.packageCommit === 'PACKAGE_COMMIT_SENTINEL' && packageManifest.packageTree === 'PACKAGE_TREE_SENTINEL';
const bound = /^[0-9a-f]{40}$/.test(packageManifest.packageCommit) && /^[0-9a-f]{40}$/.test(packageManifest.packageTree);
ok(sentinel || bound, 'package commit/tree binding form');

// 14. Publication remains Owner-gated.
for (const value of Object.values(packageManifest.publication)) ok(/^PENDING_OWNER_GATED_/.test(value), `publication gate ${value}`);
for (const marker of ['PENDING_OWNER_GATED_PUBLIC_URL','PENDING_OWNER_GATED_REPOSITORY_URL','PENDING_OWNER_GATED_YOUTUBE_URL','PENDING_OWNER_GATED_DEVPOST_SUBMISSION']) ok(devpost.includes(marker), `Devpost pending marker ${marker}`);

// 15. Reject affirmative overclaims and preserve protected Git objects.
for (const pattern of [/proves autonomous model reliability/i, /enterprise[- ]secure/i, /production-ready/i, /durable backend persistence/i, /creates external effects/i]) ok(!pattern.test(current + '\n' + srt), `overclaim ${pattern}`);
const protectedObjects = phase5.protectedStartGitObjects;
for (const [path, expected] of Object.entries(protectedObjects)) {
  const actual = spawnSync('git', ['hash-object', path], {cwd:root,encoding:'utf8'}).stdout.trim();
  ok(actual === expected, `protected parity ${path}`);
}

if (fail.length) {
  console.error(`qa:submission:v3 FAIL (${fail.length})\n- ${fail.join('\n- ')}`);
  process.exit(1);
}
console.log(`qa:submission:v3 PASS · 15/15 matrix items · ${shots.frames.length} screenshots · ${duration.toFixed(3)}s H.264/AAC · cue-12 SSIM aligned`);
