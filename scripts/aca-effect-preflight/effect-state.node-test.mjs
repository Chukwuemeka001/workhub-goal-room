import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { admitSubject, createJournalRecord, createProposalRecord, emptyEffectState, validateAndReduce } from './effect-state.mjs';
import { project } from './effect-simulator.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;

function subject(overrides = {}) {
  const value = {
    schema: 'aca-exact-remote-subject/v1', provider: 'GITHUB',
    repository: { id: 101, nodeId: 'R_repo101', owner: 'startup-owner', name: 'startup-repository' },
    pull: { id: 202, nodeId: 'PR_pull202', number: 17, state: 'OPEN', draft: false,
      headRepository: { id: 101, nodeId: 'R_repo101' }, headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40) },
    localCandidate: { commit: 'a'.repeat(40), tree: 'c'.repeat(40), manifestDigest: 'd'.repeat(64),
      trackedState: 'CLEAN', nonExcludedUntrackedCount: 0 },
    qualification: { commit: 'a'.repeat(40), tree: 'c'.repeat(40), status: 'QUALIFIED',
      aggregate: 'ALL_REQUIRED_COMPLETE', receiptDigest: 'e'.repeat(64), installedDigest: 'f'.repeat(64) },
    observedAt: '2026-09-01T12:00:00.000Z', trustedTupleDigest: '1'.repeat(64), ...overrides,
  };
  value.subjectDigest = sha(canonical(value));
  return value;
}

const proposalArgs = value => ({ subject: value, evidence: { unit: 'ACA_EFFECT_PREFLIGHT', build: 'QUALIFIED_LOCAL_COMMIT' },
  effectId: 'effect-0001', now: '2026-09-01T12:01:00.000Z', expiresAt: '2026-09-01T12:11:00.000Z' });

test('P0 accepted installed bytes and GET-only production reachability remain unchanged', async () => {
  const names = ['controller.mjs', 'docker.mjs', 'github.mjs', 'install.mjs', 'output.mjs', 'receipt.mjs',
    'snapshot.mjs', 'workflow.mjs', 'ui.html', 'ui.js', 'ui.css'];
  const rows = [];
  for (const path of names) {
    const bytes = await readFile(new URL(`../aca-controller/${path}`, import.meta.url));
    rows.push({ path, bytes: bytes.length, sha256: sha(bytes), mode: '100444' });
    assert.doesNotMatch(bytes.toString(), /aca-effect-preflight/);
  }
  assert.equal(sha(JSON.stringify({ files: rows, configuration: null })), '02b1ff163a5bba1335b099f03f44abb3dbd25f7aec63cbe7396a8fb480086864');
  const github = await readFile(new URL('../aca-controller/github.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(github, /\bPOST\b|confirm|dispatch|retry/i);
});

test('P1 admits only an exact clean qualified subject at the PR head', () => {
  const exact = subject();
  const admitted = admitSubject(exact);
  assert.deepEqual(admitted, exact);
  assert.ok(Object.isFrozen(admitted) && Object.isFrozen(admitted.pull));
  const invalid = [
    subject({ localCandidate: { ...exact.localCandidate, trackedState: 'DIRTY' } }),
    subject({ pull: { ...exact.pull, headSha: '9'.repeat(40) } }),
    subject({ qualification: { ...exact.qualification, status: 'FAILED' } }),
    subject({ repository: { ...exact.repository, owner: 'https://attacker.invalid' } }),
    subject({ caller: { owner: 'attacker' } }),
  ];
  for (const value of invalid) assert.throws(() => admitSubject(value));
});

test('P1 rejects hidden fields, accessors, proxies, and stale digests', () => {
  const extra = subject();
  Object.defineProperty(extra, 'hidden', { value: true });
  const accessor = subject();
  Object.defineProperty(accessor.repository, 'owner', { get() { throw new Error('getter ran'); }, enumerable: true });
  const proxy = new Proxy(subject(), { ownKeys() { throw new Error('proxy trap'); } });
  for (const value of [extra, accessor, proxy, { ...subject(), subjectDigest: '0'.repeat(64) }]) {
    assert.throws(() => admitSubject(value));
  }
});

test('P1 refuses top-level and nested proxies without executing traps', () => {
  for (const nested of [false, true]) {
    let trapHits = 0;
    const hostile = new Proxy(nested ? subject().repository : subject(), {
      getPrototypeOf() { trapHits += 1; return Object.prototype; },
      ownKeys() { trapHits += 1; return []; },
      getOwnPropertyDescriptor() { trapHits += 1; return undefined; },
      get() { trapHits += 1; return undefined; },
    });
    const value = nested ? { ...subject(), repository: hostile } : hostile;
    assert.throws(() => admitSubject(value));
    assert.equal(trapHits, 0);
  }
});

test('P1 creates one deterministic immutable fixed-body proposal', () => {
  const exact = subject();
  const first = createProposalRecord(proposalArgs(exact));
  const second = createProposalRecord(proposalArgs(exact));
  assert.deepEqual(first, second);
  assert.equal(first.schema, 'aca-effect-proposal/v1');
  assert.equal(first.action, 'CREATE_ADVISORY_PR_COMMENT_V1');
  assert.equal(first.state, 'PROPOSED');
  assert.equal(first.bodyBytes, Buffer.byteLength(first.body));
  assert.equal(first.bodyDigest, sha(first.body));
  assert.match(first.body, /Head: a{40}/);
  assert.match(first.body, /does not approve, merge, deploy, or create provider authority/i);
  assert.match(first.body, /<!-- aca-effect:effect-0001 -->$/);
  assert.ok(Object.isFrozen(first));
  assert.throws(() => createProposalRecord({ ...proposalArgs(exact), prose: 'ship it' }));
  assert.throws(() => createProposalRecord({ ...proposalArgs(exact), evidence: { unit: 'OTHER', build: 'QUALIFIED_LOCAL_COMMIT' } }));
});

test('P1 rejects chronologically expired expanded-year proposal timestamps', () => {
  const args = proposalArgs(subject());
  assert.throws(() => createProposalRecord({ ...args,
    now: '+010001-01-01T00:00:00.000Z', expiresAt: '9999-01-01T00:00:00.000Z' }));
});

test('P2 replay rejects a re-digested proposal body that substitutes the exact subject head', () => {
  const proposal = createProposalRecord(proposalArgs(subject()));
  const forged = { ...proposal, body: proposal.body.replace('a'.repeat(40), '9'.repeat(40)) };
  forged.bodyBytes = Buffer.byteLength(forged.body);
  forged.bodyDigest = sha(forged.body);
  forged.proposalDigest = sha(canonical(Object.fromEntries(Object.entries(forged).filter(([key]) => key !== 'proposalDigest'))));
  const state = emptyEffectState();
  const record = createJournalRecord(state, { transition: 'PROPOSED', timestamp: proposal.issuedAt,
    effectId: proposal.effectId, semanticKey: proposal.semanticKey, subjectDigest: proposal.subjectDigest,
    proposalDigest: forged.proposalDigest, requestDigest: '', payload: { proposal: forged } });
  assert.throws(() => validateAndReduce(state, record));
});

test('P2 replay refuses confirmation at or after proposal expiry', () => {
  const proposal = createProposalRecord(proposalArgs(subject()));
  let state = emptyEffectState();
  state = validateAndReduce(state, createJournalRecord(state, { transition: 'PROPOSED', timestamp: proposal.issuedAt,
    effectId: proposal.effectId, semanticKey: proposal.semanticKey, subjectDigest: proposal.subjectDigest,
    proposalDigest: proposal.proposalDigest, requestDigest: '', payload: { proposal } }));
  const decision = { schema: 'aca-owner-effect-decision/v1', proposalId: proposal.effectId,
    proposalDigest: proposal.proposalDigest, decision: 'AUTHORIZE' };
  for (const timestamp of [proposal.expiresAt, '+010001-01-01T00:00:00.000Z']) {
    const record = createJournalRecord(state, { transition: 'CONFIRMED', timestamp, effectId: proposal.effectId,
      semanticKey: proposal.semanticKey, subjectDigest: proposal.subjectDigest,
      proposalDigest: proposal.proposalDigest, requestDigest: '', payload: { decision } });
    assert.throws(() => validateAndReduce(state, record));
  }
});

test('P2 replay refuses retrograde record timestamps', () => {
  const proposal = createProposalRecord(proposalArgs(subject()));
  let state = emptyEffectState();
  state = validateAndReduce(state, createJournalRecord(state, { transition: 'PROPOSED', timestamp: proposal.issuedAt,
    effectId: proposal.effectId, semanticKey: proposal.semanticKey, subjectDigest: proposal.subjectDigest,
    proposalDigest: proposal.proposalDigest, requestDigest: '', payload: { proposal } }));
  const record = createJournalRecord(state, { transition: 'CONFIRMED', timestamp: '2026-09-01T12:00:59.000Z',
    effectId: proposal.effectId, semanticKey: proposal.semanticKey, subjectDigest: proposal.subjectDigest,
    proposalDigest: proposal.proposalDigest, requestDigest: '', payload: { decision: {
      schema: 'aca-owner-effect-decision/v1', proposalId: proposal.effectId,
      proposalDigest: proposal.proposalDigest, decision: 'AUTHORIZE' } } });
  assert.throws(() => validateAndReduce(state, record));
});

test('P2 record construction refuses nested accessors without executing them', () => {
  const proposal = createProposalRecord(proposalArgs(subject()));
  let state = emptyEffectState();
  state = validateAndReduce(state, createJournalRecord(state, { transition: 'PROPOSED', timestamp: proposal.issuedAt,
    effectId: proposal.effectId, semanticKey: proposal.semanticKey, subjectDigest: proposal.subjectDigest,
    proposalDigest: proposal.proposalDigest, requestDigest: '', payload: { proposal } }));
  state = validateAndReduce(state, createJournalRecord(state, { transition: 'CONFIRMED', timestamp: '2026-09-01T12:02:00.000Z',
    effectId: proposal.effectId, semanticKey: proposal.semanticKey, subjectDigest: proposal.subjectDigest,
    proposalDigest: proposal.proposalDigest, requestDigest: '', payload: { decision: { schema: 'aca-owner-effect-decision/v1',
      proposalId: proposal.effectId, proposalDigest: proposal.proposalDigest, decision: 'AUTHORIZE' } } }));
  let hits = 0;
  const payload = {};
  Object.defineProperty(payload, 'request', { enumerable: true, get() { hits += 1; return {}; } });
  assert.throws(() => createJournalRecord(state, { transition: 'PREPARED', timestamp: '2026-09-01T12:03:00.000Z',
    effectId: proposal.effectId, semanticKey: proposal.semanticKey, subjectDigest: proposal.subjectDigest,
    proposalDigest: proposal.proposalDigest, requestDigest: '', payload }));
  assert.equal(hits, 0);
});

test('P2 reducer owns transitions, identity, semantic custody, and receipts', () => {
  const proposal = createProposalRecord(proposalArgs(subject()));
  let state = emptyEffectState();
  const step = (transition, payload = {}, changes = {}) => {
    const record = createJournalRecord(state, { transition, timestamp: '2026-09-01T12:02:00.000Z',
      effectId: proposal.effectId, semanticKey: proposal.semanticKey, subjectDigest: proposal.subjectDigest,
      proposalDigest: proposal.proposalDigest, requestDigest: '', payload, ...changes });
    state = validateAndReduce(state, record);
    return record;
  };
  step('PROPOSED', { proposal });
  step('CONFIRMED', { decision: { schema: 'aca-owner-effect-decision/v1', proposalId: proposal.effectId,
    proposalDigest: proposal.proposalDigest, decision: 'AUTHORIZE' } });
  const before = state;
  assert.throws(() => step('APPLIED', { receipt: { caller: true } }));
  state = before;
  assert.throws(() => step('CONFIRMED'));
  state = before;
  assert.throws(() => step('PREPARED', { request: { body: proposal.body } }, { semanticKey: '0'.repeat(64) }));
  state = before;
  step('PREPARED', { request: { action: proposal.action, effectId: proposal.effectId,
    subjectDigest: proposal.subjectDigest, proposalDigest: proposal.proposalDigest,
    bodyDigest: proposal.bodyDigest, body: proposal.body } });
  step('DISPATCHING');
  const dispatching = state;
  assert.throws(() => step('DISPATCHING'));
  state = dispatching;
  step('UNKNOWN_EFFECT', { reason: 'INVOKE_THROWN' });
  const absentObservation = { schema: 'aca-simulated-comment-observation/v1', complete: true, stable: true, bounded: true,
    subjectDigest: proposal.subjectDigest, actorNodeId: 'ACTOR_fixture_owner', observedAt: '2026-09-01T12:03:00.000Z', comments: [] };
  assert.throws(() => validateAndReduce(state, createJournalRecord(state, { transition: 'ABSENT_TERMINAL',
    timestamp: '2026-09-01T12:02:00.000Z', effectId: proposal.effectId, semanticKey: proposal.semanticKey,
    subjectDigest: proposal.subjectDigest, proposalDigest: proposal.proposalDigest,
    requestDigest: state.effects[proposal.effectId].requestDigest, payload: { observation: absentObservation } })));
  const terminal = validateAndReduce(state, createJournalRecord(state, { transition: 'ABSENT_TERMINAL',
    timestamp: '2026-09-01T12:03:00.000Z', effectId: proposal.effectId, semanticKey: proposal.semanticKey,
    subjectDigest: proposal.subjectDigest, proposalDigest: proposal.proposalDigest,
    requestDigest: state.effects[proposal.effectId].requestDigest, payload: { observation: {
      schema: 'aca-simulated-comment-observation/v1', complete: true, stable: true, bounded: true,
      subjectDigest: proposal.subjectDigest, actorNodeId: 'ACTOR_fixture_owner', observedAt: '2026-09-01T12:03:00.000Z', comments: [] } } }));
  assert.equal(terminal.effects[proposal.effectId].state, 'ABSENT_TERMINAL');
  assert.throws(() => validateAndReduce(terminal, createJournalRecord(terminal, { transition: 'DISPATCHING',
    timestamp: '2026-09-01T12:04:00.000Z', effectId: proposal.effectId, semanticKey: proposal.semanticKey,
    subjectDigest: proposal.subjectDigest, proposalDigest: proposal.proposalDigest,
    requestDigest: terminal.effects[proposal.effectId].requestDigest, payload: {} })));
});

test('P2 projects admitted multi-effect replay worlds truthfully', () => {
  const first = createProposalRecord(proposalArgs(subject()));
  const secondSubject = subject({ trustedTupleDigest: '2'.repeat(64) });
  const second = createProposalRecord({ ...proposalArgs(secondSubject), effectId: 'effect-0002' });
  let state = emptyEffectState();
  for (const proposal of [first, second]) state = validateAndReduce(state, createJournalRecord(state, {
    transition: 'PROPOSED', timestamp: proposal.issuedAt, effectId: proposal.effectId, semanticKey: proposal.semanticKey,
    subjectDigest: proposal.subjectDigest, proposalDigest: proposal.proposalDigest, requestDigest: '', payload: { proposal } }));
  assert.equal(project(state).status, 'MULTIPLE_EFFECTS');
});

test('P2 reducer refuses forged predecessor laundering', () => {
  const proposal = createProposalRecord(proposalArgs(subject()));
  let state = emptyEffectState();
  const step = (base, transition, timestamp, payload) => validateAndReduce(base, createJournalRecord(base, {
    transition, timestamp, effectId: proposal.effectId, semanticKey: proposal.semanticKey, subjectDigest: proposal.subjectDigest,
    proposalDigest: proposal.proposalDigest, requestDigest: '', payload }));
  state = step(state, 'PROPOSED', proposal.issuedAt, { proposal });
  state = step(state, 'CONFIRMED', '2026-09-01T12:01:30.000Z', { decision: { schema: 'aca-owner-effect-decision/v1',
    proposalId: proposal.effectId, proposalDigest: proposal.proposalDigest, decision: 'AUTHORIZE' } });
  const forged = structuredClone(state);
  const request = { action: proposal.action, effectId: proposal.effectId, subjectDigest: proposal.subjectDigest,
    proposalDigest: proposal.proposalDigest, bodyDigest: proposal.bodyDigest, body: proposal.body };
  const record = createJournalRecord(forged, { transition: 'PREPARED', timestamp: '2026-09-01T12:01:40.000Z',
    effectId: proposal.effectId, semanticKey: proposal.semanticKey, subjectDigest: proposal.subjectDigest,
    proposalDigest: proposal.proposalDigest, requestDigest: '', payload: { request } });
  assert.throws(() => validateAndReduce(forged, record));
});

test('P1 proposal issuance cannot predate subject observation', () => {
  const observed = subject({ observedAt: '2026-09-01T12:02:00.000Z' });
  assert.throws(() => createProposalRecord(proposalArgs(observed)));
});

test('P5 observation cannot predate an included comment update', () => {
  const proposal = createProposalRecord(proposalArgs(subject()));
  let state = emptyEffectState();
  const apply = (transition, timestamp, payload, requestDigest = '') => {
    state = validateAndReduce(state, createJournalRecord(state, { transition, timestamp, effectId: proposal.effectId,
      semanticKey: proposal.semanticKey, subjectDigest: proposal.subjectDigest, proposalDigest: proposal.proposalDigest,
      requestDigest, payload }));
  };
  apply('PROPOSED', proposal.issuedAt, { proposal });
  apply('CONFIRMED', '2026-09-01T12:01:30.000Z', { decision: { schema: 'aca-owner-effect-decision/v1',
    proposalId: proposal.effectId, proposalDigest: proposal.proposalDigest, decision: 'AUTHORIZE' } });
  const request = { action: proposal.action, effectId: proposal.effectId, subjectDigest: proposal.subjectDigest,
    proposalDigest: proposal.proposalDigest, bodyDigest: proposal.bodyDigest, body: proposal.body };
  apply('PREPARED', '2026-09-01T12:01:40.000Z', { request }); apply('DISPATCHING', '2026-09-01T12:01:40.001Z', {});
  const responseComment = { id: 606, nodeId: 'IC_fixture606', actorNodeId: 'ACTOR_fixture_owner', body: proposal.body,
    marker: `<!-- aca-effect:${proposal.effectId} -->`, subjectDigest: proposal.subjectDigest,
    createdAt: '2026-09-01T12:02:00.000Z', updatedAt: '2026-09-01T12:02:00.000Z' };
  const response = { schema: 'aca-simulated-comment-response/v1', status: 201, comment: responseComment };
  assert.throws(() => apply('RESPONSE_ADMITTED', '2026-09-01T12:01:40.001Z', { response }, state.effects[proposal.effectId].requestDigest));
  apply('UNKNOWN_EFFECT', '2026-09-01T12:01:40.001Z', { reason: 'TIMEOUT_SHAPED' }, state.effects[proposal.effectId].requestDigest);
  const comment = { id: 707, nodeId: 'IC_fixture707', actorNodeId: 'ACTOR_fixture_owner', body: proposal.body,
    marker: `<!-- aca-effect:${proposal.effectId} -->`, subjectDigest: proposal.subjectDigest,
    createdAt: '2026-09-01T12:05:00.000Z', updatedAt: '2026-09-01T12:05:00.000Z' };
  const observation = { schema: 'aca-simulated-comment-observation/v1', complete: true, stable: true, bounded: true,
    subjectDigest: proposal.subjectDigest, actorNodeId: 'ACTOR_fixture_owner', observedAt: '2026-09-01T12:03:00.000Z', comments: [comment] };
  assert.throws(() => apply('APPLIED', '2026-09-01T12:06:00.000Z', { observation }, state.effects[proposal.effectId].requestDigest));
  const causal = { ...observation, observedAt: '2026-09-01T12:05:00.000Z', comments: [] };
  assert.throws(() => apply('APPLIED', '2026-09-01T12:04:00.000Z', { observation: causal }, state.effects[proposal.effectId].requestDigest));
});

test('P2 schema-valid prototype-name effect IDs reduce normally', () => {
  const proposal = createProposalRecord({ ...proposalArgs(subject()), effectId: 'constructor' });
  const state = emptyEffectState();
  const record = createJournalRecord(state, { transition: 'PROPOSED', timestamp: proposal.issuedAt,
    effectId: proposal.effectId, semanticKey: proposal.semanticKey, subjectDigest: proposal.subjectDigest,
    proposalDigest: proposal.proposalDigest, requestDigest: '', payload: { proposal } });
  assert.equal(validateAndReduce(state, record).effects.constructor.state, 'PROPOSED');
});

export { proposalArgs, subject };
