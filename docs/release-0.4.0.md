# Korikone 0.4.0 release candidate

Prepared on 9 October 2026 from implementation commit `af18a6d`, including the U12/U13 work in `9d5bbb4` and earlier transfer/model changes. This unsigned Windows x64 candidate is ready for publication as a pre-release. U10 and U11 live acceptance passed and is recorded in [acceptance.md](acceptance.md).

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

## Owner acceptance and limitations

The first owner fixture walkthrough found unclear development-mode opening feedback. The rebuilt candidate explains that no real retailer window opens and displays a count of tested openings. It also includes the model-menu style requested during that walkthrough. Both affected packaged checks passed, and the candidate was reopened with the same isolated acceptance profile.

For U10, the final packaged app transferred one 500 g coffee pack from quantity 0 to 1 at each chain. Readback verified both transfers. The owner confirmed that both destinations opened signed in with the expected coffee. Reopening and repeating the action preserved quantity 1; K-Ruoka's repeat also passed after restart. Checkout remained manual, with no order or payment.

For U11, the owner accepted shared selection and the rounded menus. Live Automatic used `gpt-6-luna`; the explicit request used `gpt-5.6-luna`. Both returned validated drafts without changing the saved plan, and the explicit choice survived restart. Exactly two requests completed, with zero corrective retries. The original plan and Automatic preference were restored and verified after restart; both retailer store entries were retained. Coffee remains in the retailer destinations at quantity 1.

The owner reported on 9 October 2026 that signing is unavailable. This candidate will remain unsigned; signing is not a v0.4.0 gate. Clean-account installation, upgrade over existing data, uninstall, varied real receipts and broader household use remain stable-release gates. Packaged executable checks do not establish installer acceptance. Scanned receipts still require OCR outside Korikone; catalogue matching and weighted pricing require shopper review.

## Publication

Owner acceptance is recorded and no application code changed during the live checks, so the tested installer and checksum remain valid. Publish a GitHub pre-release tagged `v0.4.0` from this candidate's source with the installer and checksum, using these notes. Keep the stable-release gates in [pre-release.md](pre-release.md) open until observed. This preparation does not create a tag or publish a release. The checkout has diverged from `origin/main`, which contains separate later-roadmap work; merging that work would require a new build and release checks.
