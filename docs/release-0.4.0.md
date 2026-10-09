# Korikone 0.4.0 release candidate

Prepared on 9 October 2026 from implementation commits `48d594c` and `64ea745`. This is an unsigned Windows x64 pre-release candidate. Publication waits for the U10 and U11 owner observations recorded in [acceptance.md](acceptance.md), and the newly added U12/U13 roadmap work.

## Changes

- One transfer action approves the displayed products, quantities and total, checks current retailer data, writes and verifies the batch, then opens the destination. Exceptions require a decision. Repeated approval reopens a verified batch without adding it again, including after restart. Opening failures offer an open-only retry.
- K-Ruoka opens its basket. S-kaupat opens the Korikone account list; the shopper still presses "Lisää kaikki ostoskoriin" on the retailer site. Checkout and payment stay manual.
- A compact AI model selector below the note shares its saved choice with a separate ChatGPT and AI Settings card. The choice applies to future note and recipe requests. Automatic prefers a recognized small model; names indicate size, not exact prices. If no suitable small model is identified, choose a model explicitly.
- Notes update only with Update list or Ctrl+Enter. View return and restart retain compatible last quoted prices. Header controls change the planning store and supported pickup/delivery choice without reinterpreting the note.
- The shopping list contains product details, transfer exceptions and recovery. Both chains can stay signed in, the basket comparison runs on request, and S-kaupat pickup fee ranges appear where available.

## Install and upgrade

The candidate installer is `release/v0.4.0/Korikone-0.4.0-x64-setup.exe`, with `SHA256SUMS.txt` beside it. Export a backup in Settings before upgrading. The app ID and saved-data location are unchanged. Existing profiles receive Automatic as their model preference; model choices survive backup restore. Updates remain manual.

## Verification

The build, formatting check, all 124 unit tests and all 30 source desktop tests passed. All nine final packaged checks passed: backup/model restore, exception cancellation and one-action transfer, real fixture IPC through both chains, development-profile isolation, interrupted-transfer recovery/restart, keyboard model selectors and persistence, PDF receipt import/failure, open-only handoff retry, and cancellation during both model catalogue lookups for note and recipe requests. The 20 focused AI/model/development unit tests also passed after the final cancellation changes. All automated Electron checks use temporary development-mode profiles and local fixtures. They do not use live ChatGPT generations or retailer accounts.

Installer SHA-256: `b6cf87a7bdb25fa0fc5cf1278217ff87de25566050a6575c076dc2ddf1dfdfb5`.

The executable reports Korikone 0.4.0 and includes K-Ruoka worker 0.1.3 and S-kaupat worker 1.2.0, each prepared from checksum-pinned files. The installer is unsigned and uses the existing application icon.

## Remaining acceptance

The first owner fixture walkthrough found unclear development-mode opening feedback. The source fix explains that no real retailer window opens and displays a count of tested openings; its focused desktop check passed. Rebuild the candidate before final acceptance. The installer checksum above still describes the earlier packaged build.

For U10, transfer a small displayed batch to each chain, compare the resulting quantities, check automatic opening, reopen without adding products, and verify manual checkout. This changes retailer baskets/lists and needs no ChatGPT generations.

For U11, find and change both model selectors, restart, then validate Automatic and an explicit choice. Live validation requires two successful ChatGPT generations, with at most one corrective validation retry per request. The [testing checklist](testing.md#one-action-transfer-and-model-checks-040) also describes fixture-only observation.

The owner reported on 9 October 2026 that signing is unavailable. This candidate will remain unsigned; signing is not a v0.4.0 gate. Clean-account installation, upgrade over existing data, uninstall, varied real receipts and K-Ruoka browser account continuity remain the earlier acceptance gates. Packaged executable checks do not establish installer acceptance. Scanned receipts still require OCR outside Korikone; catalogue matching and weighted pricing require shopper review.

## Publication

After owner acceptance, commit its evidence, rerun checks affected by any fixes, and rebuild if application code changes. Publish a GitHub pre-release tagged `v0.4.0` with the installer and checksum, using these notes. Keep the stable-release gates in [pre-release.md](pre-release.md) open until observed. This preparation does not create a tag or publish a release.
