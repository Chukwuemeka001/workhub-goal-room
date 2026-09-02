import { types } from 'node:util';
import { admitSubject, assertOrdinaryData, canonicalJson, createJournalRecord, createProposalRecord, digest, emptyEffectState, instant, projectEffectState, validateAndReduce } from './effect-state.mjs';

const proposalSubjects = new WeakMap();
const confirmedProposals = new WeakSet();
const semanticProposals = new Map();
const effectProposals = new Map();
const preparedSources = new WeakSet();
const stateSubjects = new WeakMap();
const wrapperData = new WeakMap();
const preparedStates = new WeakSet();
const consumedStates = new WeakSet();
const responseSources = new WeakSet();
const reconciliationSources = new WeakSet();
const fail = message => { throw new Error(message); };
const closed = (value, expected, label) => {
  if (types.isProxy(value) || value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${label}: plain object required`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(value);
  if (actual.length !== expected.length || !expected.every(key => actual.includes(key))) fail(`${label}: closed keys required`);
  for (const key of expected) if (!descriptors[key]?.enumerable || !('value' in descriptors[key])) fail(`${label}: data properties required`);
};
const wrap = (world, effectId, subject) => {
  const state = Object.freeze({ world, effectId });
  wrapperData.set(state, Object.freeze({ world, effectId, subject }));
  stateSubjects.set(state, subject);
  return state;
};
const data = state => wrapperData.get(state);
const effect = state => { const item = data(state); return item?.world?.effects?.[item.effectId]; };
const event = (item, transition, timestamp, payload) => ({ transition, timestamp, effectId: item.effectId,
  semanticKey: item.semanticKey, subjectDigest: item.subjectDigest, proposalDigest: item.proposalDigest,
  requestDigest: item.requestDigest ?? '', payload });
const advance = (state, transition, timestamp, payload) => {
  const custody = data(state); const item = effect(state);
  if (!custody || !item) fail('state custody refused');
  const record = createJournalRecord(custody.world, event(item, transition, timestamp, payload));
  return wrap(validateAndReduce(custody.world, record), custody.effectId, custody.subject);
};

export function createProposal(args) {
  const proposal = createProposalRecord(args);
  proposalSubjects.set(proposal, admitSubject(args.subject));
  return proposal;
}

export function confirm(args) {
  closed(args, ['proposal', 'decision', 'now'], 'confirm arguments');
  const subject = proposalSubjects.get(args.proposal);
  if (!subject) fail('proposal custody or expiry refused');
  const semanticProposal = semanticProposals.get(args.proposal.semanticKey);
  const effectProposal = effectProposals.get(args.proposal.effectId);
  if ((semanticProposal && semanticProposal !== args.proposal) || (effectProposal && effectProposal !== args.proposal) || confirmedProposals.has(args.proposal) || instant(args.now) < instant(args.proposal.issuedAt) || instant(args.now) >= instant(args.proposal.expiresAt)) fail('proposal custody or expiry refused');
  let world = emptyEffectState();
  let record = createJournalRecord(world, event(args.proposal, 'PROPOSED', args.proposal.issuedAt, { proposal: args.proposal }));
  world = validateAndReduce(world, record);
  record = createJournalRecord(world, event(args.proposal, 'CONFIRMED', args.now, { decision: args.decision }));
  const confirmed = validateAndReduce(world, record);
  confirmedProposals.add(args.proposal);
  semanticProposals.set(args.proposal.semanticKey, args.proposal);
  effectProposals.set(args.proposal.effectId, args.proposal);
  return wrap(confirmed, args.proposal.effectId, subject);
}

export function prepare(args) {
  closed(args, ['state', 'subject', 'now'], 'prepare arguments');
  const custody = data(args.state); const current = effect(args.state);
  if (!custody || !current || current.state !== 'CONFIRMED' || preparedSources.has(args.state) || instant(args.now) < instant(custody.world.lastTimestamp) || instant(args.now) >= instant(current.proposal.expiresAt)) fail('state is not preparable');
  const fresh = admitSubject(args.subject);
  if (canonicalJson(fresh) !== canonicalJson(stateSubjects.get(args.state))) fail('subject moved after confirmation');
  const request = Object.freeze({ action: current.proposal.action, effectId: current.effectId,
    subjectDigest: current.subjectDigest, proposalDigest: current.proposalDigest,
    bodyDigest: current.proposal.bodyDigest, body: current.proposal.body });
  const state = advance(args.state, 'PREPARED', args.now, { request });
  preparedSources.add(args.state);
  preparedStates.add(state);
  return state;
}

export async function dispatchOnce(args) {
  closed(args, ['state', 'invoke'], 'dispatch arguments');
  const prepared = data(args.state);
  if (typeof args.invoke !== 'function' || !prepared || !preparedStates.has(args.state) || consumedStates.has(args.state)) fail('dispatch custody refused');
  consumedStates.add(args.state);
  const dispatchTimestamp = new Date(instant(prepared.world.lastTimestamp) + 1).toISOString();
  const dispatching = advance(args.state, 'DISPATCHING', dispatchTimestamp, {});
  const stamp = data(dispatching).world.lastTimestamp;
  let pending;
  try { pending = args.invoke(effect(dispatching).request); }
  catch { return { state: advance(dispatching, 'UNKNOWN_EFFECT', stamp, { reason: 'INVOKE_THROWN' }), response: null }; }
  let outcome;
  if (types.isProxy(pending)) {
    return { state: advance(dispatching, 'UNKNOWN_EFFECT', stamp, { reason: 'INVOKE_REJECTED' }), response: null };
  }
  if (types.isPromise(pending) && Object.getPrototypeOf(pending) === Promise.prototype && !Reflect.ownKeys(pending).some(key => typeof key === 'string')) {
    try { outcome = await new Promise((resolve, reject) => Promise.prototype.then.call(pending, resolve, reject)); }
    catch { return { state: advance(dispatching, 'UNKNOWN_EFFECT', stamp, { reason: 'INVOKE_REJECTED' }), response: null }; }
  } else if (types.isPromise(pending)) {
    return { state: advance(dispatching, 'UNKNOWN_EFFECT', stamp, { reason: 'INVOKE_REJECTED' }), response: null };
  } else {
    try { assertOrdinaryData(pending, 'closed simulator outcome'); outcome = pending; }
    catch { return { state: advance(dispatching, 'UNKNOWN_EFFECT', stamp, { reason: 'INVOKE_REJECTED' }), response: null }; }
  }
  try {
    assertOrdinaryData(outcome, 'closed simulator outcome');
    if (outcome.kind === 'RESPONSE') {
      closed(outcome, ['kind', 'response'], 'closed simulator outcome');
      return { state: dispatching, response: outcome.response };
    }
    closed(outcome, ['kind', 'reason'], 'closed simulator outcome');
    if (outcome.kind !== 'UNKNOWN' || outcome.reason !== 'TIMEOUT_SHAPED') fail('outcome refused');
    return { state: advance(dispatching, 'UNKNOWN_EFFECT', stamp, { reason: outcome.reason }), response: null };
  } catch {
    return { state: advance(dispatching, 'UNKNOWN_EFFECT', stamp, { reason: 'INVOKE_REJECTED' }), response: null };
  }
}

export function admitResponse(args) {
  closed(args, ['state', 'response'], 'response arguments');
  const custody = data(args.state); const current = effect(args.state);
  if (!custody || current?.state !== 'DISPATCHING' || responseSources.has(args.state)) fail('response state refused');
  assertOrdinaryData(args.response, 'simulated response');
  const admitted = advance(args.state, 'RESPONSE_ADMITTED', args.response.comment.updatedAt, { response: args.response });
  responseSources.add(args.state);
  return admitted;
}

export function reconcile(args) {
  closed(args, ['state', 'observation'], 'reconcile arguments');
  const custody = data(args.state); const current = effect(args.state);
  if (!custody || !['UNKNOWN_EFFECT', 'RESPONSE_ADMITTED'].includes(current?.state) || reconciliationSources.has(args.state)) fail('reconciliation state refused');
  let ordinary = true;
  try { assertOrdinaryData(args.observation, 'simulated observation'); } catch { ordinary = false; }
  let stamp = new Date(instant(custody.world.lastTimestamp) + 1).toISOString();
  if (ordinary) {
    const candidates = [args.observation.observedAt];
    if (Array.isArray(args.observation.comments)) for (const comment of args.observation.comments) candidates.push(comment?.createdAt, comment?.updatedAt);
    for (const candidate of candidates) try { if (instant(candidate) > instant(stamp)) stamp = candidate; } catch { /* malformed evidence remains blocked */ }
  }
  if (ordinary) {
    for (const transition of ['APPLIED', 'ABSENT_TERMINAL']) {
      try {
        const result = advance(args.state, transition, stamp, { observation: args.observation });
        reconciliationSources.add(args.state); return result;
      } catch { /* classify below */ }
    }
  }
  let ambiguous = args.state;
  if (current.state === 'RESPONSE_ADMITTED') ambiguous = advance(args.state, 'UNKNOWN_EFFECT', stamp, { reason: 'REPLAY_RECOVERY' });
  const observationDigest = ordinary ? digest(args.observation) : digest('UNREADABLE_SIMULATED_OBSERVATION');
  const blocked = advance(ambiguous, 'RECONCILIATION_BLOCKED', stamp, { observationDigest, reason: 'NOT_ONE_EXACT_STABLE_MATCH' });
  reconciliationSources.add(args.state); return blocked;
}

const COPY = {
  WRITE_BLOCKED: 'Exact subject unavailable; no effect attempted.',
  MULTIPLE_EFFECTS: 'Multiple admitted fixture effects exist; inspect them individually; no live authority.',
  PROPOSED: 'Advisory comment proposed; no effect attempted.',
  CONFIRMED: 'Owner intent represented in the simulation; provider not contacted.',
  PREPARED: 'One-use identity consumed; provider not contacted.',
  DISPATCHING: 'Simulated attempt began; outcome unknown.',
  UNKNOWN_EFFECT: 'May or may not have applied in the fixture; retry prohibited.',
  RESPONSE_ADMITTED: 'Exact fake response admitted; reconciliation required; retry prohibited.',
  APPLIED: 'Exact simulated observation admitted; not live GitHub proof.',
  EXPIRED: 'Proposal expired before effect; no write and no retry authority.',
  SUPERSEDED: 'Proposal superseded before effect; no write and no retry authority.',
  CANCELLED_BEFORE_PREPARE: 'Proposal cancelled before prepare; no write and no retry authority.',
  REFUSED_PRE_EFFECT: 'Effect refused before dispatch; no write and no retry authority.',
  RECONCILIATION_BLOCKED: 'Fixture reconciliation blocked; identity consumed and retry prohibited.',
  ABSENT_TERMINAL: 'Complete fixture observation found no exact match; identity consumed and retry prohibited.',
};
export function project(state) {
  let status = 'WRITE_BLOCKED';
  if (proposalSubjects.has(state)) status = 'PROPOSED';
  else if (stateSubjects.has(state)) status = effect(state).state;
  else status = projectEffectState(state) ?? status;
  return Object.freeze({ status, copy: COPY[status], providerMode: 'FIXTURE_ONLY', liveAuthority: 'NONE',
    effectCapability: 'ABSENT', liveEffectAttempted: false });
}
