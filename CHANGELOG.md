# Release notes

## Unreleased

- The total and the transfer button, which now shows the total, stay at the bottom of the shopping list while the list scrolls on its own. The list notes, fee and export buttons sit above them.
- *Vertaa kauppoja* moved into the pinned bar. After a comparison the bar shows the result, for example "K-Ruoka 2,10 € halvempi · Vertaa", which opens the full comparison until the list changes.
- Both chains can stay signed in. Settings lists K-Ruoka and S-kaupat with their own store, sign-in and *Use this store*; switching chains keeps the other chain's store and login. Setup offers the other chain after the first sign-in.
- *Compare stores* under the list total prices the same list at the other chain without touching either cart, the saved list or a pending transfer. It shows the total for the items priced at both, all priced items with the missing count, known deposits and the three largest differences, and can switch to the other chain. Delivery fees are not included.
- S-kaupat pickup fees: the list total shows the store's pickup fee range, which depends on the pickup time, and the comparison has a pickup fee row. Korikone reads it with s-kaupat-mcp's read-only `get_delivery_options`, without choosing a time. Home delivery fees and all K-Ruoka fees stay "not known"; home delivery would need your address, which Korikone does not ask for.
- S-kaupat sign-in now counts only after the store's login window has completed in Korikone's own data folder. Korikone now pins s-kaupat-mcp 1.2.0 and keeps its S-kaupat login for its own data folder (`SKAUPAT_LOGIN_SCOPE=data-dir`), so *Open store cart* opens the same signed-in window and signing in or out in Korikone no longer touches other apps on the PC. Existing users are asked to sign in once more. Confirmed by the owner on a live account ([#3](https://github.com/Vkuparin/korikone/issues/3)).
- Added the live acceptance note (makaronilaatikko) as a fixture, with the look-alike products a store search returns: garlic for onion, lemon pepper for black pepper, chicken mince, a ready meal and M10 egg packs. Development-mode checks cover product choice, Finnish units, tidied names and the account name in cart review.

## 0.2.0-alpha.3 — 9 October 2026

- Cancel a pending note interpretation beside the input. Cancellation preserves the saved list and typed note, invalidates pending drafts, and suppresses automatic resubmission.
- Added the original nakkikeitto/kanapasta/ready-food/breakfast/treats fixture and regression checks for debounce, request counts, cancellation, usage failures and explicit retry.
- Updated the implementation plan and acceptance preparation for the published alpha.2 release. Live model and retailer acceptance remain separate.
- Expanded synthetic PDF checks for Finnish characters, euro signs, fonts, page order and extraction limits.
- Agent instructions use focused feature checks during implementation and reserve full suites for release preparation.

The installer remains unsigned; the earlier pre-release limitations still apply. This release does not include the S-kaupat sign-in change for [#3](https://github.com/Vkuparin/korikone/issues/3), which awaits a live check.

Verification: build, formatting, 63 unit tests and 11 source desktop tests passed. Five packaged-app checks passed: backup export and restore, development-mode setup and transfers, mode persistence, transfer recovery and restart, and PDF receipt import. These checks used local fixtures without live ChatGPT requests.

## 0.2.0-alpha.2 — 9 October 2026

- Settings development mode uses local AI and retailer fixtures with a separate saved profile. Automated Electron tests force this mode and cannot disable it.
- Added AI success, delayed-response, validation-retry and failure fixtures. Setup and stale-note UI tests now use real application handlers.
- Agent instructions require fixture testing for development and an explicit user request for live ChatGPT tests.
- Pending operations preserve the selected UI language when returning an older snapshot.

Development mode can be enabled in Settings. Switching modes opens a separate saved profile. Existing live data and ChatGPT credentials are preserved. The installer remains unsigned; the earlier pre-release limitations still apply.

Verification: build, formatting, 60 unit tests and 10 source desktop tests passed. Four packaged-app checks passed: development-mode setup and transfers, mode persistence, transfer recovery and restart, and PDF receipt import. These checks used local fixtures without live ChatGPT requests.

## 0.2.0-alpha.1 — 9 October 2026

First Windows pre-release for early testing, following the prototype feedback round.

- Note-driven meals and groceries, automatic product choices, editable quantities, home markers and alternatives.
- Optional meal schedule, reusable lists, receipt context and local PDF/TXT/CSV import.
- Reviewed K-Ruoka cart transfers and S-kaupat account-list transfers using pinned workers, with interrupted-transfer recovery.
- More precise ingredient matching, account display names and corrected Finnish unit labels.
- Local backups, redacted diagnostic export, optional ChatGPT setup and Finnish/English support.

### Install and upgrade

Download `Korikone-0.2.0-alpha.1-x64-setup.exe` from this release and run it on Windows x64. The installer is unsigned. Existing users should export a backup in Settings before upgrading. The application ID and data location are unchanged. Updates are installed manually.

### Known limitations

- S-kaupat opens a signed-out browser session ([#3](https://github.com/Vkuparin/korikone/issues/3)). Sign in on the site to access the **Korikone** shopping list, then add its products to the cart yourself. The app does not place orders or make payments.
- Live K-Ruoka cart transfer and browser continuity, clean-machine installation and existing-profile upgrades still need observed acceptance.
- Check proposed products, pack sizes, dietary suitability and retailer totals before transferring or ordering. Catalogue matching and weighted pricing remain imperfect.
- Scanned PDFs require OCR first. Phone sync and automatic OCR are not included.

See [pre-release scope](docs/pre-release.md) and [acceptance evidence](docs/acceptance.md).

### Verification

Production build, formatting, 58 unit tests and eight desktop tests passed. Two additional packaged-app checks passed: demo transfer/recovery/restart and PDF receipt import. Clean-machine installation and existing-profile upgrades remain pending.
