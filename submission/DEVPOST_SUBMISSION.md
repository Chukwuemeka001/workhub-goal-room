# WorkHub Goal Room V3 — Devpost submission copy

## Project

**WorkHub Goal Room**

**Tagline:** A callable site where agents can contribute, but authority stays explicit.

> WebMCP makes a website callable by agents. WorkHub Goal Room makes each call state-aware, authority-checked, evidence-bound, and owner-controlled.

## What it does

A callable action is not automatically a legal action. An agent can have the right tool but stale state, the wrong Plan version, or evidence for different candidate bytes. WorkHub Goal Room gives one synthetic software-release Goal a single visible authority frontier shared by Agent, System Verifier, and Owner.

The room begins with owner intent. The Agent proposes Goal Contract v1; the Owner requests a revision, then confirms immutable v2. The Agent proposes a Goal-bound Plan v1; the Owner revises and confirms v2. Only then can the Agent claim the admitted step and submit Candidate v1. The production System-verifier adapter records deterministic FAIL, leaving the failed evidence in history. Candidate v2 passes. The Agent can now request completion, but the room still stops at the Owner.

**PASS does not mean accepted.** The Owner alone accepts the exact candidate version and SHA-256 shown in the confirmation dialog. The accepted S14 room is sealed: current actor `none`, no controls, no legal continuation.

## Why WebMCP matters

The page registers exactly six Agent tools:

1. `get_goal_room_state`
2. `propose_goal_contract`
3. `propose_plan`
4. `claim_step`
5. `submit_artifact`
6. `request_completion`

Each consequential call rechecks exact input shape, state version, idempotency, Goal/Plan/step binding, candidate digest, evidence, and the current frontier. Owner confirmation and revision, System verdict authorship, and final acceptance are absent from the tool surface by design. The System adapter is internal production behavior, not a seventh tool or an Owner control.

Current native evidence is deliberately narrow. In Google Chrome Canary 154.0.8028.0, the browser returned six `RegisteredTool` descriptors. Agent calls used `getTools()` and `executeTool(tool, JSON.stringify(input))`. The receipt preserves raw browser enumeration separately from the static source-derived registration order. No autonomous model selected a tool. The S14 malformed probes show zero-mutation malformed-input atomicity; they are not a schema-valid terminal-phase reducer-refusal proof. Actor totals are chronology-derived, not a ledger export.

## Scope and limits

This is one synthetic browser-local Goal. Reloading starts a fresh room. It has no accounts, backend persistence, database, cloud service, external effects, deployment action, payment, or messaging action. The narrow deterministic verifier is not a claim of autonomous-model reliability, enterprise security, or general production readiness.

The video records one continuous live native governed journey from 0:00 through sealed S14 at 2:06.8. Only the 2:06.9–2:18.7 mobile/breakpoint scene and 2:18.85–2:33.84 architecture scene are disclosed source-bound checkpoint reconstructions. No autonomous model selected tools in this evidence.

## Judge steps

1. Open the app in a qualifying WebMCP browser.
2. Confirm the six descriptors above and the absence of privileged tools.
3. Read the current frontier with `get_goal_room_state`.
4. Follow the Owner UI and six-tool journey through Goal and Plan revision, Candidate v1 FAIL, Candidate v2 PASS, completion request, exact-candidate acceptance, and sealed S14.
5. Check that PASS leaves the Agent as next actor and does not accept the Goal.

## Owner-gated publication fields

- Public app URL: `PENDING_OWNER_GATED_PUBLIC_URL`
- Public repository URL: `PENDING_OWNER_GATED_REPOSITORY_URL`
- YouTube URL: `PENDING_OWNER_GATED_YOUTUBE_URL`
- Devpost submission status: `PENDING_OWNER_GATED_DEVPOST_SUBMISSION`

No URL, upload, deployment, publication, or submission is authorized by this local package.
