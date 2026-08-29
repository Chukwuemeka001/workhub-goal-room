# WorkHub Goal Room V3 — competition requirements

Candidate product: `5ac95d4bdab5f54beda0f90776c3918fd36136d2`  
Candidate tree: `b6b50068e8119d02d1d9213286f14adf3cbc0db1`  
Date: 2026-08-28

## Required truth

- Exactly six Agent tools: `get_goal_room_state`, `propose_goal_contract`, `propose_plan`, `claim_step`, `submit_artifact`, `request_completion`.
- Owner alone confirms or revises Goal and Plan.
- System alone authors deterministic FAIL or PASS through the production adapter.
- Agent may request completion only after PASS.
- **PASS does not mean accepted.**
- Owner alone accepts the exact verified candidate.
- S14 has current actor `none` and no legal continuation.

## Evidence requirements

The current package must validate Phase 3 production, Phase 4 native, and Phase 5 accessibility/security/privacy receipts. Screenshots must resolve by relative path and bind SHA-256, bytes, dimensions, evidence class, source receipt, state, actor, frontier, production identity, and capture date. Architecture must be self-contained HTML/inline SVG plus exported SVG and PNG. Video must decode as H.264/AAC, remain under 180 seconds, and carry ordered non-overlapping English captions.

The native claim is limited to Canary discovery and invocation of browser-returned `RegisteredTool` objects. Static registration order is source-derived; raw enumeration is observed separately. S14 proves malformed-input atomicity, not a schema-valid terminal reducer refusal. Actor totals are chronology-derived. No autonomous model selection is claimed.

## Scope boundary

One synthetic browser-local Goal only. No accounts, backend persistence, database, cloud service, external effects, autonomous-model reliability, or enterprise-security claim. Public URL, repository, YouTube, and Devpost fields stay explicitly pending until separate Owner authorization.
