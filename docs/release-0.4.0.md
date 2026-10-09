# Korikone 0.4.0 release candidate

Prepared on 9 October 2026 from implementation commit `af18a6d`, including the U12/U13 work in `9d5bbb4` and earlier transfer/model changes. This is an unsigned Windows x64 pre-release candidate. Publication waits for the remaining U10 and U11 live owner observations recorded in [acceptance.md](acceptance.md).

## Changes

- One transfer action approves the displayed products, quantities and total, checks current retailer data, writes and verifies the batch, then opens the destination. Exceptions require a decision. Repeated approval reopens a verified batch without adding it again, including after restart. Opening failures offer an open-only retry.
- K-Ruoka opens its basket. S-kaupat opens the Korikone account list; the shopper still presses "Lisää kaikki ostoskoriin" on the retailer site. Checkout and payment stay manual.
- A compact rounded model button below the note shares its saved choice with a separate ChatGPT and AI Settings card. Its floating menu marks the selected model and supports keyboard navigation. The choice applies to future note and recipe requests. Automatic prefers a recognized small model; names indicate size, not exact prices. If no suitable small model is identified, choose a model explicitly.
- Language uses the same rounded menu, with Suomi/English and a selected checkmark. Settings/About shows the running app version, including prerelease suffixes.
- The ChatGPT card explains that remaining allowance and reset time are unavailable in Korikone and links to ChatGPT usage settings. Received usage or rate limits do not establish that the whole account allowance is exhausted.
- Notes update only with Update list or Ctrl+Enter. View return and restart retain compatible last quoted prices. Header controls change the planning store and supported pickup/delivery choice without reinterpreting the note.
- The shopping list contains product details, transfer exceptions and recovery. Both chains can stay signed in, the basket comparison runs on request, and S-kaupat pickup fee ranges appear where available.

## Install and upgrade

The candidate installer is `release/v0.4.0/Korikone-0.4.0-x64-setup.exe`, with `SHA256SUMS.txt` beside it. Export a backup in Settings before upgrading. The app ID and saved-data location are unchanged. Existing profiles receive Automatic as their model preference; model choices survive backup restore. Updates remain manual.

## Verification

The build, formatting check, all 124 unit tests and all 31 source desktop tests passed. Ten packaged release checks passed: backup/model restore, exception cancellation and one-action transfer, both-chain fixture IPC, development-profile isolation, interrupted-transfer recovery/restart, keyboard model menus and persistence, PDF receipt import/failure, open-only handoff retry, cancellation during model catalogue lookups, and runtime version/language/usage Settings. After the owner requested removal of the visible language label, the installer was rebuilt and the affected packaged Settings check passed again, including the accessible language name. All automated checks used isolated development profiles and no live accounts.

Installer SHA-256: `813833a28364b95ebef83857a27e2abb3b19fa319e0236500046a9c734e4d620`.

The executable reports Korikone 0.4.0 and includes K-Ruoka worker 0.1.3 and S-kaupat worker 1.2.0, each prepared from checksum-pinned files. The installer is unsigned and uses the existing application icon.

## Remaining acceptance

The first owner fixture walkthrough found unclear development-mode opening feedback. The rebuilt candidate explains that no real retailer window opens and displays a count of tested openings. It also includes the model-menu style requested during that walkthrough. Both affected packaged checks passed, and the candidate was reopened with the same isolated acceptance profile.

For U10, transfer a small displayed batch to each chain, compare the resulting quantities, check automatic opening, reopen without adding products, and verify manual checkout. This changes retailer baskets/lists and needs no ChatGPT generations.

For U11, find and change both model selectors, restart, then validate Automatic and an explicit choice. Live validation requires two successful ChatGPT generations, with at most one corrective validation retry per request. The [testing checklist](testing.md#one-action-transfer-and-model-checks-040) also describes fixture-only observation.

The owner reported on 9 October 2026 that signing is unavailable. This candidate will remain unsigned; signing is not a v0.4.0 gate. Clean-account installation, upgrade over existing data, uninstall, varied real receipts and K-Ruoka browser account continuity remain the earlier acceptance gates. Packaged executable checks do not establish installer acceptance. Scanned receipts still require OCR outside Korikone; catalogue matching and weighted pricing require shopper review.

## Publication

After owner acceptance, commit its evidence, rerun checks affected by any fixes, and rebuild if application code changes. Publish a GitHub pre-release tagged `v0.4.0` with the installer and checksum, using these notes. Keep the stable-release gates in [pre-release.md](pre-release.md) open until observed. This preparation does not create a tag or publish a release.
