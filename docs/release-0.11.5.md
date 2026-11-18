# v0.11.5 release verification

Unsigned Windows x64 pre-release, 18 November 2026. [GitHub release](https://github.com/Vkuparin/korikone/releases/tag/v0.11.5) · [Release notes](../CHANGELOG.md)

## Checks

- One focused unit case in `one-click-transfer.test.ts` passed. It verifies quantities already sent, extra packs after a reduction and packs still to add.
- Four focused Electron cases passed in `repeat-list.spec.ts` and `checkout-history.spec.ts`. They cover zero catalogue reads for a manual quantity change, Undo and the basket link after a verified send, repeating recorded order items, History search and product expansion, the compact list shortcut and focus when opening an order directly.
- The build, changed-file Prettier checks and diff checks passed. Checks followed the owner's focused-only direction for this pre-release. Electron used temporary development data and local fixtures.
- The packaged app reported v0.11.5 and the compact shortcut focused the shopping list at 800 × 600. Live retailer behavior, owner visual acceptance and clean-machine installation remain open.

## Installer

- `Korikone-0.11.5-x64-setup.exe`, 152,618,311 bytes.
- SHA-256 `fa36464893685646bca6983ce19973a1e0643529d1766f9103750b7d7e5ec16b`.
- Checksum file `SHA256SUMS-0.11.5.txt`.
