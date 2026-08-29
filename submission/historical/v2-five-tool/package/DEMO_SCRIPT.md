# Judge demo narration and timeline

**Target duration:** 2:30

**Verified container duration:** 2:30.03

**Mode:** Continuous Chrome DevTools screencast of the functioning app. It visibly enumerates native registrations, executes real captured callbacks, and uses deterministic operator clicks. This is not autonomous model execution.

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
| 0:00–0:06 | Live app title and WebMCP-connected state |
| 0:06–0:17 | Five native registrations captured from `document.modelContext.registerTool` |
| 0:17–0:28 | Real read-only callback and structured state result |
| 0:28–0:38 | Real malformed callback, `INVALID_TOOL_INPUT`, unchanged frontier |
| 0:38–0:50 | Owner Plan gate and visible confirmation click |
| 0:50–1:09 | Step claim and Candidate v1 submission |
| 1:09–1:20 | Deterministic FAIL |
| 1:20–1:29 | Corrected Candidate v2 submission |
| 1:29–1:41 | Deterministic PASS; emphasize PASS ≠ acceptance |
| 1:41–1:53 | Completion request; owner is sole frontier |
| 1:53–2:03 | Visible owner acceptance click and completed Goal |
| 2:03–2:13 | Scroll to nine immutable receipts |
| 2:13–2:30 | Return to final no-action state and claim boundary |
