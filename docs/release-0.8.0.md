# v0.8.0 release verification

Published on 12 October 2026 as an unsigned Windows x64 pre-release: [GitHub release](https://github.com/Vkuparin/korikone/releases/tag/v0.8.0). Source tag v0.8.0 points to d6fe9ed94abc98026b470294fcd161dfd7380cfc. All 21 Done cards are integrated on main and included; U19.3 remains Dropped because its audit reproduced no retailer-view lifecycle loss. Older per-card branch notes are completion-time evidence, superseded by this release inclusion. See [the canonical task list](tasks/0.8.0.md).

## Source verification

The owner requested minimum release testing and trusted the coding agents' focused evidence. One canonical local flow ran on the versioned release source. No full suite was repeated.

- npm run build: passed typecheck, client and main compilation. The resulting output was reused for packaging.
- npm run format:check: passed.
- npm test: 63 files, 634 tests passed.
- npm run test:ui -- --workers=4 --reporter=list,json: 120 tests passed with isolated development profiles. No retries or failed-check reruns were needed.
- [Fast CI 38209732204](https://github.com/Vkuparin/korikone/actions/runs/38209732204) is green for the tagged source. It checks build/typecheck, formatting and scope fixtures; full suites are intentionally skipped because the canonical flow ran locally. Earlier [coder integration CI](https://github.com/Vkuparin/korikone/actions/runs/38208403933) is also green.

Logs and the desktop JSON report are ignored under .runtime/v080 in the isolated release checkout. No owner account, live AI request, live retailer write or private receipt was used for release validation. Documentation and tag publication do not start another full run under R1.1.

## Package

Pinned retailer workers and notices were prepared, then electron-builder reused the verified build to create the Windows x64 NSIS installer. All eight dist files match app.asar. The new qrcode-generator notice is bundled. Version metadata reports 0.8.0; the executable reports ProductVersion 0.8.0.0 and FileVersion 0.8.0.

A small packaged smoke passed: launch/version, explicit Nakkikeitto list creation, remove-carrots instruction, local Undo, QR rendering and restart. Three rows and product/pack identities were restored. Two fixture inference responses were used; Undo made no inference/catalogue call, restart made no inference/catalogue read and retailer writes stayed zero. The first smoke attempt used an incorrect comparison field in the verification script; correcting it required no application change or repackaging. No packaged feature matrix or installer acceptance was run.

- Installer: Korikone-0.8.0-x64-setup.exe, 135607006 bytes.
- SHA-256: e201d2644944dd4cdb8efe1e0c7aeac3ac9da1e56ef3aeaef347b448abcb0ae2.
- Checksum asset: SHA256SUMS-0.8.0.txt.

## Scope and remaining acceptance

Edits modify the current list by default. Explicit New list opens a replacement draft. Clarification preserves saved state; exact row/meal entry points use the same composer. Edit details show actual changes and only comparable price differences. Undo is local and never reverses a retailer transfer.

Neutral dark surfaces and green/orange accents follow the confirmed shopping context. Store comparison explains missing setup, store settings no longer change chain silently and Return to store remains available during browsing/sign-in. Recipe text import produces a draft that saves only after review. QR export contains local plain-text snapshots, with numbered parts for long lists and a manual phone copy/share/save step.

Phone-camera scanning of short/long QR lists, owner accent/focus review, optional live edit/recipe interpretation and live comparison/return checks remain outstanding. The owner authorized this fixture-tested pre-release; those acceptance claims are not made. ChatGPT remains the default; local models, receipt learning, non-food expansion and mobile sync remain later work. Checkout/payment and S-kaupat's slot-reserving add-all action stay manual.

Clean-machine install, upgrade/uninstall, signing and household/live pilot gates remain open in [pre-release scope](pre-release.md). Earlier acceptance is retained in the v0.5.0–v0.7.0 verification records. Export a backup before upgrading; installation and updates remain manual.
