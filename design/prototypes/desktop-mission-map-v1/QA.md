# Desktop Prototype QA Receipt

## Verdict

- **Mission Room: KEEP as production desktop direction.**
- **Living Goal Map: KEEP as secondary causal/binding inspector.**

## Measured matrix

Tested at 1440×900:

- 2 materially distinct compositions
- 4 authoritative checkpoints per composition
- 8 total composition/checkpoint combinations

Every combination produced:

- zero horizontal document overflow;
- visible Goal origin;
- correct state code;
- correct current actor;
- owner buttons only at owner frontiers;
- agent status regions instead of owner-looking controls;
- current composition visible in viewport.

## Visual/product review

Mission Room wins as the default because:

- the current decision/frontier is the largest visual object;
- Goal origin remains visible in the left rail;
- exact binding and conditions remain inspectable on the right;
- canonical Goal/Proof data and receipts are subordinate but available;
- it reads as an operational workspace rather than a dashboard card grid.

Living Goal Map remains useful because:

- blocked nodes are visible;
- Goal → Plan → Candidate → Acceptance custody is legible;
- exact references communicate why the active frontier is legal.

## Semantic repair

Initial map rendering reused context-version labels and incorrectly showed `plan_v2` while Plan was blocked. Repaired and verified exact node references:

```text
Intent:
  Goal = intent_r1
  Plan = —
  Candidate = —
  Acceptance = owner only / not legal

Goal v1 proposed:
  Goal = goal_v1
  Plan = — / blocked
  Candidate = —
  Acceptance = owner only / not legal

FAIL:
  Goal = goal_v2
  Plan = plan_v2
  Candidate = 4f7c…9a03 / failed
  Acceptance = owner only / not legal

PASS completion gate:
  Goal = goal_v2
  Plan = plan_v2
  Candidate = d803…6b2a / passed
  Acceptance = owner only / required
```

## Known limits

- Inspector tabs are visual prototype controls; full panel switching is deferred.
- Buttons model legal frontiers but do not dispatch the authority kernel.
- Responsive desktop/tablet refinement is deferred to production UI phases.
