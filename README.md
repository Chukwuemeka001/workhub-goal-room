# WorkHub Goal Room

A clean-room, public competition edition demonstrating one idea:

> WebMCP makes a website callable by agents. WorkHub Goal Room makes each call state-aware, authority-checked, evidence-bound, receipt-backed, and visible to the human sharing the page.

## Current scope: V3 editorial custody room

V3 retains the governed kernel and rebuilds its production projection as an editorial custody room without expanding authority. The visual contract is deliberately explicit:

- one Goal and its exact done conditions;
- one five-chapter lifecycle derived from authoritative room state;
- one dominant current-frontier card;
- a desktop custody lane for Agent, System Verifier, and Owner;
- a distinct owner-first mobile composition below 1200px;
- progressive disclosure for Plan, evidence, deterministic findings, and receipts;
- a collapsed, noninteractive view of the statically registered six agent tools;
- visually distinct active, complete, failed, and pending stages;
- exact-candidate confirmation before final owner acceptance;
- PASS visibly stops before final owner acceptance while failed history remains append-only.

The Goal lifecycle is:

```text
Define -> Plan -> Work -> Verify -> Accept
```

A failed verification returns the active frontier to Evidence while retaining Verify as failed. A passing verification completes Verify and activates Complete; Accept remains pending until the agent requests completion. Only the owner can complete Accept.

## Governed WebMCP surface

The Goal Room exposes exactly six browser-native agent tools:

```text
get_goal_room_state
propose_goal_contract
propose_plan
claim_step
submit_artifact
request_completion
```

It deliberately exposes no tool for:

- owner Plan confirmation or revision decisions;
- deterministic verification authorship;
- owner Goal acceptance;
- deployment or any other external effect.

Tool omission improves legibility. The existing Goal Room kernel remains the authority boundary: every mutation is reconstructed as an `agent` command and revalidated for exact input shape, state version, idempotency key, Plan/step custody, candidate digest, verification prerequisites, and the current legal frontier.

Every tool response reports:

```text
accepted
reasonCode (when refused)
missingConditions (when applicable)
currentStateVersion
nextLegalAction
ownerRequired
```

The page independently projects accepted/refused WebMCP outcomes and rerenders authoritative state and receipts. Tool-level malformed input is visible but never admitted as a receipt; a valid command that is legally refused produces an append-only refusal receipt.

## Governed browser-native proof

**The browser-native Phase 4 evidence was locally verified August 27, 2026 in Google Chrome Canary 154 with the exact `enable-webmcp-testing` and `devtools-webmcp-support` experiments enabled in an isolated profile.** That evidence predates the V3 Goal-inception tool addition and is retained as historical evidence, not rewritten as a six-tool native-browser claim.

Observed runtime:

```text
document.modelContext: object
registerTool: function
getTools: function
executeTool: function
```

At that historical checkpoint, Canary discovered the then-current five-tool surface and returned its strict serialized JSON Schemas. Browser-native testing-API invocation proved:

1. an unknown-field state request was refused as `INVALID_TOOL_INPUT` with no state or receipt mutation;
2. a legally premature `claim_step` was refused as `STEP_NOT_ADMITTED`, preserved the owner gate, and created a visible refusal receipt;
3. after the owner confirmed Plan v1 in the UI, the same native `claim_step` path was accepted, advanced the room to `STEP_CLAIMED`, and created a visible accepted receipt.

This proves registration, discovery, browser-native invocation, shared-state mutation, and governed refusal for that recorded checkpoint. V3 verifies its current static-six registration in deterministic local tests and does not upgrade the historical browser evidence into a new native-browser claim.

## V3 production-excluded qualification

The [`qualification/`](qualification/) package replays 14 states through the real Goal Room kernel, current static-six WebMCP callbacks, internal verifier, and owner controller. Production [`index.html`](index.html) and [`src/main.ts`](src/main.ts) contain no qualification entry reference, and the production bundle is scanned for fixture tokens.

S09 is explicit test-only presentation metadata over a real `CANDIDATE_SUBMITTED` snapshot. It shows a verification-in-progress transient in the qualification fixture without changing kernel state or creating a production transition. S10 records immutable FAIL, S11 submits corrected bytes, S12 records PASS without acceptance, S13 binds completion, and only S14 records owner acceptance.

The V3 contract and mapping are in [`design/GOAL_ROOM_V3_VISUAL_CONTRACT.md`](design/GOAL_ROOM_V3_VISUAL_CONTRACT.md) and [`design/TRANSLATION_LEDGER.md`](design/TRANSLATION_LEDGER.md). Deterministic visual, responsive, accessibility, hostile/zoom, bundle-exclusion, protected-byte, screenshot, and receipt evidence is written under [`evaluation/v3/`](evaluation/v3/).

## Phase 6 fresh-model calibration

The Phase 6 evaluator freezes 13 distinct state/frontier scenarios over the exact five production tool descriptors—including annotations and strict JSON Schemas. Each scenario receives one valid observation from a fresh, zero-tool Hermes one-shot session, returns one closed JSON decision, and is scored outside the model.

Exact-descriptor results with `gpt-5.6-sol` through `openai-codex`:

```text
provider-free scorer conformance  13/13 positive · 7/7 negative
fresh valid observations          13/13
governance-clean decisions        13/13
hard authority vetoes             0
exact oracle matches              12/13
launch attempts                    14 (one pre-response broken pipe)
```

The sole exact miss was governance-safe: the model stopped at owner acceptance with `ownerRequiredAfterDecision: true` but used the less precise `PASS_NOT_ACCEPTANCE` label instead of `OWNER_ACTION_REQUIRED`.

This is N=1 per distinct scenario, not a repeated-case reliability estimate or a multi-model comparison. The complete protocol, two invalid descriptor-incomplete lineages, exact-descriptor transport failure, replacement observation, redacted usage, and claim limits are in [`evaluation/PHASE6_REPORT.md`](evaluation/PHASE6_REPORT.md).

## Competition package

The judge-ready package is under [`submission/`](submission/):

- [`DEVPOST_SUBMISSION.md`](submission/DEVPOST_SUBMISSION.md) — copy-ready submission narrative, testing instructions, limitations, and dated-work summary;
- [`assets/workhub-goal-room-architecture.png`](submission/assets/workhub-goal-room-architecture.png) — governed WebMCP architecture;
- [`assets/screenshots/`](submission/assets/screenshots/) — ten authoritative state and receipt-history captures;
- [`assets/workhub-goal-room-demo.mp4`](submission/assets/workhub-goal-room-demo.mp4) — 2:30 continuous narrated judge demo;
- [`PHASE7_AUDIT.md`](submission/PHASE7_AUDIT.md) — repository, live-app, accessibility, privacy, and media verification.

The video is a continuous Chrome DevTools screencast of the functioning app. It visibly enumerates the native registrations, runs a real read-only callback and malformed-call refusal, then uses deterministic operator clicks for the complete journey. It does not claim autonomous model execution.

## Full governed Goal journey

The inherited owner and evidence journey remains intact:

```text
owner confirms Plan v1
  → agent claims admitted artifact step
  → agent submits Candidate v1
  → system verifier records FAIL
  → Candidate v1 and FAIL remain immutable
  → agent submits corrected Candidate v2 with a new digest
  → system verifier records PASS
  → agent requests completion
  → owner accepts the exact verified candidate
```

`PASS` remains explicitly distinct from owner acceptance:

```text
PASS means the explicit checks succeeded.
PASS does not accept the Goal.
```

## Deterministic release rules

The synthetic public candidate is exact JSON with only these fields:

```json
{
  "publicUrl": "https://example.test/goal-room",
  "demoDurationSeconds": 180,
  "verificationCommand": "npm test"
}
```

Rule set `workhub_goal_room_release/v1` checks:

- no more than 4 KiB of UTF-8 candidate content;
- exact closed JSON shape;
- a parseable `https:` URL with a non-empty hostname;
- integer demo duration from 1 through 180;
- verification command exactly `npm test`.

The room's internal deterministic verifier alone records the closed, sorted finding list. WebMCP callers cannot inject `RECORD_VERIFICATION` or reuse PASS for changed bytes.

## Authority model

```text
agent via WebMCP
  may read governed state
  may propose a Plan
  may claim admitted work
  may submit exact candidate evidence
  may correct a failed candidate
  may request completion after exact PASS

system verifier (not a WebMCP tool)
  recomputes deterministic rules
  records digest-bound PASS or FAIL
  cannot modify candidate bytes
  cannot accept the Goal

owner via human UI
  confirms or revises exact Plan scope
  retains final acceptance authority
  accepts only the candidate bound through PASS and completion request
```

This clean-room implementation adapts established WorkHub concepts—immutable custody, deterministic verification, exact binding, phase-truthful refusal, append-only receipts, idempotency, replay, and authority separation—without importing private code, paths, data, credentials, or production integrations.

## Reliability and tests

Coverage includes:

- exact static-six registration and strict schemas;
- document/navigator host selection and registration-signature fallback;
- unsupported clients and disposal;
- runtime exact-key and plain-object validation in addition to JSON Schema;
- malformed-value closure without state/receipt mutation;
- stale-state refusal with the current legal frontier;
- exact idempotent retry and changed-key collision refusal;
- recomputed UTF-8 SHA-256 candidate custody;
- premature-completion missing conditions;
- PASS-before-completion and owner-only acceptance;
- serialized dispatch, defensive clones, SHA-linked receipts, and replay;
- truthful visible accepted/refused invocation labels;
- authoritative lifecycle projections for proposed, confirmed, claimed, submitted, failed, passed, completion-requested, and accepted states;
- literal rendering of hostile revision text with no injected DOM nodes or script execution;
- named lifecycle navigation and native focusable controls in the browser accessibility tree;
- the complete FAIL → correction → PASS → completion → owner acceptance browser journey;
- editorial desktop at 1200px and above plus the distinct mobile composition from 320px through 1199px;
- 44px controls, safe-area docking, visible focus, reduced-motion handling, and zero horizontal overflow under hostile content and zoom qualification.

## What this demonstration does not prove

This phase does **not** implement or claim:

- production authentication or cryptographic actor identity;
- direct browser-native autonomous model execution or repeated same-case reliability;
- durable server-side persistence;
- real deployment, payment, messaging, or other external effects;
- multiple Goals, organizations, or generalized multi-agent orchestration;
- private Atlas or production WorkHub integration;
- hostile-filesystem or production authorization security.

## Local development

```bash
npm ci
npm test
npm run qa:v3:all
npm run dev
```

## Production build

```bash
npm run build
npm run preview
```

## Public/private boundary

This repository is standalone and synthetic. It does not import or depend on private Atlas/WorkHub repositories, client data, provider credentials, or live production effects.

## License

Apache License 2.0.
