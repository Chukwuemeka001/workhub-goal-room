# Goal Room V2 WebMCP Contract

## WebMCP thesis

WorkHub does not merely expose website actions. It exposes the bounded legal frontier of a shared human–agent state machine.

WebMCP is the agent action protocol. The authority kernel—not discovery, schemas, skill instructions, or UI—is authoritative.

## Recommended static tool surface

```text
get_goal_room_state
propose_goal_contract
propose_plan
claim_step
submit_artifact
request_completion
```

## Tool boundaries

Never register tools for:

- setting owner intent
- confirming/revising Goal Contract
- confirming/revising Plan
- recording verification
- accepting Goal
- deployment, messaging, payment, account access, or external effects

## `get_goal_room_state` response

Return enough state for safe recovery without dumping irrelevant implementation detail:

```text
accepted/readOnly
currentStateVersion
phase
ownerIntent (when relevant)
goalContractVersion/status
openQuestions
goalRevisionRequest
planVersion/status
currentActor
legalAgentActions
nextLegalAction
ownerRequired
activeClaim
candidateVersion/digest
verificationVerdict/ruleSet
completionRequest
acceptanceStatus
recent refusal or missing conditions
```

## Callback requirements

Every callback independently validates:

- plain record root
- exact keys
- bounds and closed values
- expected state version
- idempotency key
- exact Goal/Plan version binding
- exact step/candidate binding

Malformed input:

```text
INVALID_TOOL_INPUT
no state mutation
no receipt
frontier preserved
```

Valid but stale/illegal input enters the kernel and may create a governed refusal receipt.

## Tool descriptor posture

Descriptions state:

- exact prerequisites
- exact effect
- authority boundary
- likely refusal/recovery guidance

Descriptors guide model behavior but are not enforcement.

## Dynamic-discovery spike

Test—but do not assume—phase-aware registration:

- only `get_goal_room_state` plus currently legal agent mutation is discoverable;
- shared abort/dispose remains failure-atomic;
- stale handles fail safely;
- client discovery refresh is stable;
- reload/back-forward behavior remains predictable.

Adopt only if repeated Canary evidence shows better legibility and no instability. Otherwise retain six static tools and return `legalAgentActions` plus `nextLegalAction` in every response.

## Skill boundary

A future `governed-goal-room-operation` skill may improve Goal/Plan quality and refusal recovery. It cannot grant authority, duplicate reducer rules, expose privileged tools, or become necessary for safe baseline use.

Evaluate:

- no skill + production descriptors
- skill + same descriptors
- stale/adversarial skill + kernel

## Evidence ladder

1. declared
2. registered
3. discovered
4. invoked
5. shared-state proven
6. model behavior proven
7. governance proven

Each claim remains bound to exact browser, commit, arguments, result, visible state, and limitations.

## Judge-facing proof journey

1. Owner records intent.
2. Browser agent reads state.
3. Agent proposes Goal Contract through WebMCP.
4. Owner requests revision or confirms through human-only UI.
5. Agent proposes Plan.
6. Early/stale action receives structured refusal.
7. Agent reads frontier and recovers.
8. Evidence FAIL → correction → PASS.
9. Agent requests completion.
10. Owner alone accepts.
