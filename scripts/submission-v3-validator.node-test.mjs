import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, cp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = resolve(new URL('..', import.meta.url).pathname);
const validator = join(root, 'scripts/submission-v3-validate.mjs');

function run(cwd = root) {
  return spawnSync(process.execPath, [validator], { cwd, encoding: 'utf8' });
}

async function mutated(name, mutate) {
  const dir = await mkdtemp(join(tmpdir(), `workhub-submission-v3-${name}-`));
  try {
    await cp(root, dir, { recursive: true, filter: (src) => !src.includes('/node_modules') && !src.includes('/dist') });
    await mutate(dir);
    return run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function syncPackageArtifacts(dir, paths) {
  const manifestPath = join(dir, 'submission/package-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const path of paths) {
    const bytes = await readFile(join(dir, path));
    let artifact = manifest.artifacts.find((entry) => entry.path === path);
    if (!artifact) {
      artifact = { path };
      manifest.artifacts.push(artifact);
    }
    artifact.bytes = bytes.length;
    artifact.sha256 = createHash('sha256').update(bytes).digest('hex');
  }
  manifest.artifacts.sort((a, b) => a.path.localeCompare(b.path));
  manifest.artifactCount = manifest.artifacts.length;
  manifest.verifiedArtifactCount = manifest.artifacts.length;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

test('the committed V3 competition package validates', () => {
  const result = run();
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('cue 12 architecture mismatch is rejected', async () => {
  const result = await mutated('scene-gap', async (dir) => {
    const visualPath = join(dir, 'submission/assets/cue-12-mobile-breakpoint.png');
    const replace = spawnSync('ffmpeg', ['-y','-v','error','-i',join(dir, 'submission/assets/workhub-goal-room-architecture.png'),'-vf','scale=1440:900','-frames:v','1',visualPath]);
    assert.equal(replace.status, 0, replace.stderr?.toString());
    const visualBytes = await readFile(visualPath);
    const scenesPath = join(dir, 'submission/assets/workhub-goal-room-demo-scenes.json');
    const scenes = JSON.parse(await readFile(scenesPath, 'utf8'));
    scenes.validatedScene.expectedVisual.bytes = visualBytes.length;
    scenes.validatedScene.expectedVisual.sha256 = createHash('sha256').update(visualBytes).digest('hex');
    await writeFile(scenesPath, `${JSON.stringify(scenes, null, 2)}\n`);
    await syncPackageArtifacts(dir, [
      'scripts/submission-v3-validate.mjs',
      'scripts/submission-v3-validator.node-test.mjs',
      'submission/assets/cue-12-mobile-breakpoint.png',
      'submission/assets/workhub-goal-room-demo-scenes.json',
      'submission/assets/workhub-goal-room-demo.mp4',
    ]);
  });
  assert.notEqual(result.status, 0, 'validator accepted architecture during the mobile/breakpoint cue');
  assert.match(`${result.stdout}\n${result.stderr}`, /cue 12 frame similarity/);
});

test('stale five-tool copy is rejected', async () => {
  const result = await mutated('stale', async (dir) => {
    const path = join(dir, 'submission/DEVPOST_SUBMISSION.md');
    await writeFile(path, (await readFile(path, 'utf8')).replace('exactly six', 'exactly five'));
  });
  assert.notEqual(result.status, 0);
});

test('missing tool is rejected', async () => {
  const result = await mutated('tool', async (dir) => {
    const path = join(dir, 'submission/V3_CLAIMS.md');
    await writeFile(path, (await readFile(path, 'utf8')).replace('propose_goal_contract', 'propose_goal_contract_REMOVED'));
  });
  assert.notEqual(result.status, 0);
});

test('screenshot hash drift is rejected', async () => {
  const result = await mutated('hash', async (dir) => writeFile(join(dir, 'submission/assets/screenshots/goal-revision.png'), 'drift'));
  assert.notEqual(result.status, 0);
});

test('forbidden recorder path is rejected', async () => {
  const result = await mutated('recorder', async (dir) => {
    const path = join(dir, 'submission/scripts/record-live-demo.py');
    await writeFile(path, `${await readFile(path, 'utf8')}\n# forbidden probe: tool.execute(input)\n`);
  });
  assert.notEqual(result.status, 0);
});

test('overlapping SRT is rejected', async () => {
  const result = await mutated('srt', async (dir) => {
    const path = join(dir, 'submission/assets/workhub-goal-room-demo.en.srt');
    const original = await readFile(path, 'utf8');
    await writeFile(path, original.replace(/(\n2\n)\d\d:\d\d:\d\d,\d\d\d/, (_match, prefix) => `${prefix}00:00:05,000`));
  });
  assert.notEqual(result.status, 0);
});

test('fake publication URLs are rejected', async () => {
  const result = await mutated('url', async (dir) => {
    const path = join(dir, 'submission/DEVPOST_SUBMISSION.md');
    await writeFile(path, (await readFile(path, 'utf8')).replace('PENDING_OWNER_GATED_PUBLIC_URL', 'https://fake.example/app'));
  });
  assert.notEqual(result.status, 0);
});

test('overclaims are rejected', async () => {
  const result = await mutated('overclaim', async (dir) => {
    const path = join(dir, 'submission/DEVPOST_SUBMISSION.md');
    await writeFile(path, `${await readFile(path, 'utf8')}\nThis proves autonomous model reliability.\n`);
  });
  assert.notEqual(result.status, 0);
});
