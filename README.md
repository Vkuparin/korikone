# Korikone

A local Windows app that turns a shopping note into meals, groceries and a priced list.

The prototype includes automatic note interpretation and product choices, editable shopping rows, recipes, an optional meal schedule, transfer history and PDF receipt import. It supports Finnish and English, two demo stores, and K-Ruoka and S-kaupat adapters. Checkout is always manual.

## Run from source

On Windows with Node.js 24 or newer:

```powershell
npm ci
npm run prepare:worker
npm run build
npm start
```

Use **Ota käyttöön** for guided store and ChatGPT connections, or **Kokeile esimerkkiä** to try the demo. Either connection can be skipped. Language selection stays available in the sidebar. ChatGPT model selection is automatic, preferring a small model from the current account catalogue. The K-Ruoka adapter uses installed Google Chrome with its own profile; it never imports your usual browser cookies.

The store search includes both chains. S-kaupat uses the pinned v1.1.0 worker with its own Edge or Chrome profile and authenticated site handoff.

## Shopping and receipts

Write meals and groceries in one note. After a short pause, Korikone interprets it and selects products. Ctrl+Enter updates immediately. Adjust portions, mark items already at home, remove rows or choose alternatives. Transfer opens a summary of actual cart changes, including any unresolved items excluded from the batch.

Import PDF, TXT or CSV receipts in settings. PDF text is extracted locally and can be edited before use in future ChatGPT suggestions. Scanned PDFs require OCR first. Copy or save the list for manual shopping; direct phone sync is not implemented.

## Build and check

```powershell
npm test
npm run test:ui
npm run format:check
npm run package
```

`npm test` also downloads the pinned S-kaupat component and runs it offline in its demo mode. The unsigned Windows installer is written to `release/`. Worker downloads are version-pinned and checked against their SHA-256. Recipes, SQLite data and encrypted ChatGPT credentials live under the application's local user-data directory, outside this repository.

## Current status and limits

- Korikone is a product in progress, not yet the two-retailer consumer release. Remaining release gates are listed in [acceptance](docs/acceptance.md).
- K-Ruoka live catalogue reads passed, and the owner confirmed login. Cart writes and default-browser account continuity still need observed acceptance testing.
- S-kaupat has no online cart that apps can fill. Korikone writes approved products to a shopping list called **Korikone** on the S-kaupat account; you then press *Lisää kaikki ostoskoriin* on the site and check out there. Korikone never uses s-kaupat-mcp's ordering or payment tools. The S-kaupat adapter passes offline tests against the pinned release; live login, list transfer and handoff in Korikone still need observed acceptance. See [S-kaupat integration](docs/s-kaupat-mcp-plan.md).
- Weighted pricing and ambiguous pack sizes remain unresolved for both chains. Check dietary suitability, pack labels, fees and deposits in the retailer. The adapters cannot certify dietary suitability from catalogue data.
- ChatGPT uses the documented local-app authorization flow and Windows-protected credentials. The note input explains which data is sent. The owner confirmed sign-in and a meal draft. Automatic model selection has offline coverage; its live check remains outstanding. The app retains one registration per app profile. Manual planning works without it.
- The installer is unsigned; clean-machine and household usability checks remain outstanding.

See [dependency decisions](docs/dependency-decisions.md) for versions and evidence.

See [the product scope](docs/prototype-scope.md), [design](docs/design.md) and [implementation plan](docs/implementation-plan.md).

Licensed under Apache-2.0. Copyright 2026 Vkuparin.
