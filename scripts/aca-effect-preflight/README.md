# ACA provider-free exact-effect preflight

This directory is a standalone, uninstalled fixture kernel for reasoning about one future semantic action: `CREATE_ADVISORY_PR_COMMENT_V1`. It has no provider adapter, endpoint, credential, generic transport, installed composition, or production import.

## Boundary

The kernel admits a closed `aca-exact-remote-subject/v1` only when the local candidate is clean, qualified, and exactly equal to the open non-draft pull-request head. It creates a deterministic fixed comment body and immutable `aca-effect-proposal/v1`. Caller-provided coordinates or prose are not accepted.

The simulator exposes only:

- `createProposal({ subject, evidence, effectId, now, expiresAt })`
- `confirm({ proposal, decision, now })`
- `prepare({ state, subject, now })`
- `dispatchOnce({ state, invoke })`
- `admitResponse({ state, response })`
- `reconcile({ state, observation })`
- `project(state)`

`invoke` is a trusted inert fixture callback receiving one deeply frozen semantic request (action, effect ID, subject/proposal/body digests, and fixed body). It has no provider coordinates. Module-local one-use custody prevents concurrent or repeated invocation. Synchronous closed outcomes and exact native Promises—`Promise.prototype` instances with no own string-named properties; symbol-only runtime metadata is inert—are owned; thrown errors, native rejections, timeout-shaped outcomes, or invalid ordinary outcomes become durable fixture ambiguity and grant no retry. Modified native Promises and Promise subclasses are contract violations refused without reading `then`, `constructor`, or `Symbol.species`; rejection lifecycle side effects created inside such a violating callback are outside kernel custody.

## State and records

The reducer admits only this transition graph:

```text
NONE -> PROPOSED
PROPOSED -> CONFIRMED | EXPIRED | SUPERSEDED | CANCELLED_BEFORE_PREPARE
CONFIRMED -> PREPARED | EXPIRED | SUPERSEDED | REFUSED_PRE_EFFECT
PREPARED -> DISPATCHING | UNKNOWN_EFFECT
DISPATCHING -> RESPONSE_ADMITTED | UNKNOWN_EFFECT
RESPONSE_ADMITTED -> APPLIED | UNKNOWN_EFFECT
UNKNOWN_EFFECT -> APPLIED | RECONCILIATION_BLOCKED | ABSENT_TERMINAL
```

All states on the right of `APPLIED`, plus expiry, supersession, cancellation, refusal, blocked reconciliation, and terminal absence, are terminal. `ABSENT_TERMINAL` consumes identity and creates no retry authority.

The file journal uses exclusive lock creation, canonical JSON Lines, contiguous sequence numbers, SHA-256 predecessor binding, one shared `validateAndReduce` path for append and replay, file sync before append success, and containing-directory sync on first creation. Replay fails closed; it never truncates or repairs bytes.

A fake `201` is only `RESPONSE_ADMITTED`. Comment creation and fixture observation timestamps must be canonical and no earlier than dispatch; response and reconciliation journal records use the latest causal evidence timestamp rather than the earlier dispatch timestamp. `APPLIED` requires exactly one full-body, exact-marker, exact-actor, exact-subject match in a complete, stable, bounded fixture observation. A complete stable zero-match observation becomes `ABSENT_TERMINAL`; duplicate, partial, moved, malformed, or suspicious matches become `RECONCILIATION_BLOCKED`.

## Projection truth

Every projection permanently includes:

```text
providerMode: FIXTURE_ONLY
liveAuthority: NONE
effectCapability: ABSENT
liveEffectAttempted: false
```

Copy distinguishes every admitted simulator or reducer/replay state: blocked, multi-effect aggregate, proposed, confirmed, prepared, dispatching, ambiguous, response-admitted, applied-in-fixture, expired, superseded, cancelled-before-prepare, refused-pre-effect, reconciliation-blocked, and absent-terminal. Multi-effect aggregate copy directs inspection of individual effects and never claims subject absence. Forged state-shaped objects project as blocked. Fixture `APPLIED` means only that an exact simulated observation was admitted.

## Run locally

No install or package script is required:

```sh
node --test scripts/aca-effect-preflight/*.node-test.mjs
```

The implementation uses only Node.js standard-library modules. This directory is not listed by the installer and is unreachable from accepted production modules.

## Claims and non-claims

This package claims deterministic closed-data admission, pure reducer/replay parity, fsync-backed local journal append, module-local zero-or-one fixture invocation, consumed ambiguity, exact fake-response/reconciliation rules, and truthful fixture projection under its tests.

It does **not** claim or provide:

- a GitHub write capability or live provider effect;
- an Owner authorization channel;
- credential reading, permission, or scope;
- a live method, destination, body execution, or provider receipt;
- live at-most-once behavior;
- a check, status, review, approval, merge, deployment, or release;
- proof that fixture behavior operates against GitHub;
- a generic mutation framework;
- hostile-filesystem security beyond the testable exclusive-lock kernel.

A future live phase requires a separately frozen exact subject, Owner channel, effect credential, literal provider adapter, installed successor bytes, no-effects canary, one authorized attempt, reconciliation, and exact provider receipt. None is authorized here.
