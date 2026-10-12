# v0.9.0 release verification

Published on 12 October 2026 as an unsigned Windows x64 pre-release: [GitHub release](https://github.com/Vkuparin/korikone/releases/tag/v0.9.0). Source tag v0.9.0 points to 28bb7a2b016b739f10f896fa89912e580e56f65b. All 51 Done cards are integrated on main and included; the original per-card branch/integration notes are completion-time evidence superseded by this release inclusion. See [the canonical task list](tasks/0.9.0.md).

## Source verification

The owner requested minimum testing and trusted the coder agents' focused evidence. One canonical local release flow ran on c0770b3. It was not repeated after corrections or publication.

- npm run build: passed type checking and renderer/main compilation.
- npm run format:check: passed.
- npm test: 84 files, 778 tests passed.
- npm run test:ui -- --workers=4 --reporter=list,json: 158 tests ran once; 152 passed and six failed. Five failures were outdated/ambiguous selectors or timing assumptions: alternatives now collapse, a product label also appeared in open details, Undo completion needed a wait, and the FI/EN cancellation checks needed the existing pending fixture rather than a reply that completed mid-interaction.
- A seven-case failed/affected rerun passed six and confirmed the remaining at-home pointer bug. A focused diagnostic showed its click landing on the row background when hover help reflowed the list. In 28bb7a2, hover/focus help moves outside row flow; selected-state help remains inline. Three affected checks passed: pointer bounds/click, retained removal/prices and restart, plus FI/EN help/Settings access.
- The source build was refreshed for that CSS change, and changed-file formatting/diff checks passed. No full unit or desktop flow was restarted. Passing unit and unaffected desktop evidence remains applicable. Every original failed case has a passing focused result.
- [Fast CI 38283113169](https://github.com/Vkuparin/korikone/actions/runs/38283113169) is green for the tagged source. It checks build/type checking, formatting and scope fixtures; the full suites are intentionally skipped because the canonical flow ran locally. Earlier [coder integration CI](https://github.com/Vkuparin/korikone/actions/runs/38280346182) is also green.

The shutdown fix aaedc07 and its five source/test files were already present unchanged on main via 20565df, despite aaedc07 not being an ancestor. The real committing-event quit/restart case passed in the canonical desktop flow. The release preserves a locked atomic commit and drains queued IPC before closing SQLite.

Logs, reports and sanitized smoke files are ignored under .runtime/v090 in the isolated release checkout. No owner account, live AI request, live retailer read/write or private receipt was used. Documentation and tag publication start no additional full flow.

## Package

Pinned retailer workers and notices were prepared. electron-builder reused the verified build to create the Windows x64 NSIS installer; all 8 dist files match app.asar. Package/runtime version is 0.9.0; native ProductVersion is 0.9.0.0 and FileVersion is 0.9.0. The initial archive comparison used non-native path separators; correcting that verification helper required no app change or repackaging.

One short packaged smoke passed: launch/version, an existing synthetic text-layer PDF through the real Settings import button and local reader, one structured purchase with a matching printed 7.47 EUR total, unchanged shopping plan, and persistence after restart. AI, catalogue and retailer-write counts stayed zero. No packaged feature matrix or installer acceptance was run.

- Installer: Korikone-0.9.0-x64-setup.exe, 135651271 bytes.
- SHA-256: 7203b5f5286908e8db59a9301d5683532148c26d3ce57ab3767bcc639bc8c38c.
- Checksum asset: SHA256SUMS-0.9.0.txt.

## Scope and remaining acceptance

Receipts and supported completed S-kaupat orders feed one local purchase ledger with printed facts, reconciliation, duplicate handling, source linking and grouped correction/review. Optional sanitized-label enrichment requires consent and uses at most one provider-neutral AI call per explicit action. Purchase observations support recurring suggestions and actual-spending history; transfers alone are not purchases and observations never become saved preferences without explicit consent. Repeat shopping reuses requirements and refreshes selected-store prices without AI generation.

B1 fixes include receipt-text save feedback, explicit first price search, local row/meal removal and Clear list with Undo, inline household sizing/scaling, contextual meal-and-grocery updates and Finnish quantity words, useful stage/error feedback, chicken-strip synonyms, alternatives closing after a successful choice, house-icon help, shorter composer copy, language consistency, audited spacing and shutdown safety.

Owner checks remain separate: real receipts from both chains locally, a live S-kaupat completed-order read/source link, optional enrichment (at most one request per receipt), the reported mixed prompt on an existing list (one interpretation request) and on New list (one or two with repair), live chicken-strip retrieval at both chains, and visual review of the new controls. These were not performed by release validation and do not block this owner-authorized pre-release. Earlier phone QR and live/store acceptance remains as recorded in prior verification files.

Textless/scanned receipts still need external OCR; unknown formats/facts remain unresolved rather than guessed. ChatGPT remains the default provider; local runners and mobile sync remain later. Clean-machine install, upgrade/uninstall, signing and household pilot gates stay open in [pre-release scope](pre-release.md). Export a backup before upgrading. Installation/updates, checkout/payment and S-kaupat's slot-reserving add-all action stay manual.
