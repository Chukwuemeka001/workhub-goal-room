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
async function mutation(name, mutate) {
  const dir = await mkdtemp(join(tmpdir(), `phase6-adversarial-${name}-`));
  try {
    await cp(root, dir, { recursive: true, filter: (source) => !source.includes('/node_modules') && !source.includes('/dist') });
    await mutate(dir);
    return spawnSync(process.execPath, [validator], { cwd: dir, encoding: 'utf8' });
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
