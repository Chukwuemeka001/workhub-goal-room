# Manual accessibility record, V3

Date: 2026-08-28

Production entry: real built `index.html` served on loopback

Platform: macOS 26.3 (25D125)

Browser: Google Chrome Canary 154.0.8028.0, unsigned-in disposable profile

## Evidence classes and claim limits

This record keeps trusted physical-keyboard, actual VoiceOver Caption Panel, automated browser/AX, and native WebMCP evidence separate. It does not claim full WCAG conformance. All demonstration content was synthetic.

## Complete trusted physical-keyboard production journey

Result: **passed** on the real production composition. After initial Canary window activation, every Owner interaction used macOS System Events physical key synthesis only: Tab, Shift+Tab, Return, Escape, and text keystrokes. There was no pointer input in the journey.

Exact checkpoint evidence is machine-readable in `evaluation/physical-keyboard-v3.json`:

- S01: `Tab → text → Tab → Return` set Owner intent; frontier became Agent `AGENT_PROPOSE_GOAL_CONTRACT` at state v1.
- Goal v1: captured production `propose_goal_contract` callback positioned state v2. Return opened the owner dialog at `revision-input`. Physical Shift+Tab wrapped to `submit-revision`; Tab wrapped to `revision-input`. Cancel and Escape each returned focus to the exact `Request Goal revision` trigger with byte-equivalent canonical state; neither mutated authority. Reopen, text, Tab, Tab, Return submitted the sole Goal revision mutation to state v3. Goal v2 was then confirmed with tabs and Return, reaching state v5.
- Plan v1: captured production `propose_plan` callback positioned state v6. The same physical containment checks passed. Cancel and Escape each returned focus to the exact visible `Request revision` trigger with zero authority mutation. Reopen and submit reached state v7; Plan v2 confirmation reached state v9.
- Agent/System path: captured production callbacks claimed the exact Plan v2 step and submitted Candidate v1 and Candidate v2. The production System verifier automatically settled v1 to FAIL/state v12 and v2 to PASS/state v14. PASS remained explicitly non-acceptance. The Agent completion callback reached S13/state v15.
- S13: Tab reached `Accept Goal`; Return opened the exact-candidate dialog with initial focus on `cancel-acceptance`. Shift+Tab wrapped to `confirm-acceptance`; Tab wrapped to Cancel. Cancel and Escape each returned to the exact `Accept Goal` trigger with zero authority mutation. Reopen, Tab, Return confirmed acceptance as the sole mutation to state v16.
- S14: `currentActor: none`, `GOAL_ACCEPTED_NO_FURTHER_ACTION`, visible copy `Goal accepted. No further governed action.`, and zero visible Owner controls.

Agent-state positioning used the six captured descriptors registered by production `src/main.ts`; it was callback integration, **not** browser-native `getTools`/`executeTool` proof and not autonomous model selection. Owner decisions remained physical-key only, and System settlement used production `src/systemVerifierAdapter.ts`.

During the first repair run, physical Shift+Tab from `revision-input` moved focus to `BODY`. A focused behavioral RED reproduced Goal and Plan containment. A second physical run exposed Cancel returning to `BODY`; a focused RED then covered exact trigger restoration. The final complete run passed both behaviors for Goal and Plan.

## Actual VoiceOver production journey

Result: **passed for the matrix's required page-level checkpoints, with the limitations below**. VoiceOver was actually enabled on macOS, the Caption Panel was visible, and the parent operator directly observed the following production checkpoints before turning VoiceOver off:

- web content and main landmarks (`vo-webarea-group.png`, `vo-webcontent-entered.png`);
- heading level 1 `Goal not yet admitted` (`vo-initial-heading1.png`);
- current authority heading level 2 `Owner` (`vo-initial-authority-owner.png`);
- actual revision textareas inside the Goal and Plan dialogs (`vo-goal-revision-dialog.png`, `vo-plan-revision-dialog.png`);
- heading level 2 `Candidate v1 did not pass` (`vo-system-fail-heading.png`);
- heading level 2 `Candidate v2 passed deterministic verification`, with visible `Agent acts now` and PASS-not-acceptance copy (`vo-system-pass-heading.png`);
- S13 heading level 2 `Accept Candidate v2`, visible irreversible consequence, full digest `e7c2c9e94c951cbd88355c8cf0cf96afd94ba107055f99c0fcdf579c17e0119d`, PASS rule set, Cancel, and Confirm (`vo-s13-acceptance-dialog.png`);
- S14 heading level 2 `Goal complete`, visible `TERMINAL · OWNER ACCEPTED`, `No further governed action`, and no actions (`vo-s14-goal-complete.png`).

Navigation method: Canary was foreground and VoiceOver commands were sent through macOS System Events. From the toolbar, Control-Option-Shift-Up exited the toolbar, Control-Option-Right reached web content, Control-Option-Shift-Down entered main, and Control-Option-Command-H navigated headings. For exact checkpoint synchronization only, the operator temporarily applied runtime `tabindex=-1`, focused the production heading, and used Control-Option-Shift-F4. This did not alter repository source or authority state.

Production states were positioned through captured production descriptor callbacks plus visible production Owner controls and the production System verifier. Those transitions are explicitly **not** native WebMCP proof. The screenshots prove the displayed Caption Panel checkpoint and visible production state; they do not establish every utterance, uninterrupted rotor order, every focus-return transition, or full WCAG conformance. Dialog labels/descriptions and physical-key containment/return are additionally supported by the separate keyboard and automated evidence classes.

Selected public-safe screenshots and their SHA-256 hashes are in `evaluation/voiceover-v3/manifest.json`. These evidence copies are cropped to the Canary/Caption Panel region and mask only non-evidence desktop pixels; the observed WorkHub and Caption Panel content is unchanged. VoiceOver was stopped after the run and verified absent.

## Automated production and qualification evidence

The widening evidence records one named main in each active composition, distinct desktop/mobile compositions, named tabs and tabpanels, visible focus, dialog semantics, 200 percent zoom, reduced motion, minimum 44 CSS pixel controls, representative contrast, 320 pixel hostile content, safe-area docking, zero unintended horizontal overflow, literal hostile rendering, S13 exact binding, and sealed S14.

Primary references: `evaluation/production-journey/journey.json`, `evaluation/v3/a11y.json`, `evaluation/v3/hostile.json`, and `evaluation/v3/responsive.json`.

## Deferred baseline P2 labels

Phase 4 baseline P2 labels remain evidence history and are not promoted here. This phase does not claim independent review or owner acceptance.
