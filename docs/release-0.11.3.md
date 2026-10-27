# v0.11.3 release verification

Published on 27 October 2026 as an unsigned Windows x64 pre-release: [GitHub release](https://github.com/Vkuparin/korikone/releases/tag/v0.11.3). Source tag v0.11.3 is the release commit on main. It contains the twelve review fixes B5.1–B5.12 in [the 0.12.0 task list](tasks/0.12.0.md#b5-review-fixes). Like v0.11.1 and v0.11.2 it is a patch release of v0.12 fix cards; the v0.12.0 Beta gates (signing decision F14.1, household pilot F14.6) are still open and its scope is unchanged.

## What changed

- Planning makes no hidden resolver request, and the Advanced switch for it is gone (B5.1).
- Transferring the same list again sends only what changed and never removes from the basket (B5.2). A partial transfer that cannot resume can be forgotten from the result panel (B5.5).
- More than 12 matching saved recipes no longer stop planning; the best 12 are used (B5.3).
- Composer fixes: typed text survives an edit, Find can be cancelled after a cancelled edit, a note change mid-plan shows no alert, Finnish uses "kpl" (B5.4).
- Startup failures show a native error box and write `startup-error.log` instead of leaving a windowless process (B5.6).
- Store tabs deny every permission except clipboard writes and fullscreen, and a stalled K-Ruoka page call fails after 30 s (B5.7).
- Backup restore commits in one transaction (B5.8).
- Fewer wasted AI calls: trimmed edit replies, fenced JSON everywhere, discovery timeouts reported as timeouts, language switches do not cancel a plan (B5.9).
- Price saving, the Kauppa snapshot and elapsed-time timers no longer grow with use (B5.10). Progress and Cancel sit above the store view on Kauppa (B5.11).
- Plans and edits have a 240 s total budget, and edit catalogue reads a 60 s phase deadline (B5.12).

## Source verification

Owner direction for this release: focused checks only, no full suite. Each card's focused unit and desktop checks are recorded in its status in the task list and were trusted, per [AGENTS.md](../AGENTS.md).

- On the release commit: type checking passed; `prettier --check` passed for every tracked file after formatting `tests/ui/startup.spec.ts` (added by B5.6). The untracked local probe `scripts/probe-mince.mts` is not part of the release.
- The 14 unit test files changed by B5.1–B5.12 ran together on the integrated main: 204 tests passed.
- Not run: the full `npm test` and `npm run test:ui`. Known older failures on main, not blockers and not rerun: the transfer-latency "20 ms per store call" assertion and `operation-progress.spec.ts` cases 1 and 3.

No owner ChatGPT request, live retailer account or private receipt was used.

## Package

`npm run package` prepared the pinned workers, license notices and checksum-verified Finnish OCR assets, built the app and produced the NSIS installer. Native ProductVersion is 0.11.3.0 and FileVersion is 0.11.3.

The short packaged smoke (`scripts/ocr-package-smoke.mjs`) passed: packaged launch, version 0.11.3 and one synthetic scanned-PDF import with a balanced total, saved OCR provenance, zero AI requests and zero retailer writes. No packaged feature matrix or installer acceptance was run.

- Installer: Korikone-0.11.3-x64-setup.exe, 152608366 bytes.
- SHA-256: 703d0ae85e60684ff8be72f9176ecb58447e70cfdc0c8610f502aad3847b75f3.
- Checksum asset: SHA256SUMS-0.11.3.txt.

## Remaining acceptance

- Live store sign-in under the new store-tab permission rule (B5.7): sign in to K-Ruoka and S-kaupat in the Kauppa tabs and confirm that sign-in, the store pages and adding to the basket still work. Fixtures cover the permission rule and the timeout, not real retailer pages.
- Live ChatGPT flows: a multi-dish plan, a follow-up edit, starter and offer ideas and loading the model list. A plan uses one to two ChatGPT calls; an edit, an idea request or a model-list load uses one.
- Clean-machine installation, signing and household pilot gates remain open in [pre-release scope](pre-release.md).
