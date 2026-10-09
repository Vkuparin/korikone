# Korikone

A local Windows app that turns a shopping note into meals, groceries and a priced list.

The current source includes explicitly requested note interpretation, automatic product choices, editable shopping rows, recipes, an optional meal schedule, transfer history and PDF receipt import. It supports Finnish and English, two demo stores, and K-Ruoka and S-kaupat adapters. Checkout is always manual.

## Install the pre-release

Download the Windows x64 installer from [the v0.5.0 release](https://github.com/Vkuparin/korikone/releases/tag/v0.5.0). The installer is unsigned. Export a backup in Settings before upgrading an existing profile. See the [release notes](CHANGELOG.md), [v0.5.0 verification](docs/release-0.5.0.md) and [pre-release scope](docs/pre-release.md).

## Run from source

On Windows with Node.js 24 or newer:

```powershell
npm ci
npm run prepare:worker
npm run build
npm start
```

Use **Ota käyttöön** for guided store and ChatGPT connections, or **Kokeile esimerkkiä** to try the demo. Either connection can be skipped. Language selection stays available in the sidebar. Choose an AI model below the note or in Settings. Automatic prefers an available small model to reduce usage; names indicate size but do not establish exact prices. If no suitable small model is available, choose a model explicitly. Changing the preference saves it for future note and recipe requests without submitting anything. Retailer sign-in uses the embedded store tabs. Korikone never imports your usual browser cookies.

The store search includes both chains. Each retailer opens in the Kauppa view with its own persistent session. Sign in once in each tab. K-Ruoka uses the site's API in that session; S-kaupat uses the pinned v1.3.0 shared library with calls from the signed-in tab. Setup connects one chain. The hint under the shopping total leads to Settings to connect the second chain.

## Shopping and receipts

Write meals and groceries in one note. In the current source, press **Päivitä lista** / **Update list** or Ctrl+Enter to interpret it and select products. Typing leaves the saved meals, shopping rows and prices unchanged. A hint identifies note edits that have not been applied to the list. Adjust portions, mark items already at home, remove rows or choose alternatives. A normal transfer opens the verified retailer destination. Missing products, existing quantities and budget overruns show an exception panel before a write.

**Cancel list update** stops a pending interpretation and preserves the saved list. The typed note stays available. Press the update button or Ctrl+Enter to retry. Editing during an update discards its obsolete response without starting another request.

Returning to the shopping list or restarting restores compatible products, totals and the time labelled **Viimeksi haetut hinnat** / **Last quoted prices**, without requesting interpretation or catalogue data. Explicit list, product and store changes refresh prices. A list without a compatible quote shows **Ei hinnoiteltu** / **Not priced** and an explicit action to fetch products and prices. If an edit saves but pricing fails, the saved rows stay visible as unpriced with a retry action. Transfer review checks fresh retailer data before any write.

Import PDF, TXT or CSV receipts in settings. PDF text is extracted locally and can be edited before use in future ChatGPT suggestions. Scanned PDFs require OCR first. Copy or save the list for manual shopping; direct phone sync is not implemented.

## Build and check

Use **Settings > Development mode** for development and testing. It replaces ChatGPT and both retailer connections with local fixtures and saves planning data and transfer journals in a separate profile. The banner identifies the active mode. Switching back restores your live profile. Fixture sign-in never opens a browser or uses ChatGPT allowance.

For a forced development launch, set `KORIKONE_DEVELOPMENT=1` before `npm start`. `KORIKONE_DATA_DIR` selects an optional separate user-data directory. `KORIKONE_K_RUOKA=worker` uses the pinned k-ruoka-mcp worker instead of the K-Ruoka store tab. Automated Electron tests use a temporary `KORIKONE_TEST_DATA` directory, which forces development mode and rejects attempts to disable it. The setting is stored locally and is not changed by backup imports.

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
- Authorized live checks confirmed both embedded sessions after restart, small transfers and duplicate-safe reopening. They used zero ChatGPT requests. Fresh sign-in and expiry have fixture coverage and earlier owner observations.
- Korikone writes approved products to a shopping list called **Korikone** on the S-kaupat account; you then press *Lisää kaikki ostoskoriin* on the site and check out there. Korikone never uses s-kaupat-mcp's ordering or payment tools. The pinned adapter passes offline checks, and live acceptance confirmed the account list and retained quantities after restart. See [S-kaupat integration](docs/s-kaupat-mcp-plan.md).
- Weighted pricing and ambiguous pack sizes remain unresolved for both chains. Check dietary suitability, pack labels, fees and deposits in the retailer. The adapters cannot certify dietary suitability from catalogue data.
- ChatGPT uses the documented local-app authorization flow and Windows-protected credentials. The note input explains which data is sent. Earlier owner acceptance verified Automatic and explicit-model requests; current fixtures cover model selection and cancellation. The app retains one registration per app profile. Manual planning works without it.
- Catalogue quotes can differ from retailer basket prices; check the retailer's final total. Complete price handling is planned for v0.7.0 after the v0.6.0 design release; see the [roadmap](docs/roadmap.md).
- The installer is unsigned; clean-machine and household usability checks remain outstanding. Embedded tabs have fixture coverage for sign-in rejection, expiry and restart. Results and stable-release gates are listed in [v0.5.0 acceptance](docs/release-0.5.0.md).

See [dependency decisions](docs/dependency-decisions.md) for versions and evidence.

See [the pre-release scope](docs/pre-release.md), [design](docs/design.md) and [roadmap to 1.0.0](docs/roadmap.md).

Licensed under Apache-2.0. Copyright 2026 Vkuparin.

## Transfer flow

The pinned button shows the basket or list destination, product count and quoted total. One press approves the displayed batch, checks it, transfers it and opens the retailer destination after verification. Missing products, existing quantities and budget overruns require a decision; changed prices or packs require a refreshed quote. Reopening a verified batch never adds it again. If opening fails, use the open-only retry. S-kaupat still opens the Korikone account list; add it to the basket on the retailer site. Checkout and payment remain manual.
