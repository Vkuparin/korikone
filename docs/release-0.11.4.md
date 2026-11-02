# v0.11.4 release verification

Published on 2 November 2026 as an unsigned Windows x64 pre-release: [GitHub release](https://github.com/Vkuparin/korikone/releases/tag/v0.11.4). Source tag v0.11.4 is the release commit on main. It contains the eleven polish items B6.1–B6.11 in [the 0.12.0 task list](tasks/0.12.0.md#b6-polish), each approved by the owner one at a time. Like v0.11.1–v0.11.3 it is a patch release of v0.12 fix cards; the v0.12.0 Beta gates (signing decision F14.1, household pilot F14.6) are still open and its scope is unchanged.

## What changed

- The "new version available" banner now finds pre-releases (B6.1). Installations of v0.11.3 and earlier still ask GitHub for the latest stable release, so they do not announce this version: install v0.11.4 by hand once, and later versions are announced.
- Shopping list rows are compact, so several products show at once in the list panel (B6.2).
- Starting Korikone again brings the open window forward instead of doing nothing, and the window reopens at the size and place it was left at (B6.3).
- The Kauppa return cue shows only when a store page is really open, as an outline (B6.4).
- The receipt import box no longer covers the list panel's transfer button (B6.5).
- Wording: singular and plural counts read right in Finnish and English ("1 kuitti tallennettu", "1 annos"), "Edullisin, merkistä riippumatta", and the Advanced card is titled "Siirto ja tuotevalinnat" (B6.6).
- Small layout fixes: Advanced checkboxes beside their labels, History's import button beside its heading, the chart's budget label no longer cut off, natural dates and times (B6.7).
- An open recipe editor and a regular item being typed keep their text when you look at another page (B6.8).
- The diagnostic report opens in a scrollable box under Lisäasetukset, and saving writes exactly the text shown; a failed transfer keeps only an error code, never a store's message text (B6.9).
- Settings > Tiedot imports several receipts the same way as History, with the same progress and summary box; the keep-source-text option still applies there (B6.10).
- "Tyhjennä lista" opens the same confirmed New list as the composer: the week is saved to Historia, leftover days stay, and there is no Undo (B6.11).

## Source verification

Owner direction for this release: focused checks only, no full suite. Each card's focused unit and desktop checks, including a check that fails on the code before the change, are recorded in its status in the task list and were trusted, per [AGENTS.md](../AGENTS.md).

- On the release commit: type checking passed; `prettier --check src tests scripts` passed. Twenty-three Markdown documents and one design HTML file were not Prettier-formatted before this release either and were left as they are.
- The six unit test files changed since v0.11.3 ran together on main: 78 tests passed.
- Not run: the full `npm test` and `npm run test:ui`. Known older failures on main, not blockers and not rerun: the transfer-latency "20 ms per store call" assertion, `operation-progress.spec.ts` cases 1 and 3, `shopping.spec.ts` "validated preview shows gradual rows", and an occasional `page.reload` ERR_ABORTED at desktop test setup.

No owner ChatGPT request, live retailer account or private receipt was used.

## Package

`npm run package` prepared the pinned workers, license notices and checksum-verified Finnish OCR assets, built the app and produced the NSIS installer. Native ProductVersion is 0.11.4.0 and FileVersion is 0.11.4.

The short packaged smoke (`scripts/ocr-package-smoke.mjs`) passed: packaged launch, version 0.11.4 and one synthetic scanned-PDF import with a balanced total, saved OCR provenance, zero AI requests and zero retailer writes. No packaged feature matrix or installer acceptance was run.

- Installer: Korikone-0.11.4-x64-setup.exe, 152610582 bytes.
- SHA-256: a0ba0439488ff49d48596eb28f63523bd7ff0afd88eea8316e575cc3d91c585b.
- Checksum asset: SHA256SUMS-0.11.4.txt.

## Remaining acceptance

- On Windows: minimize Korikone and start it again from the Start menu, and the window comes back; resize or maximize it, close and reopen, and it keeps its size and place (B6.3).
- On Windows: open Settings > Lisäasetukset > Tallenna vianetsintätiedot and save the report once (B6.9).
- A look at the shopping list with a real list on your own screen (B6.2).
- Carried over from v0.11.3: live store sign-in under the store-tab permission rule (B5.7) and the live ChatGPT flows.
- Clean-machine installation, signing and household pilot gates remain open in [pre-release scope](pre-release.md).
