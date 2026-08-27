# Goal Room V2 State Model Contract

## State machine

```text
INTENT_DRAFT
→ GOAL_CONTRACT_PROPOSED
→ GOAL_CONTRACT_REVISION_REQUESTED
→ GOAL_CONTRACT_PROPOSED (next immutable version)
→ GOAL_CONTRACT_CONFIRMED
→ PLAN_PROPOSED
→ PLAN_REVISION_REQUESTED
→ PLAN_PROPOSED (next immutable version)
→ PLAN_CONFIRMED
→ STEP_CLAIMED
→ CANDIDATE_SUBMITTED
→ VERIFICATION_FAILED ─→ CANDIDATE_SUBMITTED
→ VERIFICATION_PASSED
→ COMPLETION_REQUESTED
→ GOAL_ACCEPTED
```

## Proposed data structures

```ts
type OwnerIntent = {
  text: string;
  revision: number;
};

type GoalContractVersion = {
  version: number;
  status: "PROPOSED" | "REVISION_REQUESTED" | "CONFIRMED";
  proposedBy: "agent";
  goal: string;
  why: string;
  doneLooksLike: string[];
  constraints: string[];
  nonGoals: string[];
  evidenceRequired: string[];
  openQuestions: string[];
  revisionRequest?: {
    requestedBy: "owner";
    note: string;
  };
};
```

Plan versions add `goalContractVersion` and remain immutable.

## Commands

### Owner-only

- `SET_OWNER_INTENT`
- `CONFIRM_GOAL_CONTRACT`
- `REQUEST_GOAL_CONTRACT_REVISION`
- `CONFIRM_PLAN`
- `REQUEST_PLAN_REVISION`
- `ACCEPT_GOAL`

### Agent-only

- `PROPOSE_GOAL_CONTRACT`
- `PROPOSE_PLAN`
- `CLAIM_STEP`
- `SUBMIT_CANDIDATE`
- `REQUEST_COMPLETION`

### System-only

- `RECORD_VERIFICATION`

## Invariants

1. Owner intent cannot authorize a Plan or work.
2. An agent cannot confirm its own Goal Contract.
3. Goal Contract versions are immutable.
4. Revision binds to the exact active proposed version.
5. A Plan is illegal until Goal Contract confirmation.
6. A Plan binds to an exact confirmed Goal Contract version.
7. A changed confirmed Goal requires explicit supersession; prior Plan/claim/candidate cannot silently carry forward.
8. No work is legal before Plan confirmation and step admission.
9. Candidate bytes and digest are immutable.
10. Producers cannot author verification.
11. PASS binds to exact candidate digest and rule-set version.
12. PASS does not accept the Goal.
13. Every command carries expected state version and idempotency key.
14. Exact retry returns the same authoritative result without duplicate receipt.
15. Same key with changed content fails closed without extra receipt.
16. Stale valid command enters the kernel and receives governed refusal receipt.
17. Malformed WebMCP input fails at runtime admission without mutation or receipt.
18. Live dispatch and replay use the same transition evaluator.

## Goal revision after confirmation

V2 challenge scope does not permit silent in-place mutation of a confirmed Goal.

If the owner wants to change scope after Goal confirmation:

1. open an explicit Goal amendment request;
2. freeze new claims while amendment is unresolved;
3. agent proposes a new Goal Contract version;
4. owner confirms it;
5. active Plan becomes superseded;
6. agent proposes a new Plan bound to the new Goal version.

This amendment path may be deferred from the first implementation slice, but the state model must not imply that confirmed Goal text can be edited directly.

## View projection requirements

Every phase projects:

- Goal Contract version/status
- Plan version/status
- current actor
- next legal action
- owner required
- active/failed lifecycle chapter
- visible owner controls
- visible agent boundary
- evidence/verdict/acceptance distinction
- receipt count

## First implementation test matrix

- owner intent → Goal proposal legal
- Plan proposal before Goal confirmation refused
- owner confirms Goal → Plan proposal legal
- owner revises Goal v1 → v2 required
- agent cannot confirm Goal
- owner cannot propose Goal
- stale Goal confirmation refused
- exact Goal proposal retry idempotent
- changed-key Goal proposal reuse refused
- replay reconstructs Goal history and current frontier
