# Privacy Notice

WorkHub Goal Room is a synthetic, static competition demonstration. Enter synthetic data only.

## Data lifecycle

Room state exists in browser memory for the current page lifecycle. Reloading the page starts a fresh room. The application does not implement accounts, login, credentials, cookies, IndexedDB, localStorage, sessionStorage, Cache Storage, or server-side application storage.

The application does not implement analytics, advertising, third-party tracking, telemetry, payments, deployment, messaging, or other external effects. The tested production build is static HTML, CSS, and JavaScript. It installs no local verifier endpoint and can be served by a local static server or static hosting such as GitHub Pages.

During optional development serving only, an explicit-startup-base, loopback-only verifier can read local unreplaced Git object and path metadata after a deliberate click. It pins `/usr/bin/git` and requires its configured root to equal Git's canonical top-level. Browser requests cannot select paths, refs, commands, environment, or output. Repository display names, relative paths, commit/tree IDs, and inventory/diff digests can appear in the local browser view; absolute roots and scratch paths are excluded. The result is point-in-time and later repository changes are not monitored. No candidate package script, Vite/Vitest configuration, or other candidate code runs; executable checks remain `INDETERMINATE / NOT RUN` with reason `SANDBOX_UNAVAILABLE`, `SANDBOX_POLICY_UNAVAILABLE`, or `SANDBOX_EXECUTION_NOT_IMPLEMENTED`.

Automated production observation loaded only the expected same-origin document, module, and stylesheet assets. Static inspection found no third-party analytics/network client or browser persistence API in production source. Browser and hosting infrastructure may still make their own ordinary network requests under their separate policies; this notice describes the application code in this repository.

## Do not enter

Do not enter passwords, API keys, raw tokens, private URLs, private repository references, client data, personal data, regulated data, or confidential content. The public demonstration is not a secure data-processing environment.
