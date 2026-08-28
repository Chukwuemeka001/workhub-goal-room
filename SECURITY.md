# Security Policy

## Supported scope

Security reports are accepted for the public WorkHub Goal Room competition edition in this repository. Open a private GitHub security advisory in the repository that published this edition. If that route is unavailable, open a public issue containing only a minimal, non-sensitive description and ask for a private reporting route. Do not post secrets, personal data, exploit payloads, or client data in an issue.

## Demonstration boundary

This is a browser-local synthetic demonstration, not an enterprise or production-security claim. It has no accounts, login, credentials, backend, server-side application storage, analytics, payments, deployment action, messaging action, or other external effect. Reload starts a fresh room.

Use synthetic demonstration data only. Do not submit credentials, tokens, private URLs, private repository names, personal data, client data, regulated data, or confidential source material.

The governed WebMCP surface requires a qualifying ChatGPT in-app browser or Chrome/Canary build with WebMCP support. Unsupported clients retain the Owner UI but cannot invoke the agent tools.

## Known limitations

- Browser-local logical actor separation is not cryptographic identity or hostile-filesystem isolation.
- The static competition edition does not provide durable recovery or multi-user concurrency.
- `Referrer-Policy: no-referrer` is set through HTML metadata.
- A Content Security Policy is intentionally omitted because end-to-end GitHub Pages path behavior plus native WebMCP execution under a proposed policy was not proven in this phase.
- PASS proves only the documented deterministic checks. It is not owner acceptance.
