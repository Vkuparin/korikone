# v0.11.2 release verification

Published on 25 October 2026 as an unsigned Windows x64 pre-release: [GitHub release](https://github.com/Vkuparin/korikone/releases/tag/v0.11.2). Source tag v0.11.2 is the release commit on main. It contains the composer-to-cart reliability cards B4.1–B4.5 in [the 0.11.2 task list](tasks/0.11.2.md); v0.12 scope is unchanged.

## What changed

- A refused but parseable planning reply is kept in part instead of spending a second request: invalid metadata is downgraded, unusable dishes and items are left out and named in the list notes.
- When the model gives nothing usable (invalid after one repair, incomplete or timed out), the note's own requests go on the list as plain product searches with an explanation. Usage, account and provider errors still fail visibly.
- A failed or slow store read leaves that row unsearched instead of failing the whole request, in planning, pricing and edits. The catalogue deadline keeps what was found. A store that answered no row is shown next to the saved list with a link to store settings.
- Edits apply their clear operations and report the parts that were not done, unless those parts are about a row the edit changes. Changed rows are read two at a time.
- Recipes in AI replies carry a one-line note instead of cooking steps, and edit limits fit several new dishes in one instruction.
- Planning notes are shown directly under the composer.

## Source verification

- npm test: 124 files, 1,135 tests passed in the canonical run.
- npm run build passed. npm run format:check failed only on `scripts/probe-mince.mts`, an untracked local probe that is not part of the release; every tracked file passes `prettier --check`.
- npm run test:ui: 226 cases, 225 passed. The failure was `offer-planning.spec.ts`: with B4.2 a store that answers no row no longer ends planning. The saved list now carries the store error (`pricingError`) with the store-settings link; the spec was updated and passes. The related coordinator unit tests and composer tests (55) passed again after the fix, along with type checking, build and formatting.
- Focused checks recorded during implementation: salvage, fallback, partial pricing and partial edit units, a six-dish journey with additions, removal and a swap on both inference adapters, the 60-case acceptance corpus on both chains, and the affected desktop specs.

No owner ChatGPT request, live retailer account or private receipt was used. The owner's local operation metrics were read from a copy, numeric fields only.

## Package

electron-builder produced the NSIS installer from the release commit. Native ProductVersion is 0.11.2.0 and FileVersion is 0.11.2.

The short packaged smoke passed: launch and version 0.11.2, the packaged OCR import smoke (balanced total, saved provenance, zero AI requests and retailer writes), and two development-mode planning runs of "Nakkikeitto, kanapasta ja 2 l maitoa": a fixture reply gave two dishes and milk with seven rows; a refused reply gave the three requests as plain searches. Zero retailer writes. No packaged feature matrix or installer acceptance was run.

- Installer: Korikone-0.11.2-x64-setup.exe, 152605812 bytes.
- SHA-256: 397e273c82aac40e8f18ef592b71f5600670f902a4c5f3802a42c5cdad4053c6.
- Checksum asset: SHA256SUMS-0.11.2.txt.

## Remaining acceptance

A live check with ChatGPT is still needed for how often real replies are salvaged rather than repaired, how a 5–10 dish request feels end to end, and whether follow-up edits from the real model land as expected. One such request uses one to two ChatGPT calls; an edit uses one. A visual check of the dev window on the owner's PC was not done because computer-use access to the app was declined; the visual state was checked from automated screenshots instead. Clean-machine installation, signing and household pilot gates remain open in [pre-release scope](pre-release.md).
