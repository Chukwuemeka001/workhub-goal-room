# WorkHub Goal Room V3 — claims register

| Claim | Evidence | Limit |
|---|---|---|
| The page exposes exactly six Agent tools: `get_goal_room_state`, `propose_goal_contract`, `propose_plan`, `claim_step`, `submit_artifact`, `request_completion`. | `evaluation/native-webmcp-v3/native-webmcp-receipt.json` | Native Canary 154.0.8028.0 run; no autonomous selection. |
| Agent invocation used `getTools()` → browser-returned `RegisteredTool` → `executeTool(tool, JSON.stringify(input))`. | Native receipt plus the recorder event timeline in `submission/assets/live-demo-capture.json`. | Browser testing API invocation, not model behavior. |
| Owner revises/confirms Goal and Plan; System authors FAIL/PASS; Owner alone accepts exact Candidate v2. | Continuous interactive video interval 0:00–2:06.8 and the recorder event timeline. | One synthetic browser-local journey. |
| PASS leaves Agent next and grants no acceptance authority. | S12 screenshot and journey checkpoint. | **PASS does not mean accepted.** |
| S13 shows the full candidate digest, rule-set version, PASS, and irreversible consequence. | S13 screenshot and modal receipt. | Owner trusted UI only. |
| S14 is actorless and sealed. | S14 desktop/mobile screenshots and terminal receipt. | No controls or legal continuation. |
| Responsive composition switches at 1199/1200. | Production-journey boundary screenshots. | Viewport/composition evidence only. |
| Phase 5 keyboard, VoiceOver checkpoints, zoom, contrast, privacy, and static scans passed. | `evaluation/phase5-qualification.json` and referenced receipts. | Evidence-limited; not full accessibility, privacy, or security certification. |

## Precision notes

The video is continuous live native governed interaction through sealed S14 from 0:00 to 2:06.8. The 2:06.9–2:18.7 mobile/breakpoint scene and 2:18.85–2:33.84 architecture scene are disclosed source-bound reconstructions. Page registration order is static/source-derived, while raw browser enumeration order is directly observed. The malformed call demonstrates atomic refusal, not autonomous model behavior. The package does not claim accounts, persistence, databases, cloud infrastructure, external effects, autonomous-model reliability, security certification, deployment, or publication.
