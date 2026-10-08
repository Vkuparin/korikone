# Korikone

A local Windows desktop application for planning meals and reviewing grocery baskets.

The prototype includes editable recipes, weekly planning, Finnish and English, two demo stores, and a K-Ruoka adapter. S-kaupat integration is developed separately. Checkout is always manual.

## Run from source

On Windows with Node.js 24 or newer:

```powershell
npm ci
npm run prepare:worker
npm run build
npm start
```

Use **Ota käyttöön** for guided store and ChatGPT connections, or **Kokeile esimerkkiä** to try the demo. Either connection can be skipped. Language selection is in the header. ChatGPT model selection is automatic, preferring a small model from the current account catalogue; overrides are under advanced settings. The K-Ruoka adapter uses installed Google Chrome with its own profile; it never imports your usual browser cookies.

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
- K-Ruoka live catalogue reads passed, and the owner confirmed login. Cart writes and same-profile checkout handoff still need observed acceptance testing.
- K-Ruoka weighted pricing and ambiguous pack sizes remain unresolved. Check dietary suitability, pack labels, fees and deposits in the retailer. The adapter cannot certify dietary suitability from its catalogue data.
- ChatGPT uses the documented local-app authorization flow and Windows-protected credentials. The draft action explains which data is sent. The owner confirmed sign-in and a meal draft. Automatic model selection has offline coverage; its live check remains outstanding. The prototype retains one registration per app profile. Manual planning works without it.
- The installer is unsigned; clean-machine and household usability checks remain outstanding.

See [dependency decisions](docs/dependency-decisions.md) for versions and evidence.

See [the prototype scope](docs/prototype-scope.md) and [implementation plan](docs/implementation-plan.md).

Licensed under Apache-2.0. Copyright 2026 Vkuparin.
