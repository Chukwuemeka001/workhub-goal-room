# Phase 7 competition-package audit

**Audited:** 2026-08-27

**Product base:** `e5740dc79710ac9347193ac380d75c4b667de265`

**Live URL:** https://chukwuemeka001.github.io/workhub-goal-room/

**Repository:** https://github.com/Chukwuemeka001/workhub-goal-room

## Verdict

**PACKAGE READY FOR OWNER MEDIA REVIEW.**

The application, repository, architecture, screenshots, and local demo video satisfy the mechanical competition package gates. The only unresolved external requirement is the owner-approved public YouTube URL and the consequential Devpost submission.

## Repository and deployment

- Public GitHub repository: **yes**
- Default branch: `main`
- GitHub-detected license: **Apache-2.0**
- Local, tracked, and remote product SHA before Phase 7 package: `e5740dc79710ac9347193ac380d75c4b667de265`
- GitHub Actions run: `33114080104` — **success**
- GitHub Pages deployment: `6130609816` — **success**, exact product SHA
- Live response: **HTTP 200**
- Live HTML markers: Goal Room, lifecycle rail, and WebMCP status present
- No login or credentials required

## Native WebMCP audit

Chrome Canary `154.0.8027.0` captured exactly five registrations from the functioning local app, in order:

1. `get_goal_room_state`
2. `propose_plan`
3. `claim_step`
4. `submit_artifact`
5. `request_completion`

The captured registrations included the production titles, descriptions, strict input Schemas, and annotations. `get_goal_room_state` carried `readOnlyHint: true` and `untrustedContentHint: true`; the four consequential tools carried `readOnlyHint: false`.

No registration existed for owner Plan confirmation/revision, verifier authorship, Goal acceptance, deployment, messaging, payments, or external effects.

A malformed `claim_step` callback with invalid state/version/content and an injected owner actor returned:

```json
{
  "accepted": false,
  "reasonCode": "INVALID_TOOL_INPUT",
  "currentStateVersion": 1,
  "nextLegalAction": "OWNER_CONFIRM_OR_REVISE_PLAN",
  "ownerRequired": true
}
```

Before and after the call:

- receipt count remained `1`;
- frontier remained `Owner must confirm or request revision`;
- owner attention remained `Review Plan v1`;
- the UI truthfully reported `WebMCP refused claim_step · INVALID_TOOL_INPUT · S1`.

## UI, accessibility, and responsive audit

- One `<main>` and one `<h1>` present.
- Lifecycle stages expose accessible `<label> — <status>` names.
- Initial labels: `Plan — active`; Claim, Evidence, Verify, Complete, and Accept — pending.
- Desktop horizontal overflow at 1440×900: **0 px**.
- Mobile horizontal overflow at 390×844: **0 px**.
- Mobile authoritative status bounds: left `10`, right `380`, width `370` within a 390px viewport.
- Nine captured states show owner → agent → system → agent → owner frontier progression.
- Receipt count advances monotonically from 1 through 9.
- Deterministic FAIL leads to corrected evidence; PASS remains distinct from owner acceptance.
- Final state shows Goal complete and no further governed action.

## Tests and build

```text
Test files                        12/12 passed
Tests                             90/90 passed
TypeScript + production build     passed
npm audit --audit-level=high      0 vulnerabilities
Phase 6 conformance               13/13 positive · 7/7 adversarial
Git diff check                    passed
```

## Media audit

### Architecture

- Source: `submission/assets/workhub-goal-room-architecture.svg`
- Export: 1600×1000 PNG
- PNG SHA-256: `74576068bb814dad05a3bf879d0dac8308896f8ae3d0769a5746104dacbcca18`
- Visual review: no clipping, text collision, arrow-over-text defect, or materially misleading authority path.

### Screenshots

- Nine 1440×900 PNG frames captured from the functioning app in Canary 154.
- Manifest labels the mode as deterministic UI controls, not autonomous browser-native model execution.
- Manifest SHA-256: `9cda82c0ce38892216e07a1c12b0fc464cd2342630f25369250bc2a169f17cc7`

### Demo video

- Path: `submission/assets/workhub-goal-room-demo.mp4`
- Container duration: **154.0 seconds (2:34)** — under the 3:00 limit
- Resolution/frame rate: **1440×900 at 30 fps**
- Video: H.264 High profile
- Audio: AAC, 48 kHz, mono
- Mean/max audio level: `-21.6 dB` / `-0.9 dB`
- File size: 5,122,958 bytes
- MP4 SHA-256: `84c6350b817a8c56d19e96a9b519233d31b435617c33c305c0dc1c07f53caab5`
- English captions end at the exact 2:34 container boundary.
- Sampled title, architecture, correction, PASS, owner-gate, and accepted frames were visually reviewed.
- No music or third-party copyrighted media is included.

## Public/private boundary

The retained package contains synthetic public Goal Room data and no:

- private Atlas/WorkHub source or client data;
- user-home or internal absolute paths;
- credentials, tokens, private keys, or browser session identifiers;
- provider state or raw provider session IDs;
- production deployment, messaging, payment, or external-effect integration.

Temporary Devpost HTML snapshots, disposable browser profile, Vite server, Canary process, generated `dist`, dependency symlink, video render frames, and temporary contact sheets were removed. Ports `4191` and `9333` were verified closed.

## Claim boundary

The polished video is a deterministic UI presentation of the functioning product. It is not evidence of direct autonomous browser-native model execution. Native WebMCP registration, discovery, invocation, mutation, and governed refusal were proven separately. Fresh-model evidence remains one valid observation per distinct scenario with one model/provider and is not a repeated reliability estimate.

## Remaining owner-gated actions

1. Review the exact MP4 and Devpost copy.
2. Approve public YouTube upload of that exact video.
3. Add the resulting public YouTube URL to `DEVPOST_SUBMISSION.md`.
4. Commit and independently review the exact Phase 7 candidate.
5. Approve repository promotion and the exact Devpost submission.
6. Submit before the internal target: September 2, 2026 at noon PT.
