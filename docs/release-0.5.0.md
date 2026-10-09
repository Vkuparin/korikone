# v0.5.0 pre-release

Prepared on 9 October 2026 and updated after authorized live checks on 10 October on `codex/v0.5.0-release`. [PR #11](https://github.com/Vkuparin/korikone/pull/11) landed on main in `bb18b11`. This release integrates published v0.4.0 behavior with embedded retailer sessions. This page records verification and the remaining stable-release gates.

Release assets: [GitHub v0.5.0 release](https://github.com/Vkuparin/korikone/releases/tag/v0.5.0). The installer contains application commit `288fbee`; `871813c` changes only tests. GitHub's asset digest matches the local SHA-256.

## Changes

- Both retailers open inside Korikone, with separate persistent sign-in sessions. Setup selects one store, opens its sign-in, offers optional ChatGPT connection and finishes on one screen.
- The shopping total offers the second chain when only one is connected. Its store and sign-in are configured in Settings.
- One approval checks and transfers the displayed batch, verifies the result and opens the K-Ruoka basket or S-kaupat account list. Exceptions retain their decision and recovery paths. Reopening a verified transfer does not add products again.
- S-kaupat uses the released v1.3.0 library through the store tab's session. The shared library owns requests, account state, token renewal and errors. Ordering and payment tools remain disabled.
- S-kaupat's list-to-basket step remains manual: press *Lisää kaikki ostoskoriin* on the retailer site and choose its required store, delivery type and slot.
- Explicit note updates, retained quotes, model selection and the runtime version in Settings remain available.
- Embedded-frame redirects stay within their frames. K-Ruoka handoff selects the reviewed store and opens its basket using the retailer's own query parameters.

## Installation

The release is an unsigned Windows x64 NSIS installer. Export a backup in Settings before upgrading. The application ID and data location stay the same. Sign in once in each new retailer tab; older worker-browser sessions are not copied into those tabs. Updates and checkout remain manual.

## Verification

Final application commit `288fbee` passes 164 unit tests, all 38 source desktop tests, build and formatting. All 23 packaged checks pass across the full run and focused reruns: 21 passed initially, while two screenshot timeouts were resolved by showing the packaged fixture window after it loaded. All six affected shopping cases then passed on the package. Test-only commit `871813c` also gives the affected CI handoff assertion 15 seconds; its focused source and packaged checks and both full CI runs pass ([PR CI](https://github.com/Vkuparin/korikone/actions/runs/38002894706)). No application or installer code changed after `288fbee`. Automated tests use isolated development fixtures and no live accounts. The production npm audit reports no vulnerabilities.

Installer: `release/Korikone-0.5.0-x64-setup.exe`. SHA-256: `4b994d9785c35087e5b72265474c75487b75d42ef8271f7a46176c57da0d009b`. The checksum file is `release/SHA256SUMS-0.5.0.txt`. The shared library v1.3.0 runtime and Apache license are included.

## Final owner check

The owner authorized small live retailer checks. The packaged app recognized both embedded sign-ins and remembered stores after restart. One manual coffee pack was transferred at each chain. S-kaupat's existing Coop coffee quantity changed from one to two after its exception confirmation; its signed-in list showed two again after restart and open-only reopening. K-Ruoka's K-Menu coffee changed from zero to one. After the handoff fix, reopening selected K-Supermarket Hertta and showed quantity one with the existing item preserved. S-kaupat's manual add-all button was visible and was not pressed. No ChatGPT request, order, payment or slot selection was made. The original local owner profile was preserved; an isolated copy held the acceptance plan.

The K-Ruoka catalogue quote was €2.69, while the site's basket showed €1.83 for the pack at Hertta. This check verifies account, destination and quantity, not identical catalogue/basket pricing; complete price handling remains in the accepted v0.6.0 roadmap. Fresh sign-in, the second-chain hint and expiry are covered by earlier owner observations and current fixtures; both accounts were already connected in this live check.

Payment redirects have not been observed in this candidate. Checkout is performed by the owner. Clean-machine installation, upgrade, uninstall, signing and household acceptance remain separate stable-release gates.
