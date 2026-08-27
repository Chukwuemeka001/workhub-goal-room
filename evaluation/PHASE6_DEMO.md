# Judge demo rehearsal — under three minutes

## 0:00–0:25 — The claim

> WebMCP makes a website callable by agents. WorkHub Goal Room makes every consequential call state-aware, authority-checked, evidence-bound, and owner-controlled.

Show the owner-first Goal cockpit and the six-stage lifecycle:

```text
Plan → Claim → Evidence → Verify → Complete → Accept
```

## 0:25–0:50 — The bounded tool surface

Show the five registered tools:

```text
get_goal_room_state
propose_plan
claim_step
submit_artifact
request_completion
```

State the absence directly:

> There is no WebMCP tool for owner Plan confirmation, verification authorship, Goal acceptance, deployment, payment, or messaging.

## 0:50–1:15 — Authority before progress

Attempt `claim_step` before owner Plan confirmation. Show the governed refusal and unchanged owner frontier. Then confirm the Plan through the human UI and invoke the same bounded claim successfully.

> The browser schema helps an agent form a call. WorkHub still revalidates exact input, actor, state version, idempotency, Plan version, and current legal frontier.

## 1:15–1:55 — Evidence and deterministic rework

Submit Candidate v1 and run deterministic verification. Show FAIL and the visible lifecycle mapping:

```text
Evidence — active
Verify — failed
```

Submit corrected Candidate v2 with a new digest and run verification again.

> The failed candidate and verdict remain in the receipts. Correction creates new evidence; it does not rewrite history.

## 1:55–2:25 — PASS is not acceptance

Show PASS and pause on the visible boundary:

> PASS means the explicit checks succeeded. PASS does not accept the Goal.

Invoke `request_completion` for the exact passing digest. Show that authority moves to the owner rather than completing the Goal automatically.

## 2:25–2:50 — Owner acceptance and close

Accept through the human UI. Show:

```text
Status:      Goal accepted by owner
Next action: No further governed action
Lifecycle:   all six stages complete
```

Close with:

> WebMCP exposes bounded actions. WorkHub decides whether each call is legal, preserves the evidence, and leaves final acceptance with the owner.

## Rehearsal receipt

Chrome Canary 154 completed the deterministic nine-state UI journey with nine receipts. The FAIL→correction→PASS boundary remained visible, final acceptance completed all six lifecycle stages, and the 390×844 viewport had zero horizontal overflow. See `phase6-demo-rehearsal.json`.

Native WebMCP discovery, malformed-input refusal, governed refusal, and accepted shared-state mutation are the separate Phase 5 Canary proof. The UI rehearsal is not mislabeled as native tool invocation.
