# Korikone

A local Windows app that turns a shopping note into meals, groceries and a priced list.

The pre-release includes automatic note interpretation and product choices, editable shopping rows, recipes, an optional meal schedule, transfer history and PDF receipt import. It supports Finnish and English, two demo stores, and K-Ruoka and S-kaupat adapters. Checkout is always manual.

## Install the pre-release

Download the Windows x64 installer from [GitHub Releases](https://github.com/Vkuparin/korikone/releases). The current version is **0.2.0-alpha.2**, intended for early testing. The installer is unsigned. Export a backup in Settings before upgrading an existing profile. See the [release notes](CHANGELOG.md) and [pre-release scope](docs/pre-release.md).

## Run from source

On Windows with Node.js 24 or newer:

```powershell
npm ci
npm run prepare:worker
npm run build
npm start
```

Use **Ota käyttöön** for guided store and ChatGPT connections, or **Kokeile esimerkkiä** to try the demo. Either connection can be skipped. Language selection stays available in the sidebar. ChatGPT model selection is automatic, preferring a small model from the current account catalogue. The K-Ruoka adapter uses installed Google Chrome with its own profile; it never imports your usual browser cookies.

The store search includes both chains. S-kaupat uses the pinned v1.2.0 worker with its own Edge or Chrome profile and authenticated site handoff.

## Shopping and receipts

Write meals and groceries in one note. After a short pause, Korikone interprets it and selects products. Ctrl+Enter updates immediately. Adjust portions, mark items already at home, remove rows or choose alternatives. Transfer opens a summary of actual cart changes, including any unresolved items excluded from the batch.

In the current source build, **Cancel list update** stops a pending interpretation and preserves the saved list. The typed note stays available. Press Ctrl+Enter or the arrow to retry it explicitly.

Import PDF, TXT or CSV receipts in settings. PDF text is extracted locally and can be edited before use in future ChatGPT suggestions. Scanned PDFs require OCR first. Copy or save the list for manual shopping; direct phone sync is not implemented.

## Build and check

Use **Settings > Development mode** for development and testing. It replaces ChatGPT and both retailer connections with local fixtures and saves planning data and transfer journals in a separate profile. The banner identifies the active mode. Switching back restores your live profile. Fixture sign-in never opens a browser or uses ChatGPT allowance.

For a forced development launch, set `KORIKONE_DEVELOPMENT=1` before `npm start`. `KORIKONE_DATA_DIR` selects an optional separate user-data directory. Automated Electron tests use a temporary `KORIKONE_TEST_DATA` directory, which forces development mode and rejects attempts to disable it. The setting is stored locally and is not changed by backup imports.

AI fixtures recognize pasta, soup/keitto, porridge/puuro, coffee/kahvi and frozen pizza/pakastepizza. Other notes return a pasta example; fixtures do not provide general language understanding. Settings includes success, delayed success, invalid JSON (once or always), usage-limit, incomplete-response and AI-failure scenarios. The basket's demo controls exercise price changes and interrupted transfers. Receipt parsing, file exports, backups, diagnostics and clipboard actions stay local and use the real app code.

Run fixture checks first. Request live acceptance testing only when the feature is finished and its offline checks pass. Live ChatGPT requests require the user's explicit request. See [fixture coverage](docs/testing.md) and [agent instructions](AGENTS.md).

```powershell
npm test
npm run test:ui
npm run format:check
npm run package
```

`npm test` also downloads the pinned S-kaupat component and runs it offline in its demo mode. The unsigned Windows installer is written to `release/`. Worker downloads are version-pinned and checked against their SHA-256. Recipes, SQLite data and encrypted ChatGPT credentials live under the application's local user-data directory, outside this repository.

## Current status and limits

- Korikone is an alpha pre-release for early testing. Remaining release gates are listed in [acceptance](docs/acceptance.md).
- K-Ruoka live catalogue reads passed, and the owner confirmed login. Cart writes and default-browser account continuity still need observed acceptance testing.
- S-kaupat has no online cart that apps can fill. Korikone writes approved products to a shopping list called **Korikone** on the S-kaupat account; you then press *Lisää kaikki ostoskoriin* on the site and check out there. Korikone never uses s-kaupat-mcp's ordering or payment tools. The S-kaupat adapter passes offline tests against the pinned release; Live login and a three-product list transfer were verified on 9 October 2026. The opened site was signed out; sign in there to use the list. Authenticated handoff remains open in [#3](https://github.com/Vkuparin/korikone/issues/3). See [S-kaupat integration](docs/s-kaupat-mcp-plan.md).
- Weighted pricing and ambiguous pack sizes remain unresolved for both chains. Check dietary suitability, pack labels, fees and deposits in the retailer. The adapters cannot certify dietary suitability from catalogue data.
- ChatGPT uses the documented local-app authorization flow and Windows-protected credentials. The note input explains which data is sent. The owner confirmed sign-in and a meal draft. Automatic model selection has offline coverage; its live check remains outstanding. The app retains one registration per app profile. Manual planning works without it.
- The installer is unsigned; clean-machine and household usability checks remain outstanding.

See [dependency decisions](docs/dependency-decisions.md) for versions and evidence.

See [the pre-release scope](docs/pre-release.md), [design](docs/design.md) and [implementation plan](docs/implementation-plan.md).

Licensed under Apache-2.0. Copyright 2026 Vkuparin.
