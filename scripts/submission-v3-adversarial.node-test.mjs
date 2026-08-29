import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = resolve(new URL('..', import.meta.url).pathname);
const validator = join(root, 'scripts/submission-v3-validate.mjs');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function putJson(path, value) { await writeFile(path, `${JSON.stringify(value, null, 2)}\n`); }
async function syncArtifacts(dir, paths) {
  const path = join(dir, 'submission/package-manifest.json');
  const manifest = await json(path);
  for (const relative of paths) {
    const bytes = await readFile(join(dir, relative));
    const row = manifest.artifacts.find((entry) => entry.path === relative);
    if (row) Object.assign(row, { bytes: bytes.length, sha256: sha256(bytes) });
  }
  await putJson(path, manifest);
}
async function setPrebindSentinels(dir) {
  const path = join(dir, 'submission/package-manifest.json');
  const manifest = await json(path);
  manifest.packageCommit = 'PACKAGE_COMMIT_SENTINEL';
  manifest.packageTree = 'PACKAGE_TREE_SENTINEL';
  await putJson(path, manifest);
}
async function mutation(name, mutate, args = []) {
  const dir = await mkdtemp(join(tmpdir(), `phase6-adversarial-${name}-`));
  try {
    await cp(root, dir, { recursive: true, filter: (source) => !source.includes('/node_modules') && !source.includes('/dist') });
    await syncArtifacts(dir, ['scripts/submission-v3-adversarial.node-test.mjs']);
    await mutate(dir);
    return spawnSync(process.execPath, [validator, ...args], { cwd: dir, encoding: 'utf8' });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
function rejected(result, label) {
  assert.notEqual(result.status, 0, `${label} false-green:\n${result.stdout}\n${result.stderr}`);
}

test('rejects arbitrary package commit and tree that are not the real HEAD parent object', async () => {
  const result = await mutation('fake-package-object', async (dir) => {
    const path = join(dir, 'submission/package-manifest.json'); const value = await json(path);
    value.packageCommit = 'a'.repeat(40); value.packageTree = 'b'.repeat(40); await putJson(path, value);
  });
  rejected(result, 'fake package object');
});

test('rejects historical omission even when declared count remains 25', async () => {
  const result = await mutation('historical-omission', async (dir) => {
    const path = join(dir, 'submission/historical/v2-five-tool/manifest.json'); const value = await json(path);
    value.entries.pop(); await putJson(path, value); await syncArtifacts(dir, ['submission/historical/v2-five-tool/manifest.json']);
  });
  rejected(result, 'historical omission');
});

test('rejects forged screenshot source identity date actor frontier and dimensions', async () => {
  const result = await mutation('forged-shot', async (dir) => {
    const path = join(dir, 'submission/assets/screenshots/manifest.json'); const value = await json(path);
    Object.assign(value.frames[0], { sourceCommit: 'a'.repeat(40), sourceTree: 'b'.repeat(40), date: '1999-01-01', actor: 'system', width: 1 });
    await putJson(path, value); await syncArtifacts(dir, ['submission/assets/screenshots/manifest.json']);
  });
  rejected(result, 'forged screenshot metadata');
});

test('rejects removed recolored and bypass architecture connectors', async () => {
  const result = await mutation('architecture-bypass', async (dir) => {
    const svg = join(dir, 'submission/assets/workhub-goal-room-architecture.svg');
    await writeFile(svg, (await readFile(svg, 'utf8')).replace(/<path d="M810 405[^\n]+\n/, '').replace('class="system" fill="none" stroke-width="4" marker-end="url(#systemArrow)"', 'class="agent" fill="none" stroke-width="4" marker-end="url(#agentArrow)"'));
    await syncArtifacts(dir, ['submission/assets/workhub-goal-room-architecture.svg']);
  });
  rejected(result, 'architecture connector mutation');
});

test('rejects recorder reduced to native-route magic comments', async () => {
  const result = await mutation('recorder-comments', async (dir) => {
    const path = join(dir, 'submission/scripts/record-live-demo.py');
    await writeFile(path, '# document.modelContext.getTools()\n# RegisteredTool\n# document.modelContext.executeTool(tool, JSON.stringify(input))\n');
    await syncArtifacts(dir, ['submission/scripts/record-live-demo.py']);
  });
  rejected(result, 'recorder comment stub');
});

test('rejects materially false cue 7 caption and scene semantics', async () => {
  const result = await mutation('cue7-false', async (dir) => {
    const srt = join(dir, 'submission/assets/workhub-goal-room-demo.en.srt');
    await writeFile(srt, (await readFile(srt, 'utf8')).replace('The Agent claims the admitted step and submits Candidate version one. The production System adapter runs the deterministic rule set automatically and records FAIL. System verdict authorship is neither an Agent tool nor an Owner control.', 'The Owner directly records PASS and accepts Candidate version one.'));
    await syncArtifacts(dir, ['submission/assets/workhub-goal-room-demo.en.srt']);
  });
  rejected(result, 'false cue 7');
});

test('rejects omission of any exact required bound artifact', async () => {
  const result = await mutation('artifact-omission', async (dir) => {
    const path = join(dir, 'submission/package-manifest.json'); const value = await json(path);
    value.artifacts.pop(); value.artifactCount -= 1; value.verifiedArtifactCount -= 1; await putJson(path, value);
  });
  rejected(result, 'artifact omission');
});

test('rejects stale README identity in the V3 qualification receipt', async () => {
  const result = await mutation('stale-receipt-readme', async (dir) => {
    const relative = 'evaluation/v3/qualification-receipt.json';
    const receipt = await json(join(dir, relative));
    const readme = receipt.sourceHashes.find((row) => row.path === 'README.md');
    Object.assign(readme, {
      sha256: '2d7e8ab471242e9c5a773b7b6e336ad58ea8a20bdb985eee1cbd3a203eec32b5',
      bytes: 12160,
    });
    await putJson(join(dir, relative), receipt);
    await setPrebindSentinels(dir);
    await syncArtifacts(dir, [relative]);
  }, ['--prebind']);
  rejected(result, 'stale V3 receipt README source identity');
  assert.match(`${result.stdout}\n${result.stderr}`, /receipt source hash README\.md/);
});

test('rejects malformed sourceHash rows in the V3 qualification receipt', async () => {
  const result = await mutation('malformed-receipt-source-hash', async (dir) => {
    const relative = 'evaluation/v3/qualification-receipt.json';
    const receipt = await json(join(dir, relative));
    receipt.sourceHashes[0].bytes = String(receipt.sourceHashes[0].bytes);
    await putJson(join(dir, relative), receipt);
    await setPrebindSentinels(dir);
    await syncArtifacts(dir, [relative]);
  }, ['--prebind']);
  rejected(result, 'malformed V3 receipt source hash');
  assert.match(`${result.stdout}\n${result.stderr}`, /receipt source hash index\.html/);
});

test('rejects fake publication URL hidden behind pending prefix', async () => {
  const result = await mutation('pending-url', async (dir) => {
    const path = join(dir, 'submission/package-manifest.json'); const value = await json(path);
    value.publication.publicUrl = 'PENDING_OWNER_GATED_https://fake.example/app'; await putJson(path, value);
  });
  rejected(result, 'pending-prefixed fake URL');
});

test('rejects broad production security readiness overclaims', async () => {
  const result = await mutation('broad-overclaim', async (dir) => {
    const path = join(dir, 'submission/V3_CLAIMS.md'); await writeFile(path, `${await readFile(path, 'utf8')}\nThis system is secure and ready for production deployment.\n`);
    await syncArtifacts(dir, ['submission/V3_CLAIMS.md']);
  });
  rejected(result, 'broad overclaim');
});

test('rejects stale README demo duration despite synchronized mutable package metadata', async () => {
  const result = await mutation('stale-readme-duration', async (dir) => {
    const relative = 'README.md';
    const path = join(dir, relative);
    const current = await readFile(path, 'utf8');
    const stale = current.replace(/(\[`DEMO_SCRIPT\.md`\][^\n]+— )[^ ]+( narration\/timeline and reconstruction disclosure;)/, '$12:38$2');
    assert.match(stale, /— 2:38 narration\/timeline and reconstruction disclosure;/);
    await writeFile(path, stale);
    await setPrebindSentinels(dir);
    await syncArtifacts(dir, [relative]);
  }, ['--prebind']);
  rejected(result, 'stale README demo duration');
  assert.match(`${result.stdout}\n${result.stderr}`, /README exact demo duration/);
});

test('rejects README wording that classifies the whole video as reconstruction', async () => {
  const result = await mutation('readme-whole-video-reconstruction', async (dir) => {
    const relative = 'README.md';
    const path = join(dir, relative);
    const current = await readFile(path, 'utf8');
    const stale = 'The video is explicitly a fresh-checkpoint reconstruction from qualified production and native receipts. It does not claim one continuous authority transaction or autonomous model execution. Public app, repository, YouTube, and Devpost actions remain Owner-gated and pending.';
    await writeFile(path, current.replace(/^The video (?:is|records)[^\n]+/m, stale));
    await setPrebindSentinels(dir);
    await syncArtifacts(dir, [relative]);
  }, ['--prebind']);
  rejected(result, 'README whole-video reconstruction wording');
});

test('rejects Devpost wording that denies the continuous authority journey', async () => {
  const result = await mutation('devpost-denies-continuous-journey', async (dir) => {
    const relative = 'submission/DEVPOST_SUBMISSION.md';
    const path = join(dir, relative);
    const current = await readFile(path, 'utf8');
    const stale = 'The video is a disclosed fresh-checkpoint reconstruction from exact current production/native evidence. It does not depict one continuous authority transaction. The functioning production UI and its real checkpoints are visible; the reconstruction exists to keep claims tied to already qualified receipts rather than reenacting or fabricating a native run.';
    await writeFile(path, current.replace(/^The video (?:is|records)[^\n]+/m, stale));
    await setPrebindSentinels(dir);
    await syncArtifacts(dir, [relative]);
  }, ['--prebind']);
  rejected(result, 'Devpost denial of continuous authority journey');
});

test('rejects lowered SSIM floor and cue visual substitution', async () => {
  const result = await mutation('ssim-zero', async (dir) => {
    const scenePath = join(dir, 'submission/assets/workhub-goal-room-demo-scenes.json'); const value = await json(scenePath);
    const cuePath = join(dir, 'submission/assets/cue-12-mobile-breakpoint.png');
    const rendered = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', join(dir, 'submission/assets/workhub-goal-room-architecture.png'), '-vf', 'scale=1440:900', '-frames:v', '1', cuePath]);
    assert.equal(rendered.status, 0, rendered.stderr?.toString());
    const bytes = await readFile(cuePath);
    value.cues[11].similarity.minimum = 0;
    Object.assign(value.cues[11].expectedVisual, { path: 'submission/assets/cue-12-mobile-breakpoint.png', sha256: sha256(bytes), bytes: bytes.length });
    await putJson(scenePath, value); await syncArtifacts(dir, ['submission/assets/cue-12-mobile-breakpoint.png', 'submission/assets/workhub-goal-room-demo-scenes.json']);
  });
  rejected(result, 'lowered SSIM and substituted visual');
});

test('final qualification rejects the supported prebind sentinels', async () => {
  const result = await mutation('sentinel-final', setPrebindSentinels);
  rejected(result, 'sentinel final qualification');
});

test('rejects synchronized materially false cue 7 self-description', async () => {
  const result = await mutation('cue7-synchronized-false', async (dir) => {
    const falseCaption = 'The Owner directly records PASS and accepts Candidate version one';
    const srtPath = join(dir, 'submission/assets/workhub-goal-room-demo.en.srt');
    const scenesPath = join(dir, 'submission/assets/workhub-goal-room-demo-scenes.json');
    await writeFile(srtPath, (await readFile(srtPath, 'utf8')).replace('The Agent claims the admitted step and submits Candidate version one. The production System adapter runs the deterministic rule set automatically and records FAIL. System verdict authorship is neither an Agent tool nor an Owner control.', falseCaption));
    const scenes = await json(scenesPath);
    scenes.cues[6].caption = falseCaption;
    scenes.cues[6].expectedSemanticTokens = ['Owner directly records PASS', 'accepts Candidate version one'];
    await putJson(scenesPath, scenes);
    await setPrebindSentinels(dir);
    await syncArtifacts(dir, ['submission/assets/workhub-goal-room-demo.en.srt', 'submission/assets/workhub-goal-room-demo-scenes.json']);
  }, ['--prebind']);
  rejected(result, 'synchronized false cue 7');
});

test('rejects a valid-dimension black production checkpoint with regenerated hashes', async () => {
  const result = await mutation('black-production-checkpoint', async (dir) => {
    const relative = 'submission/assets/screenshots/goal-revision.png';
    const screenshotPath = join(dir, relative);
    const rendered = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=1440x900', '-frames:v', '1', screenshotPath]);
    assert.equal(rendered.status, 0, rendered.stderr?.toString());
    const bytes = await readFile(screenshotPath);
    const manifestPath = join(dir, 'submission/assets/screenshots/manifest.json');
    const manifest = await json(manifestPath);
    Object.assign(manifest.frames.find(({ path }) => path === 'goal-revision.png'), { bytes: bytes.length, sha256: sha256(bytes) });
    await putJson(manifestPath, manifest);
    await setPrebindSentinels(dir);
    await syncArtifacts(dir, [relative, 'submission/assets/screenshots/manifest.json']);
  }, ['--prebind']);
  rejected(result, 'black production checkpoint');
});

test('rejects a large self-attesting dead-data recorder stub', async () => {
  const result = await mutation('dead-recorder-stub', async (dir) => {
    const relative = 'submission/scripts/record-live-demo.py';
    const tokens = ['class CDP','class Recorder','async def record','def encode','Page.startScreencast','Page.screencastFrameAck','Input.dispatchMouseEvent','Input.insertText','document.modelContext.getTools()','document.modelContext.executeTool(tool, JSON.stringify(input))','RegisteredTool'];
    const dead = [
      '#!/usr/bin/env python3', 'import json', `TOKENS = ${JSON.stringify(tokens)}`,
      ...Array.from({ length: 900 }, (_, index) => `dead_${index} = ${JSON.stringify(`unused-${index}-${'x'.repeat(24)}`)}`),
      "print(json.dumps({'functionalRecorder':True,'launch':True,'nativeDiscovery':True,'trustedOwnerInput':True,'screencast':True,'encode':True,'receipt':True,'cleanup':True}))",
    ].join('\n');
    await writeFile(join(dir, relative), `${dead}\n`);
    await setPrebindSentinels(dir);
    await syncArtifacts(dir, [relative]);
  }, ['--prebind']);
  rejected(result, 'dead-data recorder');
});

test('recorder smoke proves screencast metadata drives encoded timing', () => {
  const result = spawnSync('python3', [join(root, 'submission/scripts/record-live-demo.py'), '--self-test'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.metadataTimeline, true);
  assert.equal(receipt.orderedTimeline, true);
  assert.equal(receipt.receiveTimeline, true);
  assert.equal(receipt.endpointClipping, true);
  assert.equal(receipt.endpointMux, true);
});

test('rejects a reconstructed receipt interval beyond actual media duration', async () => {
  const result = await mutation('receipt-overrun', async (dir) => {
    const relative = 'submission/assets/live-demo-capture.json';
    const receipt = await json(join(dir, relative));
    receipt.reconstructedIntervals[1].end = 157.8;
    await putJson(join(dir, relative), receipt);
    await setPrebindSentinels(dir);
    await syncArtifacts(dir, [relative]);
  }, ['--prebind']);
  rejected(result, 'receipt interval beyond media');
});
