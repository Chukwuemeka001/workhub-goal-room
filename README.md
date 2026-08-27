# WorkHub Goal Room

A clean-room, public competition edition demonstrating one idea:

> WebMCP makes a website callable by agents. WorkHub Goal Room makes the next legal action explicit, governed, evidence-bound, and visible to the human sharing the page.

## Current scope: Phase 3 evidence and deterministic verification

The Goal Room now carries one synthetic Goal from owner-confirmed Plan scope through immutable candidate evidence, independent deterministic verification, correction, completion request, and final owner acceptance.

The visible experience:

1. shows the Goal and exact “Done Looks Like” conditions;
2. lets only the owner confirm the exact active Plan version;
3. lets the agent claim an admitted Plan step;
4. binds every candidate to exact UTF-8 content and a recomputed SHA-256 digest;
5. runs a fixed deterministic release rule set outside agent authority;
6. preserves failed candidates, verdicts, and correction history immutably;
7. refuses completion before the active candidate has PASS;
8. makes PASS eligible for the next governed action without accepting the Goal;
9. lets only the owner accept the exact candidate held by the PASS and completion-request chain;
10. records accepted and refused attempts as deterministic SHA-256-linked receipts.

The browser demo deliberately exercises both outcomes:

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

At every intermediate point the page shows the current legal actor and action. `PASS` is displayed with the explicit boundary:

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

- the artifact is valid JSON with the exact closed shape and no more than 4 KiB of UTF-8 candidate content;
- `publicUrl` is a parseable `https:` URL with a non-empty hostname;
- `demoDurationSeconds` is an integer from 1 through 180;
- `verificationCommand` is exactly `npm test`.

Results contain a closed, sorted list of finding codes. They are produced by the room's internal deterministic verifier operation. Ordinary commands cannot inject `RECORD_VERIFICATION`, even if a caller supplies a mathematically correct PASS payload.

## Authority model

```text
agent
  may propose and revise a Plan
  may claim admitted work
  may submit exact candidate evidence
  may correct a failed candidate
  may request completion after PASS

system verifier
  recomputes deterministic rules
  records digest-bound PASS or FAIL
  cannot modify candidate bytes
  cannot accept the Goal

owner
  confirms exact Plan scope
  retains final acceptance authority
  accepts only the exact candidate bound through PASS and completion request
```

This clean-room implementation adapts established WorkHub concepts—immutable candidate custody, deterministic verification, exact binding, append-only receipts, idempotency, replay, and authority separation—without importing private code, paths, data, credentials, or production integrations.

## Reliability properties

- admission-time command snapshots;
- serialized dispatch;
- exact idempotent retry with collision refusal;
- stale-state refusal;
- defensive state and receipt clones;
- contiguous SHA-256-linked receipts;
- replay that re-evaluates legal outcomes instead of trusting stored `accepted` flags;
- immutable Plan, candidate, and verification histories;
- candidate digest and rule-version binding;
- structured missing conditions for premature completion.

## Phase 0 WebMCP result

**PASS — verified August 27, 2026 in Google Chrome Canary 154 with the browser's WebMCP testing and DevTools experiments enabled.**

The page tool was discovered through `document.modelContext.getTools()`, invoked through `document.modelContext.executeTool()`, returned a structured result, and visibly updated the shared page.

Phase 3 retains this small registration proof. Expanding the governed agent-facing WebMCP action surface is intentionally deferred to Phase 4; Phase 3 establishes the domain and owner experience first.

## Current claim limits

This phase does **not** implement:

- production authentication or authenticated actor identity;
- durable server-side persistence;
- real deployment or other external effects;
- multiple Goals, organizations, or generalized multi-agent orchestration;
- private Atlas or production WorkHub integration.

The repository is a browser-compatible synthetic governance demonstration, not a production authorization system or hostile-filesystem security boundary.

## Local development

```bash
npm ci
npm test
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
