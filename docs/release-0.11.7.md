# v0.11.7 release verification

Unsigned Windows x64 pre-release, 19 November 2026. [GitHub release](https://github.com/Vkuparin/korikone/releases/tag/v0.11.7) · [Release notes](../CHANGELOG.md)

## Changes since v0.11.6

- The grocery name field in quick add is 16 px again. It had inherited the 14 px of the amount and unit fields, which put it below the interface audit's floor for typed text.
- The UI tests that already failed at v0.11.5 and v0.11.6 now match the current views. Receipt cards open before their rows are read, the diagnostics report is saved through its preview in Settings, the accessibility audit waits for store search, and the model and repeat-list tests follow the current behavior. Tests wait for the app page to load before they reload it, which removes the intermittent `ERR_ABORTED` failures.

No other application behavior changed.

## Checks

- The 13 affected or nearby UI test files passed on one build of this source, 54 of 54: `accessibility`, `appearance-contract`, `chain-identity`, `models`, `purchase-journey`, `receipt-ocr`, `receipt-review`, `release-interface`, `settings`, `shopping`, `list-panel-compact`, `quick-add-pack` and `repeat-list`.
- The v0.11.6 unit, build and format results are reused, since only one style rule and test files changed. Electron used temporary development data and local fixtures. No live AI or retailer requests were made.
- The packaged app launched with temporary development data and reported v0.11.7.

## Owner checks

The v0.11.6 owner checks are still open: the Claude provider on Windows, the list panel on your own screen, and one-row search on a live store. See [v0.11.6](release-0.11.6.md#owner-checks).

## Installer

- `Korikone-0.11.7-x64-setup.exe`, 152,625,367 bytes.
- SHA-256 `8309fdd6babfcbb75befd9c53e128c04728e083760b4ee6c011b7207036f8b8d`.
- Checksum file `SHA256SUMS-0.11.7.txt`.
