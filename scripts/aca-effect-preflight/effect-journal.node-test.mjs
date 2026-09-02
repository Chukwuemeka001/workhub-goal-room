import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { appendJournal, replayJournal } from './effect-journal.mjs';
import { canonicalJson, createJournalRecord, createProposalRecord, digest, emptyEffectState, validateAndReduce } from './effect-state.mjs';
import { proposalArgs, subject } from './effect-state.node-test.mjs';
import { admitResponse, confirm, createProposal, dispatchOnce, prepare, reconcile } from './effect-simulator.mjs';

const ownerDecision = proposal => ({ schema: 'aca-owner-effect-decision/v1', proposalId: proposal.effectId,
  proposalDigest: proposal.proposalDigest, decision: 'AUTHORIZE' });
const simulation = (effectId, tuple) => {
  const exact = subject({ trustedTupleDigest: tuple.repeat(64) });
  const proposal = createProposal({ ...proposalArgs(exact), effectId });
  const state = confirm({ proposal, decision: ownerDecision(proposal), now: '2026-09-01T12:01:30.000Z' });
  return { proposal, exact, state: prepare({ state, subject: exact, now: '2026-09-01T12:01:40.000Z' }) };
};
const now = '2026-09-01T12:02:00.000Z';
const eventFor = (proposal, transition, payload, requestDigest = '') => ({ transition, timestamp: now,
  effectId: proposal.effectId, semanticKey: proposal.semanticKey, subjectDigest: proposal.subjectDigest,
  proposalDigest: proposal.proposalDigest, requestDigest, payload });

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'aca-effect-journal-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'effects.jsonl');
}

function records() {
  const proposal = createProposalRecord(proposalArgs(subject()));
  let state = emptyEffectState();
  const result = [];
  for (const event of [
    eventFor(proposal, 'PROPOSED', { proposal }),
    eventFor(proposal, 'CONFIRMED', { decision: { schema: 'aca-owner-effect-decision/v1', proposalId: proposal.effectId,
      proposalDigest: proposal.proposalDigest, decision: 'AUTHORIZE' } }),
  ]) {
    const record = createJournalRecord(state, event);
    state = validateAndReduce(state, record);
    result.push(record);
  }
  return { proposal, result, state };
}

test('P4 effect IDs cannot be reused across exact subjects', () => {
  const first = createProposal(proposalArgs(subject()));
  const changed = subject({ trustedTupleDigest: '3'.repeat(64) });
  const second = createProposal(proposalArgs(changed));
  const decision = proposal => ({ schema: 'aca-owner-effect-decision/v1', proposalId: proposal.effectId,
    proposalDigest: proposal.proposalDigest, decision: 'AUTHORIZE' });
  confirm({ proposal: first, decision: decision(first), now: '2026-09-01T12:01:30.000Z' });
  assert.throws(() => confirm({ proposal: second, decision: decision(second), now: '2026-09-01T12:01:31.000Z' }));
});

test('P5 response and settlement records use causal evidence timestamps', async () => {
  const fixture = simulation('causal-records', '4'); const item = fixture.state.world.effects[fixture.state.effectId];
  const response = { schema: 'aca-simulated-comment-response/v1', status: 201, comment: { id: 707,
    nodeId: 'IC_fixture707', actorNodeId: 'ACTOR_fixture_owner', body: item.proposal.body,
    marker: `<!-- aca-effect:${item.effectId} -->`, subjectDigest: item.subjectDigest,
    createdAt: '2026-09-01T12:02:00.000Z', updatedAt: '2026-09-01T12:02:00.000Z' } };
  const dispatched = await dispatchOnce({ state: fixture.state, invoke: () => ({ kind: 'RESPONSE', response }) });
  const admitted = admitResponse({ state: dispatched.state, response });
  const observation = { schema: 'aca-simulated-comment-observation/v1', complete: true, stable: true, bounded: true,
    subjectDigest: item.subjectDigest, actorNodeId: 'ACTOR_fixture_owner', observedAt: '2026-09-01T12:03:00.000Z', comments: [response.comment] };
  const applied = reconcile({ state: admitted, observation });
  assert.equal(admitted.world.lastTimestamp, response.comment.updatedAt);
  assert.equal(applied.world.lastTimestamp, observation.observedAt);
});

test('P4 modified native Promises are refused without descriptor access', async () => {
  const fixture = simulation('native-promise-shape', '5'); let hits = 0;
  const pending = Promise.resolve({ kind: 'UNKNOWN', reason: 'TIMEOUT_SHAPED' });
  Object.defineProperty(pending, 'constructor', { get() { hits += 1; throw new Error('constructor getter'); } });
  const result = await dispatchOnce({ state: fixture.state, invoke: () => pending });
  assert.equal(result.state.world.effects[result.state.effectId].state, 'UNKNOWN_EFFECT');
  assert.equal(hits, 0);
});

test('P3 appends canonical synced records and deterministically replays them', async t => {
  const path = await fixture(t);
  const { proposal } = records();
  await appendJournal(path, eventFor(proposal, 'PROPOSED', { proposal }));
  await appendJournal(path, eventFor(proposal, 'CONFIRMED', { decision: { schema: 'aca-owner-effect-decision/v1',
    proposalId: proposal.effectId, proposalDigest: proposal.proposalDigest, decision: 'AUTHORIZE' } }));
  const bytes = await readFile(path, 'utf8');
  assert.equal(bytes.split('\n').filter(Boolean).every(line => line === canonicalJson(JSON.parse(line))), true);
  const first = await replayJournal(path);
  const second = await replayJournal(path);
  assert.deepEqual(first, second);
  assert.equal(first.effects[proposal.effectId].state, 'CONFIRMED');
});

test('P3 parks malformed, duplicate-key, truncated, reordered, and hash-broken journals', async t => {
  const path = await fixture(t);
  const { result } = records();
  const valid = result.map(canonicalJson);
  const changed = structuredClone(result[0]); changed.effectId = 'changed';
  const gap = structuredClone(result[1]); gap.sequence = 7; gap.recordDigest = digest(Object.fromEntries(Object.entries(gap).filter(([k]) => k !== 'recordDigest')));
  const duplicate = valid[0].replace('{', '{"schema":"aca-effect-journal-record/v1",');
  const cases = [
    `${valid[0]}\n${valid[1].slice(0, -8)}`,
    `${duplicate}\n`,
    `${valid[1]}\n${valid[0]}\n`,
    `${canonicalJson(changed)}\n`,
    `${valid[0]}\n${canonicalJson(gap)}\n`,
  ];
  for (const bytes of cases) {
    await writeFile(path, bytes);
    await assert.rejects(replayJournal(path));
  }
});

test('P3 rejects a resealed non-closed proposal during replay', async t => {
  const path = await fixture(t);
  const { proposal } = records();
  const forged = { ...proposal, extra: 'caller-content' };
  forged.proposalDigest = digest(Object.fromEntries(Object.entries(forged).filter(([key]) => key !== 'proposalDigest')));
  const record = createJournalRecord(emptyEffectState(), eventFor(forged, 'PROPOSED', { proposal: forged }));
  await writeFile(path, `${canonicalJson(record)}\n`);
  await assert.rejects(replayJournal(path));
});

test('P3 rejects a resealed illegal transition and duplicate semantic custody without changing bytes', async t => {
  const path = await fixture(t);
  const { proposal } = records();
  await appendJournal(path, eventFor(proposal, 'PROPOSED', { proposal }));
  const before = await readFile(path);
  await assert.rejects(appendJournal(path, eventFor(proposal, 'DISPATCHING', {})));
  assert.deepEqual(await readFile(path), before);
  const other = createProposalRecord({ ...proposalArgs(subject()), effectId: 'effect-0002' });
  const collision = { ...other, semanticKey: proposal.semanticKey };
  collision.proposalDigest = digest(Object.fromEntries(Object.entries(collision).filter(([key]) => key !== 'proposalDigest')));
  await assert.rejects(appendJournal(path, eventFor(collision, 'PROPOSED', { proposal: collision })));
  assert.deepEqual(await readFile(path), before);
});
