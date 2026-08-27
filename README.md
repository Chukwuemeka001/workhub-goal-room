# WorkHub Goal Room

A clean-room, public competition edition demonstrating one idea:

> WebMCP makes a website callable by agents. WorkHub Goal Room makes the next legal action explicit, governed, and visible to the human sharing the page.

## Current scope: Phase 2 owner Plan decision

The Goal Room now presents one synthetic Goal and a proposed Plan as a governed owner decision.

The visible experience:

1. shows the Goal and exact “Done Looks Like” conditions;
2. centers the one decision that needs the owner;
3. lets only the owner confirm the exact active Plan version;
4. lets the owner request a revision with an immutable note;
5. preserves prior Plan versions when a revised Plan is proposed;
6. shows the next legal actor and action;
7. records accepted and refused attempts as deterministic SHA-256-linked receipts;
8. distinguishes Plan confirmation from final Goal acceptance.

The Phase 2 state sequence is:

```text
DRAFT
  → agent proposes Plan v1
PLAN_PROPOSED
  → owner confirms exact Plan
PLAN_CONFIRMED

or

PLAN_PROPOSED
  → owner requests revision
PLAN_REVISION_REQUESTED
  → agent proposes immutable Plan v2
PLAN_PROPOSED
```

Retries are idempotent, stale state versions fail closed, agent self-confirmation is refused, and replay re-evaluates the same transition rules used by live dispatch.

## Phase 0 WebMCP result

**PASS — verified August 27, 2026 in Google Chrome Canary 154 with the browser's WebMCP testing and DevTools experiments enabled.**

The page tool was discovered through `document.modelContext.getTools()`, invoked through `document.modelContext.executeTool()`, returned a structured result, and visibly updated the shared page.

Phase 2 retains this small registration proof. Expanding the agent-facing WebMCP action surface is intentionally deferred to the governed WebMCP phase; the owner page does not duplicate agent reasoning or expose owner-only actions to the agent.

## Current claim limits

This phase does **not** yet implement:

- step claiming or artifact submission;
- independent deterministic verification;
- final owner acceptance;
- production authentication or persistence;
- real deployment or other external effects;
- multiple Goals, organizations, or private WorkHub integration.

The repository is a browser-compatible synthetic demonstration, not a production authorization system or hostile-filesystem security boundary.

## Local development

```bash
npm ci
npm test
npm run dev
```

## Production build

```bash
npm run build
npm run preview
```

## Public/private boundary

This repository is standalone and synthetic. It does not import or depend on private Atlas/WorkHub repositories, client data, provider credentials, or live production effects.

## License

Apache License 2.0.
