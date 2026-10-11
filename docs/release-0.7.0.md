# v0.7.0 release verification

Published on 12 October 2026 as an unsigned Windows x64 pre-release: [GitHub release](https://github.com/Vkuparin/korikone/releases/tag/v0.7.0). All 42 F4/F5/F15/F16 cards are integrated on main and included in tag v0.7.0. Source: ce435f19d621f4e562f8d2045972714ac661ab2a. Version manifests and executable report 0.7.0. Historical per-card checks and optional live limits remain in [the canonical task list](tasks/0.7.0.md).

## Source verification

The owner requested minimum release testing and trusted coder agents' focused checks. One canonical flow reused CI results and continued locally. No second full unit or desktop run was started after fixes.

- [CI 38175606384](https://github.com/Vkuparin/korikone/actions/runs/38175606384), candidate caa123034dfbfb74f3d8cc9acbc5eef8e4a46145: build passed; 574 of 575 unit tests passed. The one failure was an old pack-size test expecting confirmation to choose a product. The corrected focused case passed. [CI 38176422170](https://github.com/Vkuparin/korikone/actions/runs/38176422170) then passed the affected 14 persistence tests, build, formatting and four CI-policy fixtures; full suites were skipped.
- One full local desktop run: 104 tests, initially 83 passed and 21 failed. Passing checks were reused. All 21 failed cases subsequently passed in targeted runs. Failures included stale phase text/selection labels, unsupported synthetic quantities, changed transfer counts and a first Electron-download race. The eight failed FI/EN, Light/Dark, wide/narrow interface variants passed after shared test-contract corrections. This is combined full-flow and focused-rerun evidence, not a claim that the first full run passed.
- Two application fixes preserve unresolved matching explanations on quote restoration and route planShopping usage-limit/error messages to AI Settings. Affected quote fixtures: 12 passed, including the new restart regression; affected real IPC/SQLite desktop journeys passed.
- Build/typecheck and formatting passed. Changed-file formatting and diff checks passed after fixes. [Final fast CI 38177877895](https://github.com/Vkuparin/korikone/actions/runs/38177877895) is green for the tagged source: build/typecheck, format, scope fixtures and affected unit checks. Full unit and desktop suites were deliberately skipped.

Local logs are ignored under .runtime in the isolated release checkout: source-desktop.json/source-desktop.log record the initial run; targeted interface and failed-check logs record continuation. No profile or private source material is published.

## Package

The Windows x64 NSIS installer was rebuilt from verified output after the two application fixes, using electron-builder directly instead of repeating the source build/test flow. All eight dist files match app.asar. Both pinned retailer worker resources and notices are bundled. The executable reports ProductVersion 0.7.0.0 and FileVersion 0.7.0.

A small packaged smoke passed: launch/version, one explicit Nakkikeitto update, saved three-row basket and restart. It used an isolated forced-development profile, one fixture inference response and zero retailer writes. Restart preserved the list and made zero inference/catalogue reads. The comparison normalizes omitted undefined fields to persisted JSON. No packaged feature matrix, installer acceptance or live-account test was run.

- Asset: Korikone-0.7.0-x64-setup.exe, 135574091 bytes.
- SHA-256: 7e6654c3c411776158146e97c724bd770618e238bfd95e04e9d4bc84744e26a2.
- Checksum asset: SHA256SUMS-0.7.0.txt.

## Scope and remaining gates

The release adds validated category/qualifier matching, explicit Use once/Remember preferences, grouped review and row corrections, bounded optional candidate resolution, verified price/pack/weighed evidence, truthful provisional previews and atomic list retention. Shared inference contracts keep ChatGPT as the default and cover fake alternative providers. Live local/other providers remain later work. Ordinary prompts exclude raw receipt sources.

Installation and updates are manual; checkout/payment remain manual. Unknown prices and unsupported weighed goods stay unresolved for review. S-kaupat opens the Korikone account shopping list; its add-all action can reserve a pickup slot and stays manual. Clean-machine install, upgrade/uninstall, signing and household/live pilot gates remain open in [pre-release scope](pre-release.md). Earlier retailer acceptance is preserved in [v0.5.0 verification](release-0.5.0.md); it does not establish new v0.7 live behavior.

R1.1 is complete: automatic main/PR checks are fast, full/focused desktop runs are explicit, and docs/release branches/tags do not duplicate the full flow. Four policy fixtures and the observed final fast run establish the selected scopes. Explicit full CI dispatch was not run. All release validation used local fixtures, with zero live AI or retailer calls and no private receipt access/uploads.
