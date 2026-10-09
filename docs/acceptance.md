# Prototype acceptance

Evidence recorded on 8 October 2026. Scope is defined in [prototype-scope.md](prototype-scope.md). This is not acceptance of the later two-retailer consumer release.

| Requirement | Evidence | Status |
| --- | --- | --- |
| Public repository and open-source license | Vkuparin/korikone, Apache-2.0, staged commits pushed to main | Done |
| Persistent recipes, portions, recurring items and weekly planning | Desktop form and restart tests; recurring-item editor | Done |
| Finnish default and runtime English | Desktop tests preserve an unsaved decimal-comma quantity and saved language across restart | Done |
| Two demo stores and reviewed cart changes | Desktop journey verifies matching, approval, interrupted transfer, reconciliation and restart | Done |
| Migration backup and local export/restore | SQLite test reads pre-migration WAL content from the backup; desktop test exports, restores and rejects broken recipe references | Done |
| Save failure handling | Tests keep saved state and approvals unchanged after failed writes; dead worker rejects subsequent requests | Done |
| Real K-Ruoka catalogue | Pinned worker smoke found a branch and normalized 20 pasta results | Done |
| Real K-Ruoka login | Owner selected Easton and reported successful sign-in verification | Done |
| Basket review details | Lines needing a decision come first; each shows the reason for its product, unit price, deposit, surplus and an "already have this" action; summary separates goods, known deposits and unknown fees. Service test covers omitting a line | Done (automated) |
| Reuse a week | "Start a new week" keeps up to 12 earlier plans; "Use last week" restores the latest with fresh meal IDs; purchase confirmation also saves the week. Service test covers reuse and duplicate suppression | Done (automated) |
| Staple reason | The shopping list shows when each regular item was last bought | Done |
| Store sign-out | S-kaupat settings offer "Sign out or switch account" (`log_out`); the pinned K-Ruoka worker has no sign-out tool | Done for S-kaupat; live check pending |
| Diagnostic export | Settings preview a report of counts, states and versions, then save it; a service test checks that recipes, products, account IDs and e-mail are absent | Done (automated) |
| Household exclusions as hard filters | Excluded words remove matching product names before ranking and acceptance; the basket shows how many were hidden. Ingredient and allergen data are not checked, as the app cannot certify suitability | Done (automated) |
| S-kaupat release adopted | s-kaupat-mcp v1.1.0 `.cjs` pinned by SHA-256; runtime checks version, tools and schema version; ordering tools excluded; reviews bound to the server's stable `accountId` | Done |
| S-kaupat adapter contract | Offline test runs the pinned release in demo mode: store search, login, stock-checked prices, reviewed transfer to the Korikone list and readback | Done |
| Real S-kaupat login, list transfer and site handoff | Requires the owner's login, a small observed transfer with exact before/after list quantities, and *Lisää kaikki ostoskoriin* from the `open_site` window | Pending |
| Real K-Ruoka cart mutation and browser handoff | Requires observed exact before/after quantities and the same authenticated cart in the checkout browser | Pending |
| ChatGPT sign-in and a meal draft | Owner reported successful sign-in and draft; desktop inspection later showed the connection retained after restart | Done |
| Automatic small-model selection | Live catalogue is refreshed for every request; offline test changes model names between requests | Live request pending |
| Guided first launch | Desktop test skips optional connections, reaches manual planning and retains setup completion after restart | Automated check done; connected path pending |
| Windows package | NSIS build succeeded; packaged executable passed the demo, recovery and restart journey | Done for the tested build |

The reported unexpected app exit during early store selection was not reproduced. Windows Application Error records inspected for Korikone/Electron did not identify a crash. The cause remains unresolved; desktop test windows have since been made hidden to avoid interrupting the user's session.


## Feedback-round implementation, 9 October 2026

The shopping workspace now follows the note/interpretation/list direction. Automated coverage includes multi-dish normalization, automatic product selection, home/removal/quantity behavior, stale drafts, partial transfer batches, and local PDF receipt extraction. Desktop checks cover setup, manual list editing, responsive layout, obsolete AI responses and cart recovery. See the current test results when assessing a particular build.

The original first-round failure was reported against a live ChatGPT request. Collision handling and one bounded validation retry address known rejection paths, but do not establish that every real multi-dish response succeeds. Repeat the original nakkikeitto/multiple-meal request with the owner's account.

Receipt PDFs with text are supported. Scanned/image-only PDFs produce a clear OCR-needed error. Live PDF receipt variety, default-browser retailer account continuity, the revised installer and real cart writes remain acceptance work; no real purchase was performed during implementation.

Live desktop work is paused while the owner uses the PC. No real cart transfer or purchase is claimed. Checkout remains manual. Clean-machine installation, signing, live S-kaupat acceptance and household usability sessions belong to the later release gates.

Final merged verification on 9 October 2026: production build, TypeScript and formatting checks passed; 53 unit tests passed, including the pinned S-kaupat v1.1.0 contract, receipt PDFs, exclusion filtering and history-write concurrency. All eight desktop tests passed across the final verification runs; setup and shopping/PDF tests were rerun after resolving the integration overlap. Desktop and narrow-window screenshots were inspected. No live-account cart mutation or purchase was performed.
