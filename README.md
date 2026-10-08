# Korikone

A local Windows desktop application for planning meals and reviewing grocery baskets.

Korikone is moving from a prototype to the real product. It has editable recipes, weekly planning, Finnish and English, two demo stores, and live adapters for both chains: K-Ruoka through `k-ruoka-mcp` and S-kaupat through the released [s-kaupat-mcp](https://github.com/Vkuparin/s-kaupat-mcp) (pinned to v1.1.0). Checkout is always manual.

## Run from source

On Windows with Node.js 24 or newer:

```powershell
npm ci
npm run prepare:worker
npm run build
npm start
```

`prepare:worker` downloads the pinned store components and checks their SHA-256 checksums.

Use **Ota käyttöön** for guided store and ChatGPT connections, or **Kokeile esimerkkiä** to try the demo. Either connection can be skipped. The store search finds both K-Ruoka and S-kaupat stores. Language selection is in the header. ChatGPT model selection is automatic, preferring a small model from the current account catalogue; overrides are under advanced settings.

The K-Ruoka adapter uses installed Google Chrome with its own profile. The S-kaupat adapter uses Microsoft Edge (or Chrome) through its own small, minimised window and profile. Neither imports your usual browser cookies.

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
- K-Ruoka live catalogue reads passed, and the owner confirmed login. Cart writes and same-profile checkout handoff still need observed acceptance testing.
- S-kaupat has no online cart that apps can fill. Korikone writes approved products to a shopping list called **Korikone** on the S-kaupat account; you then press *Lisää kaikki ostoskoriin* on the site and check out there. Korikone never uses s-kaupat-mcp's ordering or payment tools. The S-kaupat adapter passes offline tests against the pinned release; live login, list transfer and handoff in Korikone still need observed acceptance. See [S-kaupat integration](docs/s-kaupat-mcp-plan.md).
- Weighted pricing and ambiguous pack sizes remain unresolved for both chains. Check dietary suitability, pack labels, fees and deposits in the retailer. The adapters cannot certify dietary suitability from catalogue data.
- ChatGPT uses the documented local-app authorization flow and Windows-protected credentials. The draft action explains which data is sent. The owner confirmed sign-in and a meal draft. Automatic model selection has offline coverage; its live check remains outstanding. The app retains one registration per app profile. Manual planning works without it.
- The installer is unsigned; clean-machine and household usability checks remain outstanding.

See [dependency decisions](docs/dependency-decisions.md) for versions and evidence.

See [the product scope](docs/prototype-scope.md), [design](docs/design.md) and [implementation plan](docs/implementation-plan.md).

Licensed under Apache-2.0. Copyright 2026 Vkuparin.
