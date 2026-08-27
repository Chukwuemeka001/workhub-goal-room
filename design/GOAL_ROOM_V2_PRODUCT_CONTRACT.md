# Goal Room V2 Product Contract

## Product thesis

WorkHub Goal Room turns conversational intent into governed human–agent work.

```text
conversation discovers intent
→ agent proposes an immutable Goal Contract
→ owner confirms or requests revision
→ agent proposes an immutable Plan bound to that Goal Contract
→ owner confirms or requests revision
→ admitted execution produces exact evidence
→ internal verification records FAIL/PASS
→ agent requests completion
→ owner accepts the exact verified result
```

**Chat is where intent is discussed. The Goal Contract is where agreed intent becomes governable. The Goal Room is where governed execution becomes visible and decidable.**

## Primary user

The owner supervising one consequential Goal while a browser agent performs admitted work.

## Primary surfaces

- iPhone: **Operate**, secondary Inspect. One frontier and one thumb-reachable action.
- Desktop: **Operate/Monitor**, secondary Command/Inspect. One dominant frontier with richer context on demand.

## Two-second questions

Every default state must answer:

1. What outcome are we building?
2. Where did the Goal come from, and has the owner confirmed it?
3. What is happening now?
4. Who holds authority now?
5. What is the one legal next action?
6. What needs the owner?
7. What evidence supports the current state?

## Canonical objects

### Owner Intent

Owner-authored draft describing the desired outcome. It is mutable before Goal admission and cannot authorize planning or work.

### Goal Contract version

An immutable agent proposal containing:

- Goal
- Why it matters
- Done Looks Like
- Constraints
- Non-goals
- Evidence required
- Open questions
- exact version and proposal status

### Confirmed Goal Contract

The exact owner-admitted destination. Plans must bind to its version.

### Plan version

An immutable agent proposal of admitted work steps bound to one confirmed Goal Contract version.

### Execution and proof

Claim, Candidate, Verification, Completion Request, Owner Acceptance, and Receipt retain the existing authority semantics.

## Conversation boundary

The challenge edition does not build a second general chatbot.

```text
browser agent conversation = reasoning and clarification
Goal Room = owner intent, structured proposals, decisions, evidence, state, receipts
```

The UI may display a concise Origin & Discussion timeline of authoritative proposal/revision events. Free-form prose never changes authority by itself.

## Owner-only decisions

- Set or revise initial owner intent before Goal admission
- Confirm Goal Contract
- Request Goal Contract revision
- Confirm Plan
- Request Plan revision
- Accept final verified Goal

## Agent-callable actions

- Read state and legal frontier
- Propose Goal Contract or revision
- Propose Plan or revision
- Claim admitted Plan step
- Submit exact artifact/evidence
- Request completion after exact PASS

## Internal-only actions

- Record deterministic verification verdict
- Bind rule-set version to exact candidate digest

## Non-negotiable distinctions

- intent ≠ Goal Contract
- proposed Goal ≠ confirmed Goal
- proposed Plan ≠ confirmed Plan
- claimed work ≠ submitted candidate
- submitted candidate ≠ verified candidate
- PASS ≠ completion request
- completion request ≠ owner acceptance

## Challenge-edition boundaries

No accounts, organizations, multiple Goals, persistent backend, production external effects, payments, messaging, deployment, generic orchestration dashboard, fake progress percentage, or decorative agent theater.

## Success criteria

A first-time owner can identify Goal origin, current actor, current frontier, legal next action, evidence state, and owner decision without reading source code or the full receipt log.
