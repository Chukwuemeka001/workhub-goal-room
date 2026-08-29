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

## Judge quick start and recovery

Use a qualifying ChatGPT in-app browser or Chrome/Canary build with WebMCP support. The page requires no login or credentials, keeps one synthetic Goal in the current browser lifecycle, and performs no external effects. Reload starts a fresh room; there is intentionally no reset mutation control. `PASS` means the deterministic checks succeeded, not that the Owner accepted the Goal.

The production page includes a keyboard-focusable **Judge help and room limits** disclosure. See [`SECURITY.md`](SECURITY.md), [`PRIVACY.md`](PRIVACY.md), and the evidence-limited [`evaluation/manual-accessibility-v3.md`](evaluation/manual-accessibility-v3.md).

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

**Fresh V3 native proof (August 28, 2026):** Google Chrome Canary `154.0.8028.0`, using only `enable-webmcp-testing` and `devtools-webmcp-support` in an isolated unsigned-in disposable profile, natively enumerated the exact current six-tool surface. Every Agent call used the browser-returned `RegisteredTool` and the testing API shape `getTools()` → `executeTool(tool, JSON.stringify(input))`; no descriptor callback was called directly.

The recorded production journey starts at `INTENT_DRAFT`, includes Owner UI Goal v1 revision → Goal v2 confirmation and Plan v1 revision → Plan v2 confirmation, claims the exact admitted step, records automatic production System FAIL for Candidate v1 and PASS for corrected Candidate v2, requests completion natively, and ends only after exact-candidate Owner UI acceptance at sealed S14. The receipt also preserves typed testing-API failures, malformed/premature/digest/idempotency/terminal negatives with mutation checks, independent DOM and native read-state observations, raw descriptor schemas/annotations, browser enumeration order separately from registration order, and a fresh BrowserOS 148 unavailable-client control whose Owner UI remains usable.

Deterministic evidence and five bounded screenshots are under [`evaluation/native-webmcp-v3/`](evaluation/native-webmcp-v3/). Revalidate them with:

```bash
npm run qa:v3:native
```

This proves native browser registration, discovery, testing-API invocation, shared-state reflection, and the recorded governance boundaries. It does **not** prove autonomous model selection or repeated model reliability.

## V3 production-excluded qualification

The [`qualification/`](qualification/) package replays 14 states through the real Goal Room kernel, current static-six WebMCP callbacks, internal verifier, and owner controller. Production [`index.html`](index.html) and [`src/main.ts`](src/main.ts) contain no qualification entry reference, and the production bundle is scanned for fixture tokens.

S09 is explicit test-only presentation metadata over a real `CANDIDATE_SUBMITTED` snapshot. It shows a verification-in-progress transient in the qualification fixture without changing kernel state or creating a production transition. S10 records immutable FAIL, S11 submits corrected bytes, S12 records PASS without acceptance, S13 binds completion, and only S14 records owner acceptance.

The V3 contract and mapping are in [`design/GOAL_ROOM_V3_VISUAL_CONTRACT.md`](design/GOAL_ROOM_V3_VISUAL_CONTRACT.md) and [`design/TRANSLATION_LEDGER.md`](design/TRANSLATION_LEDGER.md). Deterministic visual, responsive, accessibility, hostile/zoom, bundle-exclusion, protected-byte, screenshot, and receipt evidence is written under [`evaluation/v3/`](evaluation/v3/).

## Competition package

The current local V3 package is under [`submission/`](submission/):

- [`DEVPOST_SUBMISSION.md`](submission/DEVPOST_SUBMISSION.md) — truthful judge copy and explicit pending publication gates;
- [`DEMO_SCRIPT.md`](submission/DEMO_SCRIPT.md) — 2:33.84 narration/timeline and reconstruction disclosure;
- [`V3_REQUIREMENTS.md`](submission/V3_REQUIREMENTS.md), [`V3_CLAIMS.md`](submission/V3_CLAIMS.md), and [`V3_AUDIT.md`](submission/V3_AUDIT.md) — current requirements, claim boundaries, and local audit;
- [`assets/workhub-goal-room-architecture.html`](submission/assets/workhub-goal-room-architecture.html), [SVG](submission/assets/workhub-goal-room-architecture.svg), and [PNG](submission/assets/workhub-goal-room-architecture.png) — authority architecture;
- [`assets/screenshots/manifest.json`](submission/assets/screenshots/manifest.json) — ten hash-bound current V3 evidence images;
- [`assets/workhub-goal-room-demo.mp4`](submission/assets/workhub-goal-room-demo.mp4) and [English captions](submission/assets/workhub-goal-room-demo.en.srt) — local narrated evidence: a continuous live native governed journey through sealed S14, followed by disclosed source-bound reconstruction tails;
- [`historical/v2-five-tool/manifest.json`](submission/historical/v2-five-tool/manifest.json) — byte-verified custody of the superseded package, never presented as current.

The video records one continuous live native governed journey from 0:00 through sealed S14 at 2:06.8. Only the 2:06.9–2:18.7 mobile/breakpoint scene and 2:18.85–2:33.84 architecture scene are source-bound checkpoint reconstructions. No autonomous model selected tools. Public app, repository, YouTube, and Devpost actions remain Owner-gated and pending.

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
