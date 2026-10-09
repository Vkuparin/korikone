# v0.5.0 release candidate

Prepared on 9 October 2026 on `codex/v0.5.0-release`. This candidate integrates the published v0.4.0 behavior with the embedded retailer work on main. Publication and final owner acceptance are pending.

## Changes

- Both retailers open inside Korikone, with separate persistent sign-in sessions. Setup selects one store, opens its sign-in, offers optional ChatGPT connection and finishes on one screen.
- The shopping total offers the second chain when only one is connected. Its store and sign-in are configured in Settings.
- One approval checks and transfers the displayed batch, verifies the result and opens the K-Ruoka basket or S-kaupat account list. Exceptions retain their decision and recovery paths. Reopening a verified transfer does not add products again.
- S-kaupat uses the released v1.3.0 library through the store tab's session. The shared library owns requests, account state, token renewal and errors. Ordering and payment tools remain disabled.
- S-kaupat's list-to-basket step remains manual: press *Lisää kaikki ostoskoriin* on the retailer site and choose its required store, delivery type and slot.
- Explicit note updates, retained quotes, model selection and the runtime version in Settings remain available.

## Installation

The candidate is an unsigned Windows x64 NSIS installer. Export a backup in Settings before upgrading. The application ID and data location stay the same. Sign in once in each new retailer tab; older worker-browser sessions are not copied into those tabs. Updates and checkout remain manual.

## Verification

All 162 unit tests, all 38 source desktop tests, the production build and formatting pass. All 18 packaged checks pass, followed by the affected second-chain hint/restart check on the final rebuilt installer. The first full desktop run exposed a stale-result reload bug and an assertion for the former navigation; both are fixed and the final full rerun passes. Tests use local fixtures and isolated development data; they make no live ChatGPT or retailer requests. The production npm audit reports no vulnerabilities.

Installer: `release/Korikone-0.5.0-x64-setup.exe`. SHA-256: `860a54f3fae528401c8e0917f470ba1e4f1ad8563512b45a824cd3635a305746`. The checksum file is `release/SHA256SUMS-0.5.0.txt`. Archive inspection confirms the shared library v1.3.0 runtime and Apache license are included.

## Final owner check

Use manual grocery additions to avoid ChatGPT requests. Check setup at the normal window size; connect the second chain from the hint and Settings; restart and check both remembered stores and sessions. With explicit permission for live retailer testing, approve a small batch at each chain, check account and quantities, and reopen it to confirm no duplicate additions. At S-kaupat, check the manual add-all step and its store/type/slot choices. Earlier owner observations remain recorded in acceptance; these steps check the integrated candidate.

Payment redirects have not been observed in this candidate. Checkout is performed by the owner. Clean-machine installation, upgrade, uninstall, signing and household acceptance remain separate stable-release gates.
