# v0.11.0 release verification

Published on 13 October 2026 as an unsigned Windows x64 pre-release: [GitHub release](https://github.com/Vkuparin/korikone/releases/tag/v0.11.0). Source tag v0.11.0: c8cc314ceb504303409cca8ed22538891b027fa5. All 19 Done cards in [the canonical task list](tasks/0.11.0.md) are integrated on main. Every recorded implementation commit was checked as an ancestor of main; stale unmerged statements were corrected while preserving coder checks and remaining owner gates.

## Source verification

The owner requested minimum testing and trusted the coder agents' focused evidence. One canonical local release flow ran on b5b8e70 with the 0.11.0 version bump. Passing evidence was reused; the full flow was not restarted after test or documentation corrections.

- npm run build: passed type checking and renderer/main compilation.
- npm run format:check: passed.
- npm test: 116 files and all 1,054 tests passed. Sandbox network restrictions initially stopped public worker preparation before tests began; the authorized run prepared the pinned assets and ran the suite once.
- npm run test:ui -- --workers=4 --reporter=list,json: 212 cases ran once; 210 passed and two matching cases failed. Focused reruns resolved both failures, with no passing matrix or full-suite restart.
- The sandbox initially blocked every Electron launch before application coverage. Those launch failures were rerun with permission for hidden fixture-only processes. The canonical application run and focused corrections used isolated development data.
- The two older matching checks were updated to submit through the enabled primary action and observe the real planning snapshot instead of relying on a keyboard submission and one viewport-dependent progress surface. Their failed-case reruns passed. No application code changed during release preparation.
- Fast CI: [38395096151](https://github.com/Vkuparin/korikone/actions/runs/38395096151) passed on the tagged source: build/type checking, formatting and scope-policy checks. Full unit/desktop suites were skipped and reused from the canonical local flow. The canonical full suites ran locally; CI does not repeat them.

No owner ChatGPT request, live retailer account or private receipt was used. Logs stay ignored under .runtime/v011 in the release checkout.

## Package

Both pinned retailer workers, license notices and checksum-verified Finnish OCR assets were prepared. electron-builder reused the verified build. All nine dist files match app.asar. Package/runtime version is 0.11.0; native ProductVersion is 0.11.0.0 and FileVersion is 0.11.0.

The short packaged smoke passed launch/version and one synthetic scanned-PDF import through the new multi-file intake API: durable local history, balanced total, saved OCR page provenance, zero AI requests and zero retailer writes. The smoke assertion was updated for the new reconciliation read model and only this check was rerun. No packaged feature matrix or installer acceptance was run.

- Installer: Korikone-0.11.0-x64-setup.exe, 152594216 bytes.
- SHA-256: f2e12afc5c5f6bebce1ada2cc910f038c8365ea92671f2343452618234828012.
- Checksum asset: SHA256SUMS-0.11.0.txt.

## Scope and remaining acceptance

History accepts several PDF/TXT/CSV receipts with one picker or drop action, per-file local saves, duplicate detection, compact summaries and failed-file retry. Routine import has no mandatory row approvals. PDF text and Finnish OCR stay local. Optional sanitized-label AI enrichment uses one consent-bound, provider-neutral request for the batch. The first-import invitation is nonblocking; permission remains configurable in Settings.

Readable names keep their evidence and printed fallback in history, memory and suggestions. Optional corrections take precedence without implicitly remembering a preference. The fixture audit produced 14 exact, three expanded and five raw names among 22 golden labels without a model; zero of 56 unsupported inventions were accepted. These counts do not establish real-receipt or live-model quality.

K-Ruoka non-food scope is selected-store discovery with name-evidenced variants, missing size/specification questions, truthful stock/price uncertainty and manual storefront handoff. Structured variants and automatic non-food basket writes are unsupported. Grocery transfers continue normally. Live catalogue acceptance remains open; fixtures do not prove the current retailer catalogue.

Remaining optional owner acceptance: visual receipt intake; real receipt/OCR quality; one consented live name-enrichment request; selected-store non-food searches. A valid receipt PDF mixing text and scanned pages lacks a complete intake integration fixture; the reader and failed-file isolation are covered separately. Ledger backup restore is covered by existing suites rather than repeated in the batch audit. These limitations are recorded, not claimed as completed acceptance. Images are not an intake format; optional retained source material is extracted text, not an archived PDF binary.

Export a backup before upgrading. Installation and updates, checkout/payment and S-kaupat's slot-reserving add-all action remain manual. Clean-machine installation, upgrade/uninstall, signing and household pilot gates remain open in [pre-release scope](pre-release.md).
