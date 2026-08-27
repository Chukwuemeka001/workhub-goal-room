# Judge demo narration and timeline

**Target duration:** 2:34

**Verified container duration:** 2:34.0

**Mode:** Narrated architecture plus deterministic UI journey captured from the functioning app. This is not autonomous browser-native model execution.

## Narration

WebMCP makes a website callable by agents. WorkHub Goal Room makes each call state-aware, authority-checked, evidence-bound, and owner-controlled.

The problem is that a callable action is not automatically a legal action. An agent can act on stale state, bind evidence to the wrong Plan, or mistake a machine PASS for human acceptance.

Goal Room registers exactly five WebMCP tools: read state, propose a Plan, claim a step, submit an artifact, and request completion. Every consequential call enters the same authority kernel that drives this interface. The kernel revalidates actor, state version, exact input, idempotency, Plan and candidate binding, evidence, and the current legal frontier. Malformed, stale, mismatched, or unauthorized calls fail closed.

Owner confirmation, verifier authorship, final acceptance, deployment, messaging, payments, and other external effects are intentionally not WebMCP tools.

Here is one governed release journey. The agent has proposed Plan v1, but work is blocked until the owner decides. The owner confirms the Plan. The agent may now claim only an admitted step, then submit exact candidate bytes and their SHA-256 digest.

Candidate v1 enters deterministic verification and fails. The original evidence and FAIL receipt remain immutable. The frontier returns to the agent, which submits corrected Candidate v2.

The internal verifier now records PASS. PASS does not accept the Goal. It only permits the agent to request completion for this exact candidate.

The frontier then moves to the owner. The agent and verifier are blocked. Only the owner can accept the verified candidate. After acceptance, every lifecycle stage is complete and there is no further governed action.

The public repository contains the full clean-room implementation, Apache-2.0 license, ninety tests, bounded reliability evidence, and all run instructions. The demo uses synthetic browser-local state and creates no external effects.

WorkHub Goal Room demonstrates a simple principle: humans and agents can share one state machine without sharing one authority level.

## Visual timeline

| Time | Visual |
|---:|---|
| 0:00–0:12 | Title card and primary claim |
| 0:12–0:43 | Architecture diagram; highlight five tools, kernel, owner/verifier boundaries |
| 0:43–0:58 | Initial Plan owner gate |
| 0:58–1:10 | Plan confirmed, then step claimed |
| 1:10–1:27 | Candidate v1 submitted and deterministic FAIL |
| 1:27–1:43 | Corrected Candidate v2 submitted |
| 1:43–2:00 | Deterministic PASS; emphasize PASS ≠ acceptance |
| 2:00–2:18 | Completion requested; owner is sole frontier |
| 2:18–2:32 | Goal accepted; no further governed action |
| 2:32–2:34 | Repository/live links and bounded limitations |
