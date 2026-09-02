import { createHash } from 'node:crypto';
import { types } from 'node:util';
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const REPOSITORY_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,98}[A-Za-z0-9])?$/;
const ASCII = /^[\x20-\x7e]{1,160}$/;
const SUBJECT_KEYS = ['schema', 'provider', 'repository', 'pull', 'localCandidate', 'qualification', 'observedAt', 'trustedTupleDigest', 'subjectDigest'];
const admittedEffectStates = new WeakSet();
export const canonicalJson = value => {
  assertOrdinaryData(value, 'canonical value');
  const encode = item => item === null || typeof item !== 'object'
    ? JSON.stringify(item)
    : Array.isArray(item)
      ? `[${Array.prototype.map.call(item, encode).join(',')}]`
      : `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${encode(item[key])}`).join(',')}}`;
  return encode(value);
};
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
const fail = message => { throw new Error(message); };
const keys = (value, expected, label) => {
  if (types.isProxy(value) || value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${label}: plain object required`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(value);
  if (actual.some(key => typeof key !== 'string') || actual.length !== expected.length || !expected.every(key => actual.includes(key))) fail(`${label}: closed keys required`);
  for (const key of expected) if (!descriptors[key]?.enumerable || !('value' in descriptors[key])) fail(`${label}: data properties required`);
  return descriptors;
};
const integer = (value, label, zero = false) => {
  if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1)) fail(`${label}: safe integer required`);
};
const text = (value, pattern, label) => {
  if (typeof value !== 'string' || !pattern.test(value)) fail(`${label}: invalid text`);
};
const timestamp = (value, label) => {
  if (typeof value !== 'string') fail(`${label}: canonical UTC required`);
  let date;
  try { date = new Date(value); if (date.toISOString() !== value) fail(`${label}: canonical UTC required`); }
  catch { fail(`${label}: canonical UTC required`); }
  return date.getTime();
};
export const instant = value => timestamp(value, 'timestamp');
export function assertOrdinaryData(value, label = 'value', seen = new Set()) {
  if (value === null || typeof value !== 'object') {
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint' || (typeof value === 'number' && !Number.isFinite(value))) fail(`${label}: ordinary data required`);
    return value;
  }
  if (types.isProxy(value) || seen.has(value)) fail(`${label}: proxy or cycle refused`);
  seen.add(value);
  const array = Array.isArray(value);
  if (array ? Object.getPrototypeOf(value) !== Array.prototype : Object.getPrototypeOf(value) !== Object.prototype) fail(`${label}: ordinary prototype required`);
  const descriptors = Object.getOwnPropertyDescriptors(value); const own = Reflect.ownKeys(value);
  if (own.some(key => typeof key !== 'string')) fail(`${label}: string keys required`);
  if (array) {
    if (own.length !== value.length + 1 || descriptors.length?.value !== value.length) fail(`${label}: dense array required`);
    for (let index = 0; index < value.length; index++) if (!Object.hasOwn(descriptors, String(index))) fail(`${label}: dense array required`);
  }
  for (const key of own) {
    const descriptor = descriptors[key];
    if (key === 'length' && array) continue;
    if (!descriptor?.enumerable || !('value' in descriptor)) fail(`${label}: data properties required`);
    assertOrdinaryData(descriptor.value, `${label}.${key}`, seen);
  }
  seen.delete(value); return value;
}
const cloneFreeze = value => {
  let copy;
  try { copy = structuredClone(value); } catch { fail('proxy or uncloneable value refused'); }
  const freeze = item => {
    if (item && typeof item === 'object') { for (const child of Object.values(item)) freeze(child); Object.freeze(item); }
    return item;
  };
  return freeze(copy);
};
const without = (value, omitted) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== omitted));
export function admitSubject(value) {
  keys(value, SUBJECT_KEYS, 'subject');
  keys(value.repository, ['id', 'nodeId', 'owner', 'name'], 'repository');
  keys(value.pull, ['id', 'nodeId', 'number', 'state', 'draft', 'headRepository', 'headSha', 'baseSha'], 'pull');
  keys(value.pull.headRepository, ['id', 'nodeId'], 'headRepository');
  keys(value.localCandidate, ['commit', 'tree', 'manifestDigest', 'trackedState', 'nonExcludedUntrackedCount'], 'localCandidate');
  keys(value.qualification, ['commit', 'tree', 'status', 'aggregate', 'receiptDigest', 'installedDigest'], 'qualification');
  if (value.schema !== 'aca-exact-remote-subject/v1' || value.provider !== 'GITHUB') fail('subject schema/provider refused');
  integer(value.repository.id, 'repository.id');
  integer(value.pull.id, 'pull.id'); integer(value.pull.number, 'pull.number'); integer(value.pull.headRepository.id, 'headRepository.id');
  for (const [item, label] of [[value.repository.nodeId, 'repository.nodeId'], [value.pull.nodeId, 'pull.nodeId'], [value.pull.headRepository.nodeId, 'headRepository.nodeId']]) text(item, ASCII, label);
  text(value.repository.owner, REPOSITORY_NAME, 'repository.owner'); text(value.repository.name, REPOSITORY_NAME, 'repository.name');
  for (const [item, label] of [[value.pull.headSha, 'headSha'], [value.pull.baseSha, 'baseSha'], [value.localCandidate.commit, 'candidate.commit'], [value.localCandidate.tree, 'candidate.tree'], [value.qualification.commit, 'qualification.commit'], [value.qualification.tree, 'qualification.tree']]) text(item, HEX40, label);
  for (const [item, label] of [[value.localCandidate.manifestDigest, 'manifestDigest'], [value.qualification.receiptDigest, 'receiptDigest'], [value.qualification.installedDigest, 'installedDigest'], [value.trustedTupleDigest, 'trustedTupleDigest'], [value.subjectDigest, 'subjectDigest']]) text(item, HEX64, label);
  if (value.pull.state !== 'OPEN' || value.pull.draft !== false || value.localCandidate.trackedState !== 'CLEAN' || value.localCandidate.nonExcludedUntrackedCount !== 0 || value.qualification.status !== 'QUALIFIED' || value.qualification.aggregate !== 'ALL_REQUIRED_COMPLETE') fail('subject is not exact, clean, and qualified');
  if (value.pull.headSha !== value.localCandidate.commit || value.qualification.commit !== value.localCandidate.commit || value.qualification.tree !== value.localCandidate.tree) fail('subject equality fence failed');
  timestamp(value.observedAt, 'observedAt');
  if (digest(without(value, 'subjectDigest')) !== value.subjectDigest) fail('subject digest mismatch');
  return cloneFreeze(value);
}
export function createProposalRecord(args) {
  keys(args, ['subject', 'evidence', 'effectId', 'now', 'expiresAt'], 'proposal arguments');
  keys(args.evidence, ['unit', 'build'], 'evidence');
  const subject = admitSubject(args.subject);
  text(args.effectId, SAFE_ID, 'effectId'); timestamp(args.now, 'now'); timestamp(args.expiresAt, 'expiresAt');
  if (instant(args.now) < instant(subject.observedAt) || instant(args.now) >= instant(args.expiresAt) || args.evidence.unit !== 'ACA_EFFECT_PREFLIGHT' || args.evidence.build !== 'QUALIFIED_LOCAL_COMMIT') fail('proposal evidence or expiry refused');
  const body = `Agent Change Assurance advisory\nHead: ${subject.pull.headSha}\nQualification: ${subject.qualification.receiptDigest}\nUnit: ${args.evidence.unit}\nBuild: ${args.evidence.build}\nObserved: ${subject.observedAt}\nThis advisory does not approve, merge, deploy, or create provider authority.\n<!-- aca-effect:${args.effectId} -->`;
  const proposal = {
    schema: 'aca-effect-proposal/v1', effectId: args.effectId, action: 'CREATE_ADVISORY_PR_COMMENT_V1',
    subject, subjectDigest: subject.subjectDigest, qualificationReceiptDigest: subject.qualification.receiptDigest,
    body, bodyBytes: Buffer.byteLength(body), bodyDigest: digest(body), semanticKey: digest(`CREATE_ADVISORY_PR_COMMENT_V1\n${subject.subjectDigest}`),
    issuedAt: args.now, expiresAt: args.expiresAt, state: 'PROPOSED',
  };
  proposal.proposalDigest = digest(proposal);
  return cloneFreeze(proposal);
}
export function emptyEffectState() {
  const state = cloneFreeze({ sequence: 0, lastRecordDigest: '', lastTimestamp: '', effects: {}, semanticKeys: {} });
  admittedEffectStates.add(state); return state;
}
export function projectEffectState(state) {
  if (!admittedEffectStates.has(state)) return null;
  const effectIds = Object.keys(state.effects);
  return effectIds.length === 1 ? state.effects[effectIds[0]].state : effectIds.length > 1 ? 'MULTIPLE_EFFECTS' : null;
}
const RECORD_KEYS = ['schema', 'sequence', 'effectId', 'semanticKey', 'transition', 'subjectDigest', 'proposalDigest', 'requestDigest', 'previousRecordDigest', 'timestamp', 'payload', 'recordDigest'];
const NEXT = {
  NONE: ['PROPOSED'], PROPOSED: ['CONFIRMED', 'EXPIRED', 'SUPERSEDED', 'CANCELLED_BEFORE_PREPARE'],
  CONFIRMED: ['PREPARED', 'EXPIRED', 'SUPERSEDED', 'REFUSED_PRE_EFFECT'],
  PREPARED: ['DISPATCHING', 'UNKNOWN_EFFECT'], DISPATCHING: ['RESPONSE_ADMITTED', 'UNKNOWN_EFFECT'],
  RESPONSE_ADMITTED: ['APPLIED', 'UNKNOWN_EFFECT'], UNKNOWN_EFFECT: ['APPLIED', 'RECONCILIATION_BLOCKED', 'ABSENT_TERMINAL'],
};
const TERMINAL = new Set(['APPLIED', 'EXPIRED', 'SUPERSEDED', 'CANCELLED_BEFORE_PREPARE', 'REFUSED_PRE_EFFECT', 'RECONCILIATION_BLOCKED', 'ABSENT_TERMINAL']);
const payloadKeys = (payload, expected, label) => keys(payload, expected, label);
export function createJournalRecord(state, event) {
  assertOrdinaryData(state, 'effect state');
  assertOrdinaryData(event, 'transition event');
  keys(event, ['transition', 'timestamp', 'effectId', 'semanticKey', 'subjectDigest', 'proposalDigest', 'requestDigest', 'payload'], 'transition event');
  timestamp(event.timestamp, 'record timestamp'); text(event.effectId, SAFE_ID, 'record effectId');
  for (const [item, label] of [[event.semanticKey, 'semanticKey'], [event.subjectDigest, 'subjectDigest'], [event.proposalDigest, 'proposalDigest']]) text(item, HEX64, label);
  let requestDigest = event.requestDigest || (Object.hasOwn(state.effects, event.effectId) ? state.effects[event.effectId].requestDigest : '') || '';
  if (event.transition === 'PREPARED') requestDigest = digest(event.payload.request);
  if (requestDigest !== '') text(requestDigest, HEX64, 'requestDigest');
  const record = { schema: 'aca-effect-journal-record/v1', sequence: state.sequence + 1, effectId: event.effectId,
    semanticKey: event.semanticKey, transition: event.transition, subjectDigest: event.subjectDigest,
    proposalDigest: event.proposalDigest, requestDigest, previousRecordDigest: state.lastRecordDigest,
    timestamp: event.timestamp, payload: event.payload };
  record.recordDigest = digest(record);
  return cloneFreeze(record);
}
function validatePayload(record, current) {
  const payload = record.payload;
  if (record.transition === 'PROPOSED') {
    payloadKeys(payload, ['proposal'], 'proposed payload');
    const proposal = payload.proposal;
    keys(proposal, ['schema', 'effectId', 'action', 'subject', 'subjectDigest', 'qualificationReceiptDigest', 'body', 'bodyBytes', 'bodyDigest', 'semanticKey', 'issuedAt', 'expiresAt', 'state', 'proposalDigest'], 'proposal');
    const subject = admitSubject(proposal.subject);
    text(proposal.effectId, SAFE_ID, 'proposal.effectId');
    for (const [item, label] of [[proposal.subjectDigest, 'proposal.subjectDigest'], [proposal.qualificationReceiptDigest, 'proposal.qualificationReceiptDigest'], [proposal.bodyDigest, 'proposal.bodyDigest'], [proposal.semanticKey, 'proposal.semanticKey'], [proposal.proposalDigest, 'proposal.proposalDigest']]) text(item, HEX64, label);
    timestamp(proposal.issuedAt, 'proposal.issuedAt'); timestamp(proposal.expiresAt, 'proposal.expiresAt');
    const expectedBody = `Agent Change Assurance advisory\nHead: ${subject.pull.headSha}\nQualification: ${subject.qualification.receiptDigest}\nUnit: ACA_EFFECT_PREFLIGHT\nBuild: QUALIFIED_LOCAL_COMMIT\nObserved: ${subject.observedAt}\nThis advisory does not approve, merge, deploy, or create provider authority.\n<!-- aca-effect:${proposal.effectId} -->`;
    if (proposal.schema !== 'aca-effect-proposal/v1' || proposal.action !== 'CREATE_ADVISORY_PR_COMMENT_V1' || proposal.state !== 'PROPOSED' || instant(proposal.issuedAt) < instant(subject.observedAt) || instant(proposal.issuedAt) >= instant(proposal.expiresAt) || proposal.subjectDigest !== subject.subjectDigest || proposal.qualificationReceiptDigest !== subject.qualification.receiptDigest || proposal.body !== expectedBody || proposal.bodyBytes !== Buffer.byteLength(proposal.body) || proposal.bodyDigest !== digest(proposal.body) || proposal.semanticKey !== digest(`CREATE_ADVISORY_PR_COMMENT_V1\n${proposal.subjectDigest}`)) fail('proposal content refused');
    if (proposal.effectId !== record.effectId || proposal.semanticKey !== record.semanticKey || proposal.subjectDigest !== record.subjectDigest || proposal.proposalDigest !== record.proposalDigest || instant(record.timestamp) < instant(proposal.issuedAt) || digest(without(proposal, 'proposalDigest')) !== proposal.proposalDigest) fail('proposal binding failed');
  } else if (record.transition === 'CONFIRMED') {
    payloadKeys(payload, ['decision'], 'confirmed payload');
    keys(payload.decision, ['schema', 'proposalId', 'proposalDigest', 'decision'], 'owner decision');
    if (payload.decision.schema !== 'aca-owner-effect-decision/v1' || payload.decision.proposalId !== record.effectId || payload.decision.proposalDigest !== record.proposalDigest || payload.decision.decision !== 'AUTHORIZE' || instant(record.timestamp) >= instant(current.proposal.expiresAt)) fail('owner decision refused');
  } else if (record.transition === 'PREPARED') {
    payloadKeys(payload, ['request'], 'prepared payload');
    keys(payload.request, ['action', 'effectId', 'subjectDigest', 'proposalDigest', 'bodyDigest', 'body'], 'canonical request');
    const proposal = current.proposal;
    if (payload.request.action !== proposal.action || payload.request.effectId !== record.effectId || payload.request.subjectDigest !== record.subjectDigest || payload.request.proposalDigest !== record.proposalDigest || payload.request.bodyDigest !== proposal.bodyDigest || payload.request.body !== proposal.body || digest(payload.request) !== record.requestDigest) fail('request binding failed');
  } else if (record.transition === 'DISPATCHING') payloadKeys(payload, [], 'dispatch payload');
  else if (record.transition === 'RESPONSE_ADMITTED') {
    payloadKeys(payload, ['response'], 'response payload');
    validateResponse(payload.response, current);
    if (record.timestamp !== payload.response.comment.updatedAt) fail('response record timestamp refused');
  } else if (record.transition === 'APPLIED' || record.transition === 'ABSENT_TERMINAL') {
    payloadKeys(payload, ['observation'], 'reconciliation payload');
    const result = validateObservation(payload.observation, current);
    if (record.timestamp !== payload.observation.observedAt) fail('reconciliation record timestamp refused');
    if (record.transition === 'APPLIED' ? result.exact !== 1 || result.suspicious : result.exact !== 0 || result.suspicious) fail('reconciliation disposition refused');
  } else if (record.transition === 'RECONCILIATION_BLOCKED') {
    payloadKeys(payload, ['observationDigest', 'reason'], 'blocked payload');
    text(payload.observationDigest, HEX64, 'observationDigest'); text(payload.reason, SAFE_ID, 'blocked reason');
  } else if (record.transition === 'UNKNOWN_EFFECT') {
    payloadKeys(payload, ['reason'], 'ambiguity payload');
    if (!['INVOKE_THROWN', 'INVOKE_REJECTED', 'TIMEOUT_SHAPED', 'REPLAY_RECOVERY'].includes(payload.reason)) fail('ambiguity reason refused');
  } else if (['EXPIRED', 'SUPERSEDED', 'CANCELLED_BEFORE_PREPARE', 'REFUSED_PRE_EFFECT'].includes(record.transition)) payloadKeys(payload, ['reason'], 'terminal payload');
  else fail('transition payload unsupported');
}
function validateComment(comment, current) {
  keys(comment, ['id', 'nodeId', 'actorNodeId', 'body', 'marker', 'subjectDigest', 'createdAt', 'updatedAt'], 'simulated comment');
  integer(comment.id, 'comment.id');
  for (const [item, label] of [[comment.nodeId, 'comment.nodeId'], [comment.actorNodeId, 'comment.actorNodeId']]) text(item, ASCII, label);
  text(comment.subjectDigest, HEX64, 'comment.subjectDigest'); timestamp(comment.createdAt, 'comment.createdAt'); timestamp(comment.updatedAt, 'comment.updatedAt');
  if (instant(comment.updatedAt) < instant(comment.createdAt) || instant(comment.createdAt) < instant(current.lastTimestamp)) fail('comment timeline refused');
  if (typeof comment.body !== 'string' || typeof comment.marker !== 'string') fail('comment body/marker refused');
  return comment.marker === `<!-- aca-effect:${current.effectId} -->` && comment.body === current.proposal.body && comment.actorNodeId === 'ACTOR_fixture_owner' && comment.subjectDigest === current.subjectDigest;
}
function validateResponse(response, current) {
  keys(response, ['schema', 'status', 'comment'], 'simulated response');
  if (response.schema !== 'aca-simulated-comment-response/v1' || response.status !== 201 || !validateComment(response.comment, current)) fail('simulated response refused');
}
function validateObservation(observation, current) {
  keys(observation, ['schema', 'complete', 'stable', 'bounded', 'subjectDigest', 'actorNodeId', 'observedAt', 'comments'], 'simulated observation');
  if (observation.schema !== 'aca-simulated-comment-observation/v1' || observation.complete !== true || observation.stable !== true || observation.bounded !== true || observation.subjectDigest !== current.subjectDigest || observation.actorNodeId !== 'ACTOR_fixture_owner' || instant(observation.observedAt) < instant(current.lastTimestamp)) fail('observation bounds refused');
  if (!Array.isArray(observation.comments) || observation.comments.length > 100 || Reflect.ownKeys(observation.comments).length !== observation.comments.length + 1) fail('dense bounded comments required');
  let exact = 0; let suspicious = false;
  for (const comment of observation.comments) {
    const match = validateComment(comment, current); exact += Number(match);
    if (instant(comment.updatedAt) > instant(observation.observedAt)) fail('observation precedes comment');
    if (!match && (comment.marker === `<!-- aca-effect:${current.effectId} -->` || comment.body === current.proposal.body || comment.body.includes(`<!-- aca-effect:${current.effectId} -->`))) suspicious = true;
  }
  return { exact, suspicious };
}
export function validateAndReduce(state, record) {
  if (!admittedEffectStates.has(state)) fail('effect state provenance refused');
  assertOrdinaryData(state, 'effect state');
  assertOrdinaryData(record, 'journal record');
  keys(record, RECORD_KEYS, 'journal record');
  if (record.schema !== 'aca-effect-journal-record/v1' || record.sequence !== state.sequence + 1 || record.previousRecordDigest !== state.lastRecordDigest || digest(without(record, 'recordDigest')) !== record.recordDigest) fail('record chain refused');
  const recordInstant = timestamp(record.timestamp, 'record timestamp'); text(record.recordDigest, HEX64, 'recordDigest');
  if (state.lastTimestamp && recordInstant < instant(state.lastTimestamp)) fail('record timeline refused');
  const current = Object.hasOwn(state.effects, record.effectId) ? state.effects[record.effectId] : undefined;
  const prior = current?.state ?? 'NONE';
  if (TERMINAL.has(prior) || !NEXT[prior]?.includes(record.transition)) fail('illegal or terminal transition');
  if (current && (record.semanticKey !== current.semanticKey || record.subjectDigest !== current.subjectDigest || record.proposalDigest !== current.proposalDigest || (current.requestDigest && record.requestDigest !== current.requestDigest))) fail('effect identity changed');
  if (!current && state.semanticKeys[record.semanticKey]) fail('semantic custody conflict');
  validatePayload(record, current);
  const nextEffect = { ...(current ?? {}), state: record.transition, effectId: record.effectId, semanticKey: record.semanticKey,
    subjectDigest: record.subjectDigest, proposalDigest: record.proposalDigest, requestDigest: record.requestDigest, lastTimestamp: record.timestamp };
  if (record.payload.proposal) nextEffect.proposal = record.payload.proposal;
  if (record.payload.decision) nextEffect.decision = record.payload.decision;
  if (record.payload.request) nextEffect.request = record.payload.request;
  nextEffect.lastPayload = record.payload;
  const nextState = cloneFreeze({ sequence: record.sequence, lastRecordDigest: record.recordDigest, lastTimestamp: record.timestamp,
    effects: { ...state.effects, [record.effectId]: nextEffect }, semanticKeys: { ...state.semanticKeys, [record.semanticKey]: record.effectId } });
  admittedEffectStates.add(nextState); return nextState;
}
