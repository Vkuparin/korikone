# Korikone 0.4.0 release candidate

Prepared on 9 October 2026 from implementation commit `48d594c`. This is an unsigned Windows x64 pre-release candidate. Publication waits for the U10 and U11 owner observations recorded in [acceptance.md](acceptance.md).

## Changes

- One transfer action approves the displayed products, quantities and total, checks current retailer data, writes and verifies the batch, then opens the destination. Exceptions require a decision. Repeated approval reopens a verified batch without adding it again, including after restart. Opening failures offer an open-only retry.
- K-Ruoka opens its basket. S-kaupat opens the Korikone account list; the shopper still presses "Lisää kaikki ostoskoriin" on the retailer site. Checkout and payment stay manual.
- A compact AI model selector below the note shares its saved choice with a separate ChatGPT and AI Settings card. The choice applies to future note and recipe requests. Automatic prefers a recognized small model; names indicate size, not exact prices. If no suitable small model is identified, choose a model explicitly.
- Notes update only with Update list or Ctrl+Enter. View return and restart retain compatible last quoted prices. Header controls change the planning store and supported pickup/delivery choice without reinterpreting the note.
- The shopping list contains product details, transfer exceptions and recovery. Both chains can stay signed in, the basket comparison runs on request, and S-kaupat pickup fee ranges appear where available.

## Install and upgrade

The candidate installer is `release/v0.4.0/Korikone-0.4.0-x64-setup.exe`, with `SHA256SUMS.txt` beside it. Export a backup in Settings before upgrading. The app ID and saved-data location are unchanged. Existing profiles receive Automatic as their model preference; model choices survive backup restore. Updates remain manual.

## Verification

The build, formatting check, all 124 unit tests and all 29 source desktop tests passed. All eight final packaged checks passed: backup/model restore, exception cancellation and one-action transfer, real fixture IPC through both chains, development-profile isolation, interrupted-transfer recovery/restart, keyboard model selectors and persistence, PDF receipt import/failure, and open-only handoff retry. All automated Electron checks use temporary development-mode profiles and local fixtures. They do not use live ChatGPT generations or retailer accounts.

Installer SHA-256: `585b5b496ca03767583497f132e54818800f582161e69e87c59f19bb06a2cc2d`.

The executable reports Korikone 0.4.0 and includes K-Ruoka worker 0.1.3 and S-kaupat worker 1.2.0, each prepared from checksum-pinned files. The installer is unsigned and uses the existing application icon.

## Remaining acceptance

For U10, transfer a small displayed batch to each chain, compare the resulting quantities, check automatic opening, reopen without adding products, and verify manual checkout. This changes retailer baskets/lists and needs no ChatGPT generations.

For U11, find and change both model selectors, restart, then validate Automatic and an explicit choice. Live validation requires two successful ChatGPT generations, with at most one corrective validation retry per request. The [testing checklist](testing.md#one-action-transfer-and-model-checks-040) also describes fixture-only observation.

Clean-account installation, upgrade over existing data, uninstall, varied real receipts, K-Ruoka browser account continuity and signing remain the earlier acceptance gates. Packaged executable checks do not establish installer acceptance. Scanned receipts still require OCR outside Korikone; catalogue matching and weighted pricing require shopper review.

## Publication

After owner acceptance, commit its evidence, rerun checks affected by any fixes, and rebuild if application code changes. Publish a GitHub pre-release tagged `v0.4.0` with the installer and checksum, using these notes. Keep the stable-release gates in [pre-release.md](pre-release.md) open until observed. This preparation does not create a tag or publish a release.
