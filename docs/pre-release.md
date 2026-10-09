# Pre-release scope

Agreed direction on 9 October 2026: move from prototype to pre-release while keeping scope focused. The first version is **0.2.0-alpha.1**, distributed as an unsigned Windows x64 installer and marked as a GitHub pre-release.

**0.2.0-alpha.3** is the current published pre-release. It adds cancellation of a pending note interpretation and wider fixture and receipt-PDF checks on top of alpha.2's development mode. Its source and packaged checks passed. Further source work completes behaviors already specified in the design; deferred product features remain deferred.

## Included

Keep the current note-driven shopping workspace, optional ChatGPT connection, manual recipes, local data and backup, Finnish and English, PDF/TXT/CSV receipt import, and reviewed K-Ruoka cart and S-kaupat account-list transfers. Preserve the pinned retailer workers and transfer recovery. Include the latest product-matching and Finnish-label fixes.

This stage covers release versioning, packaging, automated checks, packaged-app smoke tests and release notes. It does not add features or change the storage location, application ID or backup format. Export a backup from Settings before upgrading an existing profile.

## Release checks

- Build, unit tests, desktop tests and formatting pass on the release source.
- Build the Windows x64 NSIS installer with both pinned retailer workers.
- Run the packaged executable through the demo transfer/recovery/restart journey and PDF receipt import with isolated test data.
- Publish the installer and SHA-256 checksum with a source tag and known limitations. Mark the GitHub release as a pre-release. Installation and upgrades are manual.

## Gates before a stable release

- Observe the S-kaupat authenticated browser handoff ([#3](https://github.com/Vkuparin/korikone/issues/3)). Account-list transfer was verified, but the opened site was signed out. A fix that requires the login window to complete in Korikone's own data folder passes fixture tests and awaits a live check.
- Observe a small K-Ruoka cart transfer and confirm the checkout browser shows the same cart.
- Test a clean Windows install, an upgrade with existing data, and uninstall behavior. A packaged executable smoke test does not establish installer acceptance.
- Observe real multi-dish notes, varied receipts and household use without coaching.
- Decide on signing and verify the distribution process before broad release.

Checkout and payment remain manual. Scanned receipts require OCR outside Korikone. Phone sync, an embedded retailer browser, automatic OCR and broader purchase-learning features stay deferred. Detailed evidence is in [acceptance.md](acceptance.md).
