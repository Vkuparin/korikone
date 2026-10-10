# Pre-release scope

Agreed direction on 9 October 2026: move from prototype to pre-release while keeping scope focused. The first version is **0.2.0-alpha.1**, distributed as an unsigned Windows x64 installer and marked as a GitHub pre-release.

**0.2.0-alpha.3** was an earlier published pre-release. It added cancellation of a pending note interpretation and wider fixture and receipt-PDF checks on top of alpha.2's development mode. Its source and packaged checks passed. The current version is v0.6.0; deferred product features remain deferred.

## Included

Keep the current note-driven shopping workspace, optional ChatGPT connection, manual recipes, local data and backup, Finnish and English, PDF/TXT/CSV receipt import, and reviewed K-Ruoka cart and S-kaupat account-list transfers. Preserve the pinned retailer workers and transfer recovery. Include the latest product-matching and Finnish-label fixes.

Published v0.4.0 includes the accepted smooth-flow roadmap work: U1, U2, U7, U8, U9, U10, U11, U12 and U13, plus the completed two-chain comparison and fee work. Settings shows the runtime version, language and model use matching selection menus, and ChatGPT usage has an unavailable-allowance explanation with the official usage link. Versioning, packaging, automated checks, packaged-app checks, release notes and U10/U11 live owner acceptance are complete. Stable-release gates below remain open. The storage location and application ID stay the same; older profiles receive default model preferences. Export a backup from Settings before upgrading an existing profile.

## Release checks

- Run the full build, unit, desktop and formatting flow once on the release source, locally or in canonical CI. Trust the coder agents' focused evidence. After fixes, rerun only failed or affected checks; reuse passing evidence after promotion or documentation changes.
- Build the Windows x64 NSIS installer with both pinned retailer workers.
- Use a small packaged smoke check for launch/version and a relevant critical path with isolated test data. Add a focused check for a packaging-specific concern; do not repeat the source desktop suite or all feature matrices against the package.
- Publish the installer and SHA-256 checksum with a source tag and known limitations. Mark the GitHub release as a pre-release. Installation and upgrades are manual.

## Gates before a stable release

- S-kaupat authenticated browser handoff ([#3](https://github.com/Vkuparin/korikone/issues/3)): observed by the owner on 9 October 2026 with s-kaupat-mcp 1.2.0 and a per-folder login. After one sign-in, _Open store cart_ opened the S-kaupat window signed in. _Lisää kaikki ostoskoriin_ remains roadmap task A.2.
- K-Ruoka's small cart transfer and signed-in browser handoff passed on 9 October 2026: coffee quantity 0 to 1, verified readback, duplicate-safe reopening and owner-observed destination. The broader two-product and checkout-page check remains roadmap task A.1.
- Test a clean Windows install, an upgrade with existing data, and uninstall behavior. A packaged executable smoke test does not establish installer acceptance.
- Observe real multi-dish notes, varied receipts and household use without coaching.
- Signing is unavailable, as reported by the owner on 9 October 2026. v0.6.0 remains unsigned. Revisit signing and verify the distribution process before broad release.

v0.5.0 integrates the published v0.4.0 flow with embedded retailer tabs, shared S-kaupat library calls, one-screen setup and second-chain setup in Settings. Source and packaged checks pass. Authorized live acceptance verified remembered sessions, small transfers and duplicate-safe reopening with zero ChatGPT requests. Results and remaining stable-release gates are recorded in [release-0.5.0.md](release-0.5.0.md).

v0.6.0 adds the reviewed shopping layout, System/Light/Dark appearance and seven Settings sections. Owner layout and dark/System startup acceptance is complete. The release uses isolated development fixtures and preserves the v0.5.0 retailer flow. See [release-0.6.0.md](release-0.6.0.md) for full release and packaged checks. Clean-machine install, upgrade/uninstall, signing and household pilot gates remain open.

Checkout and payment remain manual. Scanned receipts require OCR outside Korikone. Phone sync, automatic OCR and broader purchase-learning features stay deferred. Detailed evidence is in [acceptance.md](acceptance.md).
