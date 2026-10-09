# Release notes

## Unreleased

- Cancel a pending note interpretation beside the input. Cancellation preserves the saved list and typed note, invalidates pending drafts, and suppresses automatic resubmission.
- Added the original nakkikeitto/kanapasta/ready-food/breakfast/treats fixture and regression checks for debounce, request counts, cancellation, usage failures and explicit retry.
- Updated the implementation plan and acceptance preparation for the published alpha.2 release. Live model and retailer acceptance remain separate.
- Expanded synthetic PDF checks for Finnish characters, euro signs, fonts, page order and extraction limits.
- Agent instructions use focused feature checks during implementation and reserve full suites for release preparation.

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
