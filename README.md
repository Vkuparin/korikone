# Korikone

A local Windows app that turns a shopping note into meals, groceries and a priced list.

The prototype includes automatic note interpretation and product choices, editable shopping rows, recipes, an optional meal schedule, transfer history and PDF receipt import. It supports Finnish and English, two demo stores, and a K-Ruoka adapter. S-kaupat integration is developed separately. Checkout is always manual.

## Run from source

On Windows with Node.js 24 or newer:

```powershell
npm ci
npm run prepare:worker
npm run build
npm start
```

Use **Ota käyttöön** for guided store and ChatGPT connections, or **Kokeile esimerkkiä** to try the demo. Either connection can be skipped. Language selection stays available in the sidebar. ChatGPT model selection is automatic, preferring a small model from the current account catalogue. The K-Ruoka adapter uses installed Google Chrome with its own profile; it never imports your usual browser cookies.

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

The unsigned Windows installer is written to `release/`. The worker download is version-pinned and checked against its SHA-256. Recipes, SQLite data and encrypted ChatGPT credentials live under the application's local user-data directory, outside this repository.

## Current limits

- This is a prototype, not the two-retailer consumer release.
- K-Ruoka live catalogue reads passed, and the owner confirmed login. Cart writes and default-browser account continuity still need observed acceptance testing. The default browser may require signing into the same retailer account.
- K-Ruoka weighted pricing and ambiguous pack sizes remain unresolved. Check dietary suitability, pack labels, fees and deposits in the retailer. The adapter cannot certify dietary suitability from its catalogue data.
- ChatGPT uses the documented local-app authorization flow and Windows-protected credentials. The note input explains which data is sent. The owner confirmed sign-in and a meal draft. Automatic model selection has offline coverage; its live check remains outstanding. The prototype retains one registration per app profile. Manual planning works without it.
- The installer is unsigned; clean-machine and household usability checks remain outstanding.

See [dependency decisions](docs/dependency-decisions.md) for versions and evidence.

See [the prototype scope](docs/prototype-scope.md) and [implementation plan](docs/implementation-plan.md).

Licensed under Apache-2.0. Copyright 2026 Vkuparin.
