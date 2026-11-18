# v0.11.5 release verification

Unsigned Windows x64 pre-release, 18 November 2026. [GitHub release](https://github.com/Vkuparin/korikone/releases/tag/v0.11.5) · [Release notes](../CHANGELOG.md)

## Changes since v0.11.4

- Manual grocery entry labels the fields, explains invalid names or amounts, confirms additions and keeps the next draft while saving. Typing in the shopping note reuses product comparisons.
- Search recipes by name or ingredient and read instructions without opening the editor. Select a meal in the calendar to move it to another day. History links to saved receipts, and receipt details load on demand. The embedded store moves when its position or size changes.
- First launch offers a blank list, guided setup or a filled example. Setup and Settings share store search. Connect ChatGPT beside the shopping note and try an editable example request or edit.
- After creating a list, jump to its groceries and review products that couldn't be matched. The transfer shows the products and prices it can send. Both retailer views show the next step and name items to add by hand.
- Return from the store to the list, add a forgotten item, and send only the packs still needed. If the retailer basket changed, Korikone shows the revised quantities before sending.
- Mark an order as placed and open its entry in History. Start a fresh list from that entry. Search History by store or grocery and expand an order to see its products.
- Reuse selected items or repeat the recorded order with current prices. The original meal plan is available separately. Adjust quantities using the prices already on the list. In compact windows, the shortcut at the top takes you to the groceries.
- AI edit results show what changed, including before-and-after quantities, with links to missing products or transfer. Undo restores the earlier list and flags extra packs that may still be in the retailer basket. Open the basket to check and remove any you no longer want.

## Checks

- One focused unit case in `one-click-transfer.test.ts` passed. It verifies quantities already sent, extra packs after a reduction and packs still to add.
- Four focused Electron cases passed in `repeat-list.spec.ts` and `checkout-history.spec.ts`. They cover zero catalogue reads for a manual quantity change, Undo and the basket link after a verified send, repeating recorded order items, History search and product expansion, the compact list shortcut and focus when opening an order directly.
- The build, changed-file Prettier checks and diff checks passed. Checks followed the owner's focused-only direction for this pre-release. Electron used temporary development data and local fixtures.
- The packaged app reported v0.11.5 and the compact shortcut focused the shopping list at 800 × 600. Live retailer behavior, owner visual acceptance and clean-machine installation remain open.

## Installer

- `Korikone-0.11.5-x64-setup.exe`, 152,618,311 bytes.
- SHA-256 `fa36464893685646bca6983ce19973a1e0643529d1766f9103750b7d7e5ec16b`.
- Checksum file `SHA256SUMS-0.11.5.txt`.
