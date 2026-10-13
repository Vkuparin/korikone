# v0.10.0 release verification

Published on 13 October 2026 as an unsigned Windows x64 pre-release: [GitHub release](https://github.com/Vkuparin/korikone/releases/tag/v0.10.0). Source tag v0.10.0 points to ac6fa5e62f6578c38b62d58757a81cee75977903. All 36 Done cards in [the canonical task list](tasks/0.10.0.md) are integrated on main and included. Original branch/integration notes remain completion-time evidence; this release inclusion supersedes their unmerged/unreleased wording.

## Source verification

The owner requested minimum testing and trusted the coder agents' focused checks. One canonical local release flow ran on f6a8caa with the 0.10.0 version bump. Passing evidence was reused after corrections; the full flow was not restarted.

- npm run build: passed type checking and renderer/main compilation.
- npm run format:check: passed.
- npm test: 102 files and 979 tests ran once; 975 passed and four failed. The failures were stale expectations for ordinary/weighed onion selection and successful offer fixtures. Current expected products and evaluation counts were updated separately from the immutable released audit data. The three affected files passed all 55 tests.
- npm run test:ui -- --workers=4 --reporter=list,json: 196 cases ran once; 161 passed and 35 failed. Old expectations required unresolved onions, mandatory transfer confirmation, pre-reset list retention, older cancellation wording or unscoped controls on pages that now retain the hidden Shopping workspace. Fixture updates preserve optional Use once versus Remember, unresolved omissions, opt-in confirmation/budget guards, cancellation, restart and real IPC paths.
- Only failed desktop cases were rerun: 35 cases (19 passed), the remaining 16 (nine passed), the remaining seven (four passed), and the final three (all passed). Every original failed case now has a passing result. No passing matrix or full suite was restarted.
- Two English layout cases found a completed-operation message intercepting transfer-button clicks. The informational `.operation-finished` surface now ignores pointer events. Both affected layouts passed after that CSS correction. Build/type checking was refreshed for the changed renderer; changed-file formatting and diff checks passed.
- [Fast CI 38363316473](https://github.com/Vkuparin/korikone/actions/runs/38363316473) passed for the tagged source using the normal fast scope (build/type checking, formatting, scope-policy fixtures and affected unit checks). The canonical full suites ran locally; CI does not repeat them.

All automated paths used isolated development fixtures. No owner ChatGPT request, live retailer account or private receipt was used. Logs and reports stay ignored under `.runtime/v010` in the release checkout.

## Package

Both pinned retailer workers, license notices and checksum-verified Finnish OCR assets were prepared. electron-builder reused the verified build. The installer was refreshed after the CSS correction; all nine final dist files match app.asar. Package/runtime version is 0.10.0; native ProductVersion is 0.10.0.0 and FileVersion is 0.10.0. The archive inspection uses native Windows path separators.

The short packaged smoke passed launch/version and one synthetic scanned-PDF import through real receipt IPC: local Finnish OCR, balanced total, stored page provenance, zero AI requests and zero retailer writes. The same short smoke passed on the refreshed package. No packaged feature matrix or installer acceptance was run.

- Installer: Korikone-0.10.0-x64-setup.exe, 152576386 bytes.
- SHA-256: faa575eea94de128e35fbc820233ce9e9cd67f8316a7a7c192aa9332bb57b56e.
- Checksum asset: SHA256SUMS-0.10.0.txt.

## Scope and remaining acceptance

Vague dish requests produce simple meal proposals with sides and selected-store products. Assumed sides and quantities can be inspected and changed. Ordinary onion, frozen-pizza and stock-cube matching and targeted product recovery are improved. The primary AI action and animated progress use one visible status/Cancel surface; startup is quiet and the date is information.

Normal transfers send and open the destination in one action, with visible counts, omitted rows and budget information. Review before transfer is opt-in. Verified reads are reused within the action; required account/context/stock and transfer-recovery checks remain. Store Back explains missing page history; comparison totals state comparable-row coverage.

New list confirms once and resets the whole current Shopping workspace. Stores offers unit price (default) or enough-pack total cost for initial selection and alternatives, with payable totals shown separately. Store connection cards and connected ChatGPT status are clearer. Calendar/week copy, explicit ideas from supported offers and offline Finnish OCR are included.

Owner acceptance remains separate: live vague-note/product-match quality, targeted edits and small transfers at both chains, current embedded K-Ruoka offer-source shape, and visual/real-receipt review. These were not performed by release validation and do not block this owner-authorized pre-release. Unsupported offer sources remain distinct from empty results; personal conditions are not a guaranteed basket discount. OCR and optional sanitized-label AI enrichment can require correction. The current receipt-review interface remains; frictionless intake and improved naming are planned for v0.11.0.

Export a backup before upgrading. Installation and updates, checkout/payment and S-kaupat's slot-reserving add-all action remain manual. Clean-machine install, upgrade/uninstall, signing and household pilot gates remain open in [pre-release scope](pre-release.md).
