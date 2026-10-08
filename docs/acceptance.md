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
| S-kaupat release adopted | s-kaupat-mcp v1.0.0 `.cjs` pinned by SHA-256; runtime checks version, tools and schema version; ordering tools excluded | Done |
| S-kaupat adapter contract | Offline test runs the pinned release in demo mode: store search, login, stock-checked prices, reviewed transfer to the Korikone list and readback | Done |
| Real S-kaupat login, list transfer and site handoff | Requires the owner's login, a small observed transfer with exact before/after list quantities, and *Lisää kaikki ostoskoriin* from the `open_site` window | Pending |
| Real K-Ruoka cart mutation and browser handoff | Requires observed exact before/after quantities and the same authenticated cart in the checkout browser | Pending |
| ChatGPT sign-in and a meal draft | Owner reported successful sign-in and draft; desktop inspection later showed the connection retained after restart | Done |
| Automatic small-model selection | Live catalogue is refreshed for every request; offline test changes model names between requests | Live request pending |
| Guided first launch | Desktop test skips optional connections, reaches manual planning and retains setup completion after restart | Automated check done; connected path pending |
| Windows package | NSIS build succeeded; packaged executable passed the demo, recovery and restart journey | Done for the tested build |

The reported unexpected app exit during early store selection was not reproduced. Windows Application Error records inspected for Korikone/Electron did not identify a crash. The cause remains unresolved; desktop test windows have since been made hidden to avoid interrupting the user's session.

Live desktop work is paused while the owner uses the PC. No real cart transfer or purchase is claimed. Checkout remains manual. Clean-machine installation, signing, live S-kaupat acceptance and household usability sessions belong to the later release gates.
