# v0.11.1 release verification

Published on 25 October 2026 as an unsigned Windows x64 pre-release: [GitHub release](https://github.com/Vkuparin/korikone/releases/tag/v0.11.1). Source tag v0.11.1 is the release commit on main. It contains every card completed on main since v0.11.0: B3.1–B3.7, P1.1–P1.2, F14.3–F14.4 and the owner interface fixes recorded in [later.md](tasks/later.md). Cards stay in [the 0.12.0 task list](tasks/0.12.0.md); this patch release does not change the v0.12 scope.

Codex prepared the release on `codex/performance-progress` and ran out of usage during the desktop failure reruns. Claude finished the pass on the same branch, reused Codex's passing evidence and reran only failed or affected checks.

## Source verification

- npm run build and npm run format:check passed on the release candidate. Type checking passed again after the final fixes.
- npm test: 122 files, 1,106 of 1,108 tests passed in the canonical run. The two failures asserted one catalogue read on failure; with two bounded workers, two reads can already be in flight. Both assertions were updated and pass.
- npm run test:ui: 225 cases ran once; 207 passed and 18 failed. Every failure was rerun after its fix and passes:
  - status text assertions written for the former generic progress texts (shopping, planning activity, release interface, operation progress);
  - the accessibility check audited setup focus before the asynchronous save had replaced the welcome screen;
  - opening AI settings could wait for model discovery without progress. Discovery now uses the shared tracker and cancellation, and Settings reuses the known model list;
  - pricing an empty list reported 0 completed reads with no total, which failed progress validation and turned the quote into operationFailed. Fixed in the service, with a unit regression test. The two transfer review-setting cases pass with their original test unchanged.
- After the final model-list change, 31 AI-settings, progress, accessibility and interface desktop cases ran again. One settings-info assertion expected opening Settings to fetch models again; it now presses Reload models, and the case passes.
- Focused units after the final changes: performance, operation progress, progress view, operation metrics, AI shopping and models, 27 tests passed.

No owner ChatGPT request, live retailer account or private receipt was used. Logs stay ignored under .runtime/performance in the release worktree.

## Package

Both pinned retailer workers, license notices and checksum-verified Finnish OCR assets were prepared, and electron-builder produced the NSIS installer. Native ProductVersion is 0.11.1.0 and FileVersion is 0.11.1.

The short packaged smoke passed: launch, version 0.11.1 and one synthetic scanned-PDF import with a balanced total, saved OCR provenance, zero AI requests and zero retailer writes. No packaged feature matrix or installer acceptance was run.

- Installer: Korikone-0.11.1-x64-setup.exe, 152601454 bytes.
- SHA-256: 44365fa659b5b08fa06ea86dcb111d7bd1df1f38561017229fe6da2da7e452d3.
- Checksum asset: SHA256SUMS-0.11.1.txt.

## Remaining acceptance

Live checks are still open: model quality across arbitrary notes, starter idea variety, how long waits feel with the new progress surface, and the earlier K-Ruoka generation failure, which was not reproduced. The two-version NSIS upgrade that keeps ChatGPT and retailer sessions (B3.3) has source and restart coverage only. Clean-machine installation, signing and household pilot gates remain open in [pre-release scope](pre-release.md).
