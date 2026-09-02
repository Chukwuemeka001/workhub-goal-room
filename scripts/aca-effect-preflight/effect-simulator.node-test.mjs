import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson, createJournalRecord, createProposalRecord, digest, emptyEffectState, validateAndReduce } from './effect-state.mjs';
import { proposalArgs as baseProposalArgs, subject as baseSubject } from './effect-state.node-test.mjs';
import { admitResponse, confirm, createProposal, dispatchOnce, prepare, project, reconcile } from './effect-simulator.mjs';
let scenario = 0; let scenarioSubject;
const subject = () => scenarioSubject; const proposalArgs = value => ({ ...baseProposalArgs(value), effectId: `effect-${scenario.toString().padStart(4, '0')}` });
const nextSubject = () => {
  const value = { ...baseSubject(), trustedTupleDigest: (++scenario).toString(16).padStart(64, '0') };
  value.subjectDigest = digest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'subjectDigest'))); return value;
};
test.beforeEach(() => { scenarioSubject = nextSubject(); });
const decisionFor = proposal => ({ schema: 'aca-owner-effect-decision/v1', proposalId: proposal.effectId, proposalDigest: proposal.proposalDigest, decision: 'AUTHORIZE' });
const confirmed = () => { const proposal = createProposal(proposalArgs(subject())); return { proposal, state: confirm({ proposal, decision: decisionFor(proposal), now: '2026-09-01T12:01:30.000Z' }) }; };
const movedSubject = () => {
  const original = subject();
  const moved = { ...original, pull: { ...original.pull, headSha: '9'.repeat(40) },
    localCandidate: { ...original.localCandidate, commit: '9'.repeat(40) },
    qualification: { ...original.qualification, commit: '9'.repeat(40) } };
  moved.subjectDigest = digest(Object.fromEntries(Object.entries(moved).filter(([key]) => key !== 'subjectDigest')));
  return moved;
};
test('P4 final subject movement prevents invocation and network-shaped arguments are refused', async () => {
  const { proposal, state } = confirmed();
  assert.throws(() => createProposal({ ...proposalArgs(subject()), url: 'https://example.invalid' }));
  assert.throws(() => prepare({ state, subject: movedSubject(), now: '2026-09-01T12:01:40.000Z' }));
  const prepared = prepare({ state, subject: subject(), now: '2026-09-01T12:01:40.000Z' });
  await assert.rejects(dispatchOnce({ state: prepared, invoke: { request() {} } }));
  assert.equal(proposal.state, 'PROPOSED');
});
test('P4 simulator argument proxies are refused without trap execution', () => {
  let hits = 0;
  const hostile = new Proxy({}, {
    getPrototypeOf() { hits += 1; return Object.prototype; },
    ownKeys() { hits += 1; return []; },
    getOwnPropertyDescriptor() { hits += 1; return undefined; },
  });
  assert.throws(() => confirm(hostile));
  assert.equal(hits, 0);
});
test('P4 callback outcome and reconciliation proxies are refused without executing traps', async () => {
  const makeProxy = () => {
    let hits = 0;
    const value = new Proxy({}, {
      getPrototypeOf() { hits += 1; return Object.prototype; }, ownKeys() { hits += 1; return []; },
      getOwnPropertyDescriptor() { hits += 1; return undefined; }, get() { hits += 1; return undefined; },
    });
    return { value, hits: () => hits };
  };
  const first = confirmed();
  const prepared = prepare({ state: first.state, subject: subject(), now: '2026-09-01T12:01:40.000Z' });
  const outcome = makeProxy();
  const result = await dispatchOnce({ state: prepared, invoke: () => outcome.value });
  assert.equal(result.state.world.effects[result.state.effectId].state, 'UNKNOWN_EFFECT');
  assert.equal(outcome.hits(), 0);
  const observed = makeProxy();
  const blocked = reconcile({ state: result.state, observation: observed.value });
  assert.equal(blocked.world.effects[blocked.effectId].state, 'RECONCILIATION_BLOCKED');
  assert.equal(observed.hits(), 0);
});
test('P4 forged and Proxy state wrappers are refused without nested access', async () => {
  const { state } = confirmed();
  const prepared = prepare({ state, subject: subject(), now: '2026-09-01T12:01:40.000Z' });
  const response = fakeResponse(prepared);
  const dispatched = await dispatchOnce({ state: prepared, invoke: () => ({ kind: 'RESPONSE', response }) });
  const forged = Object.freeze({ world: dispatched.state.world, effectId: dispatched.state.effectId });
  assert.throws(() => admitResponse({ state: forged, response }));
  let hits = 0;
  const hostile = new Proxy(forged, { get() { hits += 1; return undefined; }, getPrototypeOf() { hits += 1; return Object.prototype; } });
  assert.throws(() => admitResponse({ state: hostile, response }));
  assert.equal(hits, 0);
});
test('P4 Promise subclasses and altered-array prototypes execute no hostile getters', async () => {
  const first = confirmed();
  const prepared = prepare({ state: first.state, subject: subject(), now: '2026-09-01T12:01:40.000Z' });
  class HostilePromise extends Promise {}
  const pending = new HostilePromise(() => {}); let thenHits = 0;
  Object.defineProperty(pending, 'then', { get() { thenHits += 1; throw new Error('then getter'); } });
  const result = await dispatchOnce({ state: prepared, invoke: () => pending });
  assert.equal(result.state.world.effects[result.state.effectId].state, 'UNKNOWN_EFFECT');
  assert.equal(thenHits, 0);
  const comments = []; let mapHits = 0;
  Object.setPrototypeOf(comments, Object.defineProperty({}, 'map', { get() { mapHits += 1; return Array.prototype.map; } }));
  const blocked = reconcile({ state: result.state, observation: observation(result.state, comments) });
  assert.equal(blocked.world.effects[blocked.effectId].state, 'RECONCILIATION_BLOCKED');
  assert.equal(mapHits, 0);
});
test('P4 live confirmation and preparation enforce monotonic timeline order', () => {
  const proposal = createProposal(proposalArgs(subject()));
  const decision = decisionFor(proposal);
  assert.throws(() => confirm({ proposal, decision, now: '2026-09-01T12:00:59.000Z' }));
  const state = confirm({ proposal, decision, now: '2026-09-01T12:01:30.000Z' });
  assert.throws(() => prepare({ state, subject: subject(), now: '2026-09-01T12:01:29.000Z' }));
});
test('P4 nested proposal Proxies are refused before semantic lookup without traps', () => {
  let hits = 0;
  const proposal = new Proxy({}, { get() { hits += 1; return undefined; } });
  assert.throws(() => confirm({ proposal, decision: {}, now: '2026-09-01T12:01:30.000Z' }));
  assert.equal(hits, 0);
});
test('P4 Promise subclasses are outside custody and refused without descriptor access', async () => {
  const run = async pending => {
    scenarioSubject = nextSubject();
    const first = confirmed();
    const prepared = prepare({ state: first.state, subject: subject(), now: '2026-09-01T12:01:40.000Z' });
    const result = await dispatchOnce({ state: prepared, invoke: () => pending });
    assert.equal(result.state.world.effects[result.state.effectId].state, 'UNKNOWN_EFFECT');
  };
  class HostileConstructor extends Promise {}
  let constructorHits = 0;
  const constructorValue = new HostileConstructor(resolve => resolve({}));
  Object.defineProperty(constructorValue, 'constructor', { get() { constructorHits += 1; throw new Error('constructor getter'); } });
  await run(constructorValue);
  class HostileSpecies extends Promise {}
  let speciesHits = 0;
  Object.defineProperty(HostileSpecies, Symbol.species, { get() { speciesHits += 1; throw new Error('species getter'); } });
  await run(new HostileSpecies(resolve => resolve({})));
  assert.equal(constructorHits, 0);
  assert.equal(speciesHits, 0);
});
test('P4 semantic custody refuses separately constructed proposals for one exact subject', async () => {
  const first = createProposal(proposalArgs(subject()));
  const second = createProposal({ ...proposalArgs(subject()), effectId: 'effect-0002' });
  const firstState = confirm({ proposal: first, decision: decisionFor(first), now: '2026-09-01T12:01:30.000Z' });
  assert.throws(() => confirm({ proposal: second, decision: decisionFor(second), now: '2026-09-01T12:01:31.000Z' }));
  const prepared = prepare({ state: firstState, subject: subject(), now: '2026-09-01T12:01:40.000Z' });
  let calls = 0;
  await dispatchOnce({ state: prepared, invoke: () => { calls += 1; return { kind: 'UNKNOWN', reason: 'TIMEOUT_SHAPED' }; } });
  assert.equal(calls, 1);
});
test('P4 semantic custody also refuses a separately constructed identical effect', () => {
  const first = createProposal(proposalArgs(subject()));
  const second = createProposal(proposalArgs(subject()));
  confirm({ proposal: first, decision: decisionFor(first), now: '2026-09-01T12:01:30.000Z' });
  assert.throws(() => confirm({ proposal: second, decision: decisionFor(second), now: '2026-09-01T12:01:31.000Z' }));
});
test('P4 one proposal cannot fork into two confirmed worlds', () => {
  const proposal = createProposal(proposalArgs(subject()));
  const decision = decisionFor(proposal);
  confirm({ proposal, decision, now: '2026-09-01T12:01:30.000Z' });
  assert.throws(() => confirm({ proposal, decision, now: '2026-09-01T12:01:31.000Z' }));
});
test('P4 one confirmed state cannot fork into two prepared dispatches', async () => {
  const { state } = confirmed();
  const first = prepare({ state, subject: subject(), now: '2026-09-01T12:01:40.000Z' });
  assert.throws(() => prepare({ state, subject: subject(), now: '2026-09-01T12:01:41.000Z' }));
  let calls = 0;
  await dispatchOnce({ state: first, invoke: async () => { calls += 1; return { kind: 'UNKNOWN', reason: 'TIMEOUT_SHAPED' }; } });
  assert.equal(calls, 1);
});
test('P4 concurrent dispatch invokes at most once and consumes timeout ambiguity', async () => {
  const { state } = confirmed();
  const prepared = prepare({ state, subject: subject(), now: '2026-09-01T12:01:40.000Z' });
  let calls = 0;
  const invoke = async request => {
    calls += 1;
    assert.ok(Object.isFrozen(request));
    await new Promise(resolve => setTimeout(resolve, 5));
    return { kind: 'UNKNOWN', reason: 'TIMEOUT_SHAPED' };
  };
  const results = await Promise.allSettled([
    dispatchOnce({ state: prepared, invoke }),
    dispatchOnce({ state: prepared, invoke }),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(results.map(result => result.status).sort(), ['fulfilled', 'rejected']);
  const value = results.find(result => result.status === 'fulfilled').value;
  assert.equal(value.state.world.effects[value.state.effectId].state, 'UNKNOWN_EFFECT');
  await assert.rejects(dispatchOnce({ state: prepared, invoke }));
});
test('P4 thrown and rejected callbacks become non-retryable UNKNOWN_EFFECT', async () => {
  for (const invoke of [() => { throw new Error('boom'); }, async () => Promise.reject(new Error('nope'))]) {
    scenarioSubject = nextSubject();
    const { state } = confirmed();
    const prepared = prepare({ state, subject: subject(), now: '2026-09-01T12:01:40.000Z' });
    const result = await dispatchOnce({ state: prepared, invoke });
    assert.equal(result.state.world.effects[result.state.effectId].state, 'UNKNOWN_EFFECT');
    await assert.rejects(dispatchOnce({ state: prepared, invoke }));
  }
});
// P5 exact response and reconciliation.
const fakeResponse = prepared => {
  const item = prepared.world.effects[prepared.effectId];
  return { schema: 'aca-simulated-comment-response/v1', status: 201, comment: { id: 707,
    nodeId: 'IC_fixture707', actorNodeId: 'ACTOR_fixture_owner', body: item.proposal.body,
    marker: `<!-- aca-effect:${item.effectId} -->`, subjectDigest: item.subjectDigest,
    createdAt: '2026-09-01T12:02:00.000Z', updatedAt: '2026-09-01T12:02:00.000Z' } };
};
const ambiguous = async () => {
  scenarioSubject = nextSubject();
  const { state } = confirmed();
  const prepared = prepare({ state, subject: subject(), now: '2026-09-01T12:01:40.000Z' });
  return (await dispatchOnce({ state: prepared, invoke: () => ({ kind: 'UNKNOWN', reason: 'TIMEOUT_SHAPED' }) })).state;
};
const observation = (state, comments, overrides = {}) => ({ schema: 'aca-simulated-comment-observation/v1',
  complete: true, stable: true, bounded: true, subjectDigest: state.world.effects[state.effectId].subjectDigest,
  actorNodeId: 'ACTOR_fixture_owner', observedAt: '2026-09-01T12:03:00.000Z', comments, ...overrides });
test('P5 exact response and observation evidence cannot predate dispatch', async () => {
  const { state } = confirmed();
  const prepared = prepare({ state, subject: subject(), now: '2026-09-01T12:01:40.000Z' });
  const response = fakeResponse(prepared);
  const dispatched = await dispatchOnce({ state: prepared, invoke: () => ({ kind: 'RESPONSE', response }) });
  const predated = { ...response, comment: { ...response.comment,
    createdAt: '2026-09-01T12:01:40.000Z', updatedAt: '2026-09-01T12:01:40.000Z' } };
  assert.throws(() => admitResponse({ state: dispatched.state, response: predated }));
  const unknown = await ambiguous();
  const blocked = reconcile({ state: unknown, observation: observation(unknown, [predated.comment]) });
  assert.equal(blocked.world.effects[blocked.effectId].state, 'RECONCILIATION_BLOCKED');
});
test('P5 reconciliation requires a causal observation timestamp', async () => {
  const state = await ambiguous();
  const { observedAt, ...missingTimestamp } = observation(state, []);
  const blocked = reconcile({ state, observation: missingTimestamp });
  assert.equal(blocked.world.effects[blocked.effectId].state, 'RECONCILIATION_BLOCKED');
});
test('P5 response timestamps must be monotonic', async () => {
  const { state } = confirmed();
  const prepared = prepare({ state, subject: subject(), now: '2026-09-01T12:01:40.000Z' });
  const response = fakeResponse(prepared);
  const dispatched = await dispatchOnce({ state: prepared, invoke: () => ({ kind: 'RESPONSE', response }) });
  const retrograde = { ...response, comment: { ...response.comment, updatedAt: '2026-09-01T12:01:59.000Z' } };
  assert.throws(() => admitResponse({ state: dispatched.state, response: retrograde }));
});
test('P5 contradictory exact-body reconciliation evidence is blocked, not absent', async () => {
  const state = await ambiguous();
  const comment = { ...fakeResponse(state).comment, marker: '<!-- aca-effect:wrong -->' };
  const blocked = reconcile({ state, observation: observation(state, [comment]) });
  assert.equal(blocked.world.effects[blocked.effectId].state, 'RECONCILIATION_BLOCKED');
});
test('P5 forged wrappers cannot fork response or reconciliation custody', async () => {
  const { state } = confirmed();
  const prepared = prepare({ state, subject: subject(), now: '2026-09-01T12:01:40.000Z' });
  const response = fakeResponse(prepared);
  const dispatched = await dispatchOnce({ state: prepared, invoke: () => ({ kind: 'RESPONSE', response }) });
  const forgedDispatch = Object.freeze({ world: dispatched.state.world, effectId: dispatched.state.effectId });
  assert.throws(() => admitResponse({ state: forgedDispatch, response }));
  const unknown = await ambiguous();
  const forgedUnknown = Object.freeze({ world: unknown.world, effectId: unknown.effectId });
  assert.throws(() => reconcile({ state: forgedUnknown, observation: observation(unknown, []) }));
});
test('P5 one dispatch state admits at most one response branch', async () => {
  const { state } = confirmed();
  const prepared = prepare({ state, subject: subject(), now: '2026-09-01T12:01:40.000Z' });
  const response = fakeResponse(prepared);
  const dispatched = await dispatchOnce({ state: prepared, invoke: () => ({ kind: 'RESPONSE', response }) });
  admitResponse({ state: dispatched.state, response });
  assert.throws(() => admitResponse({ state: dispatched.state, response }));
});
test('P5 one ambiguous state admits at most one reconciliation branch', async () => {
  const state = await ambiguous();
  const exact = observation(state, [fakeResponse(state).comment]);
  reconcile({ state, observation: exact });
  assert.throws(() => reconcile({ state, observation: exact }));
});
test('P5 a closed 201 response is admitted but does not itself settle APPLIED', async () => {
  const { state } = confirmed();
  const prepared = prepare({ state, subject: subject(), now: '2026-09-01T12:01:40.000Z' });
  const response = fakeResponse(prepared);
  const dispatched = await dispatchOnce({ state: prepared, invoke: () => ({ kind: 'RESPONSE', response }) });
  assert.equal(dispatched.state.world.effects[dispatched.state.effectId].state, 'DISPATCHING');
  const admitted = admitResponse({ state: dispatched.state, response: dispatched.response });
  assert.equal(admitted.world.effects[admitted.effectId].state, 'RESPONSE_ADMITTED');
  assert.notEqual(admitted.world.effects[admitted.effectId].state, 'APPLIED');
  for (const bad of [{ status: 201 }, { ...response, comment: { ...response.comment, body: 'partial' } },
    { ...response, comment: { ...response.comment, marker: 'aca-effect' } },
    { ...response, comment: { ...response.comment, actorNodeId: 'ACTOR_wrong' } }]) {
    assert.throws(() => admitResponse({ state: dispatched.state, response: bad }));
  }
});
test('P5 only one exact complete stable bounded observation settles APPLIED', async () => {
  const state = await ambiguous();
  const comment = fakeResponse(state).comment;
  const applied = reconcile({ state, observation: observation(state, [comment]) });
  assert.equal(applied.world.effects[applied.effectId].state, 'APPLIED');
  for (const bad of [
    observation(state, [comment, { ...comment, id: 708, nodeId: 'IC_fixture708' }]),
    observation(state, [{ ...comment, body: 'wrong' }]),
    observation(state, [{ ...comment, actorNodeId: 'ACTOR_wrong' }]),
    observation(state, [{ ...comment, subjectDigest: '0'.repeat(64) }]),
    observation(state, [comment], { complete: false }),
    observation(state, [comment], { stable: false }),
    observation(state, [comment], { bounded: false }),
  ]) {
    const blocked = reconcile({ state: await ambiguous(), observation: bad });
    assert.equal(blocked.world.effects[blocked.effectId].state, 'RECONCILIATION_BLOCKED');
  }
});
test('P5 complete stable zero-match reconciliation consumes ABSENT_TERMINAL without retry', async () => {
  const state = await ambiguous();
  const absent = reconcile({ state, observation: observation(state, []) });
  assert.equal(absent.world.effects[absent.effectId].state, 'ABSENT_TERMINAL');
  await assert.rejects(dispatchOnce({ state: absent, invoke: () => { throw new Error('must not run'); } }));
});
test('P6 projects genuine replay reducer states instead of WRITE_BLOCKED', () => {
  const proposal = createProposalRecord(proposalArgs(subject()));
  let state = emptyEffectState();
  const record = createJournalRecord(state, { transition: 'PROPOSED', timestamp: proposal.issuedAt,
    effectId: proposal.effectId, semanticKey: proposal.semanticKey, subjectDigest: proposal.subjectDigest,
    proposalDigest: proposal.proposalDigest, requestDigest: '', payload: { proposal } });
  state = validateAndReduce(state, record);
  assert.equal(project(state).status, 'PROPOSED');
});
test('P6 projects reducer-only terminal states and blocks forged state shapes', () => {
  const make = terminal => {
    const proposal = createProposalRecord(proposalArgs(subject()));
    let state = emptyEffectState();
    const step = (transition, timestamp, payload) => {
      const current = state.effects[proposal.effectId];
      state = validateAndReduce(state, createJournalRecord(state, { transition, timestamp,
        effectId: proposal.effectId, semanticKey: proposal.semanticKey, subjectDigest: proposal.subjectDigest,
        proposalDigest: proposal.proposalDigest, requestDigest: current?.requestDigest ?? '', payload }));
    };
    step('PROPOSED', proposal.issuedAt, { proposal });
    if (terminal === 'REFUSED_PRE_EFFECT') step('CONFIRMED', '2026-09-01T12:01:30.000Z', { decision: decisionFor(proposal) });
    step(terminal, '2026-09-01T12:01:40.000Z', { reason: 'OWNER_TERMINAL' });
    return state;
  };
  for (const status of ['EXPIRED', 'SUPERSEDED', 'CANCELLED_BEFORE_PREPARE', 'REFUSED_PRE_EFFECT']) {
    assert.equal(project(make(status)).status, status);
  }
  assert.equal(project({ sequence: 1, effects: { forged: { state: 'APPLIED' } } }).status, 'WRITE_BLOCKED');
});
test('P6 projection uses distinct state copy and permanent fixture-only non-authority labels', async () => {
  const proposal = createProposal(proposalArgs(subject()));
  const confirmedState = confirm({ proposal, decision: decisionFor(proposal), now: '2026-09-01T12:01:30.000Z' });
  const preparedState = prepare({ state: confirmedState, subject: subject(), now: '2026-09-01T12:01:40.000Z' });
  const response = fakeResponse(preparedState);
  const dispatched = await dispatchOnce({ state: preparedState, invoke: () => ({ kind: 'RESPONSE', response }) });
  const admitted = admitResponse({ state: dispatched.state, response });
  const applied = reconcile({ state: admitted, observation: observation(admitted, [response.comment]) });
  const absentSource = await ambiguous();
  const absent = reconcile({ state: absentSource, observation: observation(absentSource, []) });
  const blockedSource = await ambiguous();
  const blocked = reconcile({ state: blockedSource, observation: observation(blockedSource, [
    { ...fakeResponse(blockedSource).comment, marker: '<!-- aca-effect:wrong -->' }]) });
  const values = [project(null), project(proposal), project(confirmedState), project(preparedState),
    project(dispatched.state), project(await ambiguous()), project(admitted), project(applied), project(blocked), project(absent)];
  assert.deepEqual(values.map(value => value.status), ['WRITE_BLOCKED', 'PROPOSED', 'CONFIRMED', 'PREPARED', 'DISPATCHING', 'UNKNOWN_EFFECT', 'RESPONSE_ADMITTED', 'APPLIED', 'RECONCILIATION_BLOCKED', 'ABSENT_TERMINAL']);
  assert.equal(new Set(values.map(value => value.copy)).size, values.length);
  for (const value of values) {
    assert.equal(value.providerMode, 'FIXTURE_ONLY');
    assert.equal(value.liveAuthority, 'NONE');
    assert.equal(value.effectCapability, 'ABSENT');
    assert.equal(value.liveEffectAttempted, false);
    assert.doesNotMatch(value.copy, /live GitHub (comment|effect) (created|applied|proved)/i);
  }
  assert.match(project(await ambiguous()).copy, /retry prohibited/i);
  assert.match(project(applied).copy, /simulated observation.*not live GitHub proof/i);
});
export { confirmed, decisionFor, fakeResponse, observation };
