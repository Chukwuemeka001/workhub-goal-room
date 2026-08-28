# Manual accessibility record, V3

Date: 2026-08-28

Production entry: local real `index.html` at `http://127.0.0.1:4175/`

Platform: macOS 26.3 (25D125)

Browser: Google Chrome Canary 154.0.8028.0, unsigned-in disposable profile

## Evidence classes and claim limits

This record keeps manual keyboard, actual VoiceOver, and automated browser/AX evidence separate. It does not claim full WCAG conformance.

## Keyboard-only production journey

The existing real-production journey exercised every authority transition through `src/main.ts`, the six captured production tool descriptors, visible Owner controls, automatic System verification, and the exact-candidate dialog. That automation used pointer dispatch for visible Owner controls and therefore is **not** relabeled as the required manual keyboard-only journey.

The trusted-keyboard supporting checks exercised tab semantics and acceptance-dialog Tab, Shift+Tab, Escape, containment, and exact focus return at mobile and desktop sizes. Those checks are automated supporting evidence in `evaluation/v3/a11y.json`, not a complete manual keyboard journey.

Result: the full manual keyboard-only production journey was not independently completed in this run. The keyboard gate remains limited to automated trusted-key evidence and the real-production transition evidence described above.

## Actual VoiceOver run

VoiceOver was actually running as `/System/Library/CoreServices/VoiceOver.app/Contents/MacOS/VoiceOver` (PID 32972 at the start of the bounded run). The Caption Panel was opened with Control-Option-Fn-Command-F10. A screen capture successfully recorded the panel, but macOS rendered the rest of the captured display black. The only directly observed Caption Panel strings were:

- `Chrome Canary is launched in the background`
- `Login failed`

Commands actually exercised while VoiceOver was running included Control-Option-Shift-Down and Control-Option-Right after activating the exact disposable Canary production tab. Foreground routing repeatedly returned unverified delivery, and the Caption Panel did not move from the app/background announcement into page content. No permission dialog was accepted or bypassed.

Because page-level speech/navigation was not directly observed, this record does **not** claim spoken proof for the initial intent, authority bands, Goal/Plan dialogs, FAIL, PASS, S13, or S14 checkpoints. CDP/AX evidence for those checkpoints remains supplementary only. VoiceOver was then quit directly and `pgrep` verified it absent before repository edits.

Result: actual VoiceOver was enabled and bounded interaction was attempted, but the required page-level VoiceOver gate is inconclusive rather than passed.

## Automated production and qualification evidence

The existing widening evidence records:

- one named main in each active composition and distinct desktop/mobile compositions;
- named tabs and tabpanels, visible focus, exact dialog focus entry/containment/return;
- S13 Candidate v2, full SHA-256 digest, PASS rule set, irreversible consequence, and sole Confirm mutation;
- S14 `currentActor: none`, no owner-action button, and no legal continuation;
- 200 percent zoom, reduced motion, 44 CSS pixel minimum controls, 320 pixel hostile content, safe-area docking, and zero unintended horizontal overflow;
- literal hostile rendering with no injected node.

Primary references: `evaluation/production-journey/journey.json`, `evaluation/v3/a11y.json`, `evaluation/v3/hostile.json`, and `evaluation/v3/responsive.json`.

## Deferred baseline P2 labels

Phase 4 baseline P2 labels remain carried without promotion: prior visual/workflow limitations and the known 621px desktop overflow historical label are evidence history, not newly introduced Phase 5 findings. This phase does not claim independent review or owner acceptance.
