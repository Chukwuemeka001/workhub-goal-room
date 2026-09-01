# Security Policy

## Supported scope

Security reports are accepted for the public WorkHub Goal Room competition edition in this repository. Open a private GitHub security advisory in the repository that published this edition. If that route is unavailable, open a public issue containing only a minimal, non-sensitive description and ask for a private reporting route. Do not post secrets, personal data, exploit payloads, or client data in an issue.

## Demonstration boundary

This is a synthetic demonstration, not an enterprise or production-security claim. The static production build is browser-only: it has no accounts, login, credentials, backend endpoint, server-side application storage, analytics, payments, deployment action, messaging action, or other application effect. Reload starts a fresh room.

Local development may optionally install a loopback-only Git observation endpoint when the verifier process starts with an explicit full base commit. The verifier pins `/usr/bin/git`, disables replacement objects, and requires its configured root to equal Git's canonical top-level. Observation is deliberate-click only, accepts an empty browser body, and has no repository/command selection capability. It reads unreplaced Git objects and worktree inventory metadata as a point-in-time snapshot; later repository changes are not monitored. It never executes candidate-controlled package scripts, Vite/Vitest configuration, or other candidate code. Executable checks remain `INDETERMINATE / NOT RUN` with reason `SANDBOX_UNAVAILABLE`, `SANDBOX_POLICY_UNAVAILABLE`, or `SANDBOX_EXECUTION_NOT_IMPLEMENTED`. A scratch directory or detached checkout is not treated as a sandbox, and there is no direct host-execution fallback.

Use synthetic demonstration data only. Do not submit credentials, tokens, private URLs, private repository names, personal data, client data, regulated data, or confidential source material.

The governed WebMCP surface requires a qualifying ChatGPT in-app browser or Chrome/Canary build with WebMCP support. Unsupported clients retain the Owner UI but cannot invoke the agent tools.

## Known limitations

- Browser-local logical actor separation is not cryptographic identity or hostile-filesystem isolation.
- The static competition edition does not provide durable recovery or multi-user concurrency.
- `Referrer-Policy: no-referrer` is set through HTML metadata.
- A Content Security Policy is intentionally omitted because end-to-end GitHub Pages path behavior plus native WebMCP execution under a proposed policy was not proven in this phase.
- PASS proves only the documented deterministic checks. It is not owner acceptance.
