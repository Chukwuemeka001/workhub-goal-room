# Goal Room V3 Visual Contract

Status: implemented production contract

## Product truth

Goal Room V3 is one governed Goal presented as a shared custody room. The visual layer projects canonical state; it does not create authority, infer a transition, run verification, or accept a Goal.

The permanent authority chain is:

```text
Agent -> System Verifier -> Owner
```

Only one lane acts at a legal frontier. `PASS` means the declared deterministic checks passed for exact candidate bytes. It is never owner acceptance. The owner becomes active only after the agent binds a completion request to that PASS candidate.

## Design read

This is a trust-first product workspace with an editorial desktop language and a compact owner-first mobile operating mode.

- Design variance: 4. The hierarchy is offset, but custody stays predictable.
- Motion intensity: 2. State feedback is immediate and motion is not used as decoration.
- Visual density: 5. Canonical facts remain inspectable without turning the page into a generic dashboard.
- System: existing dependency-free TypeScript DOM projections with native CSS.
- Theme: one charcoal theme family with paper-white type and semantic custody colors.

The editorial character comes from a restrained serif for high-level Goal and frontier headings, strong horizontal rules, document-like spacing, and plain evidence typography. Product controls and operational metadata remain sans-serif or monospace.

## Breakpoint contract

The breakpoint is part of the product contract, not an implementation hint.

| Viewport | Required composition |
| --- | --- |
| `0-1199px` | Dedicated mobile composition |
| `1200px+` | Editorial desktop composition |

Exactly one named `main` is visible and exposed to the accessibility tree. Production CSS hides the opposite composition. The mobile UI is not the desktop grid squeezed smaller.

## Desktop composition

Desktop order is fixed:

1. Goal identity and connection status
2. Canonical state and chapter bar
3. Three-lane custody strip
4. Current frontier and selected inspector
5. Collapsed lifecycle, static-six tools, and receipts

The custody strip always renders Agent, System Verifier, and Owner in that order. One lane may be current before terminal acceptance. The accepted state seals every lane and leaves none current.

The static-six tool disclosure is informational and collapsed by default. Its rows can describe current availability, but they never become buttons and never imply dynamic tool registration.

## Mobile composition

Mobile order is fixed:

1. Goal title and admission status
2. Current chapter
3. One authority frontier
4. Owner action dock when an owner action is legal
5. Goal, Plan, Proof, and Activity tab destinations
6. Safe-area tab bar

The first selected destination is Goal. The action dock sits above the tab bar and includes the bottom safe-area inset. Page padding reserves both fixed layers, so content is not hidden behind controls.

## Interaction and target rules

- Every visible button, tab, textarea, and disclosure summary has a minimum 44px target height.
- Keyboard tabs use Left, Right, Home, and End without invoking an owner action.
- Focus uses a visible 3px amber outline with separation from the target edge.
- Acceptance opens an exact-candidate confirmation dialog showing candidate version, full SHA-256 digest, PASS rule set, and irreversible consequence.
- Cancel and Escape close acceptance without mutation.
- Static tool details contain no interactive descendants.

## State and evidence rules

- Failed candidates and FAIL verification records remain visible after later correction and PASS.
- Candidate digests wrap; they are never truncated into an authoritative value.
- PASS copy explicitly states that the Goal is not accepted.
- Completion and acceptance copy identify the exact bound candidate digest.
- Receipt history preserves accepted and refused attempts.
- Hostile strings are assigned with `textContent` and rendered literally.

## Responsive, zoom, and hostile-content rules

- Layout containers use `min-width: 0` and long prose, code, list items, and headings use hostile-safe wrapping.
- The minimum supported CSS viewport is 320px.
- The mobile composition covers phones, tablets, landscape tablets, and browser zoom that reduces the CSS viewport below 1200px.
- Qualification includes a 200 percent page-scale probe and long unbroken Unicode and markup-shaped strings.
- The baseline replay remains editorially legible; the hostile suite requests a separate real-kernel replay carrying the stress strings.
- Horizontal document, body, and active-root overflow must remain zero.

## Motion and theme rules

No automatic or perpetual motion is part of V3. Active presses may move by one pixel as direct feedback. Under `prefers-reduced-motion: reduce`, animation and transition durations resolve to zero.

Semantic colors are limited to state meaning:

- Owner: amber
- Agent: teal
- System Verifier: periwinkle
- PASS: green
- FAIL: orange

These colors do not transfer authority. Text and labels remain the primary signal.

## Qualification boundary

The `qualification/` package is excluded from production entry points and production bundles. It replays 14 stories through the real kernel, static-six WebMCP callbacks, system verifier, and owner controller.

S09 is the only synthetic presentation state. It adds an explicit test-only "verification in progress" label over the real `CANDIDATE_SUBMITTED` kernel snapshot. It does not mutate kernel state, author a verification record, or create a production transition.

Browser QA covers visual evidence, breakpoint behavior, accessibility-tree and keyboard behavior, hostile content and 200 percent zoom, fixture exclusion, and protected authority-file byte identity. The browser checks do not claim manual screen-reader certification or production authentication.
