# Phase 7 claim and evidence contract

## Primary claim

> **WebMCP makes a website callable by agents. WorkHub Goal Room makes each call state-aware, authority-checked, evidence-bound, and owner-controlled.**

## Product story

Ordinary agent-enabled websites expose actions. WorkHub Goal Room exposes only the next bounded actions an agent may request, then revalidates each consequential call inside the same authority kernel that drives the human UI.

The judge-facing journey is one synthetic software-release Goal:

```text
discover five tools
→ inspect the authoritative frontier
→ propose a Plan
→ owner confirms the Plan
→ claim an admitted step
→ submit exact candidate evidence
→ deterministic verifier records FAIL
→ submit corrected evidence
→ verifier records PASS
→ agent requests completion
→ owner accepts the exact verified candidate
```

## Exact public WebMCP surface

1. `get_goal_room_state`
2. `propose_plan`
3. `claim_step`
4. `submit_artifact`
5. `request_completion`

No WebMCP tool may confirm or revise a Plan as owner, author a verification verdict, accept the Goal, deploy, send messages, make payments, or create external effects.

## Authority guarantees demonstrated

- Every consequential callback validates its runtime input independently.
- State version, exact Plan/step/candidate binding, idempotency, and legal frontier are checked by the authority kernel.
- Malformed input returns `INVALID_TOOL_INPUT` without state mutation or receipt creation.
- Stale valid calls may enter the kernel and produce immutable governed refusal receipts.
- Exact retries return the authoritative prior result without duplicate receipts.
- Reusing an idempotency key with changed content fails closed.
- Deterministic verification is not exposed through WebMCP.
- PASS permits an agent completion request; PASS never accepts the Goal.
- Only the owner confirms the Plan and accepts the Goal.

## Evidence classes

| Evidence | What it proves | What it does not prove |
|---|---|---|
| Deployed Canary native WebMCP proof | Browser registration, discovery, native invocation, shared-state mutation, governed refusal | Autonomous multi-turn model control |
| Deterministic nine-state demo rehearsal | Coherent product journey, UI/state projection, responsive containment | Native WebMCP invocation during the recorded UI automation |
| Provider-free conformance 13/13 + 7/7 | Scorer accepts frozen oracle decisions and detects adversarial mismatches/vetoes | Model quality |
| Fresh-model calibration 12/13 exact, 13/13 governance-clean | Bounded one-shot decision selection against exact production descriptors | Repeated-case reliability, cross-model generalization, direct browser autonomy |
| Production authority regression tests | Selected calls/refusals are enforced by the actual kernel | Production authentication or external effects |
| 90-test suite and CI | Deterministic implementation contracts and build health | Security against every hostile runtime |

## Honest limitations

- Competition edition with one synthetic Goal and no accounts, organizations, persistent backend, or external side effects.
- Browser state resets on reload.
- Deterministic release verifier checks a deliberately narrow JSON contract.
- Owner and verifier actions are represented by explicit UI controls for demonstration.
- Fresh-model evidence is N=1 per distinct scenario using one model/provider.
- The polished demo uses a native-registration/callback inspector plus deterministic operator controls for the full journey; it must not be described as autonomous model execution.
- The real native WebMCP proof is separately evidenced in the repository and prior deployed verification.

## Forbidden claims

Do not say or imply:

- the model autonomously executed the full browser journey;
- 12/13 is a statistically reliable success rate;
- the project is production-ready or production-secure;
- the competition edition is the full private WorkHub system;
- PASS equals owner acceptance;
- WebMCP can invoke owner, verifier, deployment, messaging, payment, or other external-effect authority;
- any proprietary/private architecture, data, credentials, provider state, or implementation is present.
