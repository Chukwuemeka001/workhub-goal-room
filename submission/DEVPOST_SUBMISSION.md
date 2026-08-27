# WorkHub Goal Room — Devpost submission copy

## Project name

**WorkHub Goal Room**

## Tagline

**The governed workspace where agents can act—but only people can authorize completion.**

## One-sentence pitch

WebMCP makes a website callable by agents; WorkHub Goal Room makes each call state-aware, authority-checked, evidence-bound, and owner-controlled.

## Submission description

### The problem

Giving an agent a callable website is useful, but consequential work needs more than callable buttons. An agent can act on stale state, reuse a command with changed content, submit evidence for the wrong Plan, or confuse a machine PASS with human acceptance. A human then has to reconstruct what happened and who was actually allowed to decide.

WorkHub Goal Room turns one software-release Goal into a shared, governed room for a person, an agent, and a deterministic verifier. The interface shows one authoritative frontier, the exact next legal action, immutable receipts, and a six-stage lifecycle:

```text
Plan → Claim → Evidence → Verify → Complete → Accept
```

### Why WebMCP is essential

The five WebMCP tools are not shortcuts layered over the UI. They are the agent's bounded route into the same authority kernel that drives the owner experience:

- `get_goal_room_state`
- `propose_plan`
- `claim_step`
- `submit_artifact`
- `request_completion`

Every consequential callback revalidates runtime input, state version, Plan and step binding, candidate digest, idempotency, evidence, and the current legal frontier. Malformed, stale, mismatched, or unauthorized calls fail closed. Exact retries return the authoritative prior result without duplicate receipts, while changed reuse of an idempotency key is refused.

WebMCP intentionally cannot confirm or revise a Plan as the owner, author a verifier verdict, accept the Goal, deploy, send a message, make a payment, or create any external effect. Those omissions are part of the product: discoverability does not erase authority.

### Better human-agent collaboration

Before this, a person supervising agent work had to infer whether an action was still legal and whether evidence matched the current Goal. In the Goal Room:

1. the agent discovers exactly five bounded tools;
2. the room reports the authoritative state and next legal action;
3. the agent proposes a Plan, but only the owner can confirm it;
4. the agent claims an admitted step and submits digest-bound evidence;
5. the system verifier records an immutable FAIL or PASS;
6. FAIL returns the work to correction without erasing earlier evidence;
7. PASS permits the agent to request completion;
8. only the owner can accept the exact verified candidate.

The human and agent share one state machine, but they do not share one authority level.

### Implementation

The project is a dependency-light TypeScript/Vite application deployed on GitHub Pages. `document.modelContext.registerTool(...)` registers exactly five all-or-nothing WebMCP descriptors. Thin browser callbacks perform strict input validation and dispatch immutable commands into a deterministic Goal Room kernel. The kernel owns state transitions, replay semantics, receipts, legal-frontier projection, and authority checks. A separate internal verifier evaluates an exact synthetic release-candidate JSON contract; verification is deliberately inaccessible through WebMCP.

The public repository includes the complete source, Apache-2.0 license, tests, architecture, evidence, and run instructions. The implementation is a clean-room competition edition with synthetic data and no private services, credentials, databases, or external effects.

### Evidence and reliability

The deployed app was verified in Chrome Canary 154 with native WebMCP registration, discovery, invocation, shared-state mutation, and governed refusal. The deterministic suite contains 90 tests and the GitHub Actions build deploys the same public app.

A separate Phase 6 calibration qualified the scorer on 13/13 oracle fixtures and 7/7 adversarial mutations. Thirteen fresh one-shot model observations against the exact production descriptors were 12/13 exact, 13/13 governance-clean, with zero hard authority vetoes. This is N=1 per distinct scenario with one model/provider—not a repeated reliability estimate or a claim of autonomous browser execution.

### Honest limitations

This is a focused competition edition: one synthetic release Goal, browser-local state, no accounts or organizations, no persistent backend, and no real deployment or messaging effects. The verifier checks one deliberately narrow JSON contract. The full demo journey may use deterministic UI controls for presentation; native WebMCP browser invocation is separately evidenced and must not be confused with autonomous multi-turn browser operation.

## How the project meets the judging criteria

### WebMCP Leverage

WebMCP is the only structured agent entry into a stateful authority kernel. Tool legality changes with state; malformed and stale calls produce distinct fail-closed behavior; owner and verifier powers are intentionally absent.

### Execution

The project is a deployed, responsive, keyboard-accessible Goal cockpit with a complete Plan-to-acceptance journey, deterministic verification, immutable receipts, comprehensive tests, and no judge login.

### Potential Impact

Engineering leads, founders, and operators need agents to contribute without silently acquiring approval authority. The Goal Room demonstrates a reusable pattern for supervising consequential agent work while keeping decisions visible and attributable.

### Creativity & Ambition

Most callable websites ask, “What can the agent do?” WorkHub Goal Room also asks, “What may this agent do now, against which exact evidence, and who still owns the decision?”

## Testing instructions for judges

1. Open the live app in ChatGPT's in-app browser or Chrome 149+ with WebMCP enabled.
2. Inspect the exposed tools. There should be exactly five, matching the list above.
3. Call `get_goal_room_state` to read the initial frontier.
4. Try malformed input and confirm `INVALID_TOOL_INPUT` without a state change or new receipt.
5. Use the visible deterministic demo controls to follow the complete journey through verifier FAIL, corrected evidence, PASS, completion request, and owner acceptance.
6. Confirm that PASS does not accept the Goal and that no WebMCP tool exists for Plan confirmation, verification, or final acceptance.

No credentials are required. State resets when the page reloads.

## Links

- **Live app:** https://chukwuemeka001.github.io/workhub-goal-room/
- **Public repository:** https://github.com/Chukwuemeka001/workhub-goal-room
- **Demo video:** `PENDING_PUBLIC_YOUTUBE_URL`

## New work during the submission period

The public repository was created during the challenge window. Its dated history distinguishes each competition phase:

- `531909e` — real WebMCP registration/discovery/invocation proof
- `5840c6b` through `43476d8` — governed Goal/Plan, owner decisions, evidence, and deterministic verification
- `df772ad` through `057827a` — exact five-tool governed WebMCP adapter and failure-atomic boundaries
- `fcfe652` through `83b1e5a` — complete visual Goal Room and responsive/accessibility repairs
- `3be36d9` through `e5740dc` — bounded reliability calibration and independent-review repairs

All listed commits are dated August 26–27, 2026, after the challenge opened on August 25.

## Submission facts to paste into form

```text
Project: WorkHub Goal Room
Live URL: https://chukwuemeka001.github.io/workhub-goal-room/
Repository: https://github.com/Chukwuemeka001/workhub-goal-room
License: Apache-2.0
Video: PENDING_PUBLIC_YOUTUBE_URL
Credentials: none
Primary platform: ChatGPT in-app browser or Chrome 149+ with WebMCP enabled
```
