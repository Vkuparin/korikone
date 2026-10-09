# Agreed prototype scope

Confirmed with the project owner on 8 October 2026.

- Public repository: Vkuparin/korikone. License: Apache-2.0.
- Windows Electron/React/TypeScript application with an installer.
- Persistent household settings, recipes, recurring staples, weekly meals, ingredient quantities and shopping-list export.
- Finnish by default; English selectable without losing work.
- Both demo stores, including existing cart items, missing products, changed prices and interrupted-transfer recovery.
- Real K-Ruoka catalogue and reviewed, reconciled cart transfer. Live account acceptance requires the owner's login and an observed small transfer.
- Attempt official ChatGPT sign-in and meal drafting. Manual planning remains available if access is blocked. No automatic paid API fallback.
- Consume S-kaupat only after its independently developed release is ready. Do not work on that project here.
- Commit and push working stages to main without additional publication approvals.

This scope overrides the prerequisite ordering for this prototype. It does not claim the complete two-retailer consumer release, signed distribution, clean-machine acceptance, household pilot or live account checks before they have actually been performed.

## UX direction confirmed on 8 October 2026

Use good defaults and automate setup details. Model discovery and selection must happen automatically, preferring a small available model without pinning a model name or version. Keep model overrides and technical settings under advanced settings. First launch must guide the user through optional store and ChatGPT connections. Apply this approach throughout the app: keep everyday actions visible, hide infrequent controls, and preserve manual planning when a connection is skipped or unavailable.

## Verification

Track implementation, automated checks, packaged-app checks and live-account checks separately. A mock contract test cannot establish live retailer behavior. A build cannot establish clean-machine installation. Record outstanding acceptance work explicitly.

## First feedback round, 9 October 2026

The current UI direction is the note-driven shopping workspace in [design.md](design.md) and [ux.md](ux.md). It supersedes the separate weekly-entry and draft-review flow. Add automatic interpretation and product selection, editable compact rows, a separate optional meal schedule, transfer history, and local PDF/TXT/CSV receipt import. Preserve the existing optional setup and manual path. Scanned PDFs requiring OCR, phone sync and an embedded retailer browser are not implemented.
