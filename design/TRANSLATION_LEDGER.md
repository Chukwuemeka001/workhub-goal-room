# Goal Room V3 Translation Ledger

This ledger binds approved V3 concepts to production projections, qualification evidence, and explicit non-claims.

## Surface translation

| Approved concept | Production projection | Styling contract | Qualification witness | Boundary |
| --- | --- | --- | --- | --- |
| Canonical state and chapter | `src/custodyView.ts`, `src/desktopUi.ts` | `.desktop-state-bar`, `.desktop-chapter` | responsive and visual matrices | Projection only |
| Agent, System, Owner custody | `src/custodyView.ts` | `.desktop-custody` and actor data attributes | all 14 stories | Color never grants authority |
| Owner-first mobile | `src/mobileView.ts`, `src/mobileUi.ts` | `@media (max-width: 1199px)` | 320 through 1199px | Separate composition |
| Editorial desktop | `src/desktopView.ts`, `src/desktopUi.ts` | `@media (min-width: 1200px)` | 1200, 1440, and 1728px | Existing IA preserved |
| PASS is not acceptance | proof projections and owner view copy | PASS and owner colors remain distinct | S12, S13, S14 | Only S14 is accepted |
| Failed history retained | candidate and verification histories | candidate-history rows | S10 through S14 | No history rewrite |
| Exact acceptance | `src/acceptanceDialog.ts` | shared dialog contract | focused acceptance tests | Owner-only controller path |
| Static-six visibility | `src/toolSurfaceView.ts` | collapsed `.desktop-tools` | desktop rows in all stories | Read-only, no tool buttons |
| Hostile content safety | DOM `textContent` helpers | `overflow-wrap: anywhere` | hostile and zoom QA | No HTML interpretation |
| Reduced motion | CSS media rules | zero durations | a11y QA media emulation | No animation claim |

## Fourteen-story replay

Every canonical row below is captured after a real admitted command or verifier operation. S09 is called out separately because its presentation label is synthetic and test-only.

| Story | Display meaning | Real kernel phase | State version | Presentation source |
| --- | --- | --- | ---: | --- |
| S01 | Owner intent recorded | `INTENT_DRAFT` | 1 | Canonical |
| S02 | Goal Contract proposed | `GOAL_CONTRACT_PROPOSED` | 2 | Canonical |
| S03 | Goal revision requested | `GOAL_CONTRACT_REVISION_REQUESTED` | 3 | Canonical |
| S04 | Goal Contract confirmed | `GOAL_CONTRACT_CONFIRMED` | 5 | Canonical |
| S05 | Plan proposed | `PLAN_PROPOSED` | 6 | Canonical |
| S06 | Plan revision requested | `PLAN_REVISION_REQUESTED` | 7 | Canonical |
| S07 | Plan confirmed | `PLAN_CONFIRMED` | 9 | Canonical |
| S08 | Step claimed | `STEP_CLAIMED` | 10 | Canonical |
| S09 | Verification in progress | `CANDIDATE_SUBMITTED` | 11 | Synthetic/test-only transient label over canonical bytes |
| S10 | Verification failed | `VERIFICATION_FAILED` | 12 | Canonical |
| S11 | Corrected candidate submitted | `CANDIDATE_SUBMITTED` | 13 | Canonical |
| S12 | Verification passed, not accepted | `VERIFICATION_PASSED` | 14 | Canonical |
| S13 | Completion requested | `COMPLETION_REQUESTED` | 15 | Canonical |
| S14 | Goal accepted | `GOAL_ACCEPTED` | 16 | Canonical |

S09 never appears in a production entry point. The qualification note names its test-only status visibly. Its state digest and receipt hash come from the same real-kernel snapshot used by the production projections.

Normal visual evidence uses the legible baseline replay. Hostile QA explicitly requests the alternate real-kernel replay whose intent, Goal Contract, revisions, and Plan carry markup-shaped text, unbroken runs, Unicode, and emoji. Both paths use the same commands, authority gates, receipt chain, and replay check.

## Tool ledger

The informational list mirrors registration order exactly:

```text
get_goal_room_state
propose_goal_contract
propose_plan
claim_step
submit_artifact
request_completion
```

The list is static. Current-phase availability is guidance only. No owner decision, system verification, deployment, payment, publishing, or messaging tool is added.

## Production exclusion ledger

| Guard | Expected result |
| --- | --- |
| `index.html` reference to `qualification/` | None |
| `src/main.ts` reference to `qualification/` | None |
| Built HTML, JS, or CSS containing fixture tokens | None |
| Qualification fixture reachable from production bundle | No |
| Protected authority bytes changed | No |

Protected byte checks cover:

```text
src/core/goalRoom.ts
src/ownerController.ts
src/verifier/releaseRules.ts
src/webmcp.ts
src/webmcp-globals.d.ts
```

## Evidence ledger

Deterministic evidence is written under `evaluation/v3/`:

- `visual.json` and six bound PNG captures
- `responsive.json`
- `a11y.json`
- `hostile.json`
- `fixture-exclusion.json`
- `protected-bytes.json`
- `qualification-receipt.json`

The receipt contains no wall-clock timestamp. It binds stable source hashes, the witnessed test-first RED, the real-kernel story catalog, the final receipt-chain hash, and the passing QA summaries.
