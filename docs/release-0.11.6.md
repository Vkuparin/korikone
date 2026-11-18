# v0.11.6 release verification

Unsigned Windows x64 pre-release, 18 November 2026. [GitHub release](https://github.com/Vkuparin/korikone/releases/tag/v0.11.6) · [Release notes](../CHANGELOG.md)

## Changes since v0.11.5

- The list panel shows more groceries. Quick add is one line. "Tuotevalinnat", "Päivitä tuotteet ja hinnat", "Tallenna tekstinä" and "Tyhjennä lista" moved into the "⋯" menu. The footer keeps the total and the transfer button in view, with transfer details behind one disclosure. At 1366 × 768 at least three rows fit (B7.1).
- Adding one grocery by hand, changing an amount or changing "Tuotevalinnat" no longer re-reads the whole list. Only new or changed rows are searched, and the rest are matched again from products already read. "Päivitä tuotteet ja hinnat" still reads everything (B7.2).
- Quick add fills the amount and unit you last used for a grocery. When a row's unit doesn't fit the store's packs, one button takes one pack, for example "Ota 1 pakkaus: Maito 1 l · 1,19 €" (B7.3).
- Clicks stay quick on a long-used profile. A quantity change on a year-of-use test profile went from 46 ms to 20 ms (B7.4).
- Add a saved recipe to the list from Reseptit with "Lisää ostoslistalle". Recipes already on this week's list are marked "Listalla" (B7.5).
- Saved receipts are grouped by month, 10 at a time with "Näytä lisää". Backups sit above the receipt list in Settings (B7.6).
- A live store is named once, in the line above the list. The update notice moved to the sidebar (B7.7).
- The example list names its sample store and offers "Valitse oikea kauppa" instead of asking you to choose a store (B7.8).
- Picking more than 20 receipts explains the limit and offers "Tuo loput N". History no longer shows "Näytä historia" (B7.9).
- The spending chart's budget label no longer covers bars, and a legend explains the dashed transfer estimate (B7.10).
- Importing many receipts reads and writes the receipt ledger once per batch (B7.11).
- Settings > ChatGPT and AI has an "AI provider" choice: ChatGPT (default) or Claude through your own installed Claude Code. Korikone runs `claude -p` with no tools, MCP servers, settings or saved sessions, and never sees Claude credentials. Requests use your Claude plan's limits (C1.1).

## Checks

- `npm test`: 1179 of 1179 passed after one test fix. `tests/categories.test.ts` used a fake store without `setMany`, which the backup restore has needed since B5.8; the fake now has it.
- `npm run build` passed. `npm run format:check` passed for all tracked files.
- `npm run test:ui`: 219 passed and 37 failed on the first run. The same failing files were run on v0.11.5 to separate old failures from new ones.
- 22 fail on v0.11.5 as well and are not fixed in this release: `release-interface` (8 audits), `accessibility` (2), `appearance-contract`, `chain-identity`, `models`, `purchase-journey`, `receipt-ocr`, `receipt-review` (2), `settings.spec.ts` Advanced diagnostics, `shopping.spec.ts` validated preview and preview selection (en), and `grouped-review` (fi), which passed on a rerun.
- New failures, fixed before release:
  - In the list panel the quantity "+" overlapped the row's delete button (B7.1). The quantity control now sits under the price only. The overlap audit's checker also skips the visually hidden pack word and button total, the same as `.sr-only`.
  - At 800 × 600 a request's progress moved out of the composer to the page-wide fallback when the composer's actions ended a fraction of a pixel below the window. Visibility now allows one pixel of slack.
  - Row names in the list panel were 15 px, below the 16 px floor in `details.spec.ts`; back to 16 px. Three rows still fit at 1366 × 768.
  - `weighed-estimates.spec.ts` now opens the transfer details before looking for the weighed-price note, which B7.1 moved there.
- After the fixes, these passed: `operation-progress`, `planning-activity`, `shopping.spec.ts` update lifecycle (fi, en), `weighed-estimates`, `details`, `list-panel-compact`, `overlap-audit` (6 sizes), `grouped-review`, `resolver-settings` and `shopping.spec.ts` preview selection.
- Electron used temporary development data and local fixtures. No live AI or retailer requests were made.

## Owner checks

- **Claude provider on Windows.** Install Claude Code, choose Claude in Settings > ChatGPT and AI, press Connect Claude Code and sign in if a terminal opens. Then make one small list. Expected use: one Claude request on your Claude plan, no ChatGPT use. Not yet verified on Windows: finding `claude.exe`, the sign-in terminal and the desktop flow.
- **List panel layout.** Open your own list on your own screen. At least three rows should show with the transfer button in view, and the "⋯" menu should hold Tuotevalinnat and Tyhjennä lista.
- **One-row search on a live store.** With a real store selected, add one grocery by hand. Only that row should be searched, so it should take one row's search time instead of the whole list's. No AI request is needed.
- The live-store line above the list (B7.7), which tests cannot reach because test data forces development mode.

## Installer

- `Korikone-0.11.6-x64-setup.exe`, 152,625,209 bytes.
- SHA-256 `f3e9a03cc9f73e3d01bf38ede643cd955077dc92ebf377164d8a03b37a1b3472`.
- Checksum file `SHA256SUMS-0.11.6.txt`.
- The packaged app launched with temporary development data and reported v0.11.6. Clean-machine installation remains open.
