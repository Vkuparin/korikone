# Korikone roadmap to 1.0.0

Agreed with the owner on 9 October 2026. This page lists the accepted features and splits them into tasks for implementation. New features are added only after the owner accepts them. Proposals and discussion happen in the project's roadmap thread.

## How to use this page

- Work milestone by milestone, and within a milestone in task order, unless a task says it can run in parallel. A task's dependencies must be done first.
- Before starting a task, check the code for its real status. Mark it **In progress** here when you start and **Done** with the commit when it lands. Record anything learned in a spike in the page it names.
- Every task follows [AGENTS.md](../AGENTS.md): development-mode fixtures with success and failure cases at the retailer or AI boundary, focused unit tests, and a focused UI test when the task changes interaction. No task uses the owner's ChatGPT allowance or retailer accounts.
- Each feature ends with one live check by the owner. Ask for it only after the feature's fixture tests pass, and say what to look at and how much ChatGPT use it needs.
- Keep design rules: checkout and payment stay manual, retailer writes need a reviewed batch, and ordering, payment and slot-selection tools stay off the allowlists.
- Update [design.md](design.md), [ux.md](ux.md), [testing.md](testing.md) and [acceptance.md](acceptance.md) when a feature changes behavior they describe.

Status values: **Planned**, **In progress**, **Done**, **Dropped** (with the reason).

## Decisions made with this roadmap

- The store comparison (F2) runs when the shopper asks for it, not after every list change. It doubles catalogue requests, and S-kaupat requests go through a browser window.
- Korikone may suggest recurring items from past purchases (F6). A suggestion becomes a recurring item only when the shopper accepts it. This replaces the earlier rule that no purchase frequency is inferred, once F6 lands.
- Out of scope for 1.0: automatic checkout or payment (permanent), cloud sync and shared household accounts, a browser extension, nutrition goals, other chains, a mobile app.

## Milestones

| Version | Theme | Features |
| --- | --- | --- |
| 0.2.x | Finish the alpha | A |
| 0.3.0 | Both chains at once | F1, F2, F3 |
| 0.4.0 | Complete prices | F4, F5 |
| 0.5.0 | Learn from purchases | F6, F7, F8 |
| 0.6.0 | Plan the week | F9, F10, F11 |
| 0.7.0 | Take it to the store | F12, F13 |
| 0.9.0 | Beta and feature freeze | F14 |
| 1.0.0 | Stable | All gates in [pre-release.md](pre-release.md) met, no open blocker bugs |

## 0.2.x: Finish the alpha

### A. Open live checks

Already agreed in [pre-release.md](pre-release.md). The owner observes these; implementation work prepares a build and a checklist for each, and fixes what they find.

| ID | Task | Status |
| --- | --- | --- |
| A.1 | K-Ruoka: transfer two products, compare before and after, open checkout and confirm it shows the same cart | Planned |
| A.2 | S-kaupat: press *Lisää kaikki ostoskoriin* on the Korikone list and go as far as the checkout page | Planned. The signed-in handoff it needs was observed on 9 October 2026 ([#3](https://github.com/Vkuparin/korikone/issues/3)) |
| A.3 | Install on a clean Windows user account, upgrade over existing data, uninstall | Planned |
| A.4 | A real multi-dish note (the nakkikeitto example) and two or three real receipts | Planned |

## 0.3.0: Both chains at once

### F1. Both chains signed in at the same time

Today the app has one store selection, so using the other chain means switching away. After F1, Settings lists K-Ruoka and S-kaupat side by side, each with its own sign-in state and chosen store. One of them is the active store. Switching keeps the other chain signed in and remembers its store.

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| F1.1 | Saved state keeps one store per chain plus the active chain. Older profiles and backups migrate without losing the current store; the backup format stays readable by the previous release where possible | | Done (5cadf2c): `stores` keeps one store per chain beside the active `context`, which earlier releases still read |
| F1.2 | Settings and setup show both chains with sign-in status, store and a "Use this store" action | F1.1 | Done: shared chain list in Settings and setup, sign-in actions name a chain, `tests/ui/chains.spec.ts` |
| F1.3 | Both retailer workers run side by side (K-Ruoka uses Chrome, S-kaupat prefers Edge). Fixture test switching chains with a list in progress, including saved product choices per chain | F1.1 | Done: the two workers are separate processes with their own browser profiles, so nothing closes one when the other chain is active; fixture test in `tests/development.test.ts` switches chains with a list in progress and keeps each chain's product choice. Live check pending |

### F2. Compare the basket between S-kaupat and K-Ruoka

Shown only when both chains are signed in and have a store chosen. A "Compare stores" button under the total prices the current list at the other chain too, without changing either account. For each chain it shows the total for rows both chains could price (the fair comparison), the full priced total with the count of rows that had no price or product, known deposits, fees once F3 exists, and the rows with the biggest price difference. "Use this store" switches the active chain and reprices the list there.

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| F2.1 | Price the list against a chain that is not active, read-only: no saved state, review or journal changes. Reuse saved product choices per chain; other rows use the normal automatic rules | F1.1 | Done: `Service.compareStores` reuses the pricing path read-only; a list change drops the comparison |
| F2.2 | Comparison rules in domain code: common rows, totals, missing rows, largest differences. Unit tests with partial coverage, ties and one chain pricing nothing | | Done: `compareBaskets` in `src/domain/compare.ts`, tests in `tests/compare.test.ts` |
| F2.3 | Comparison panel in Finnish and English, visible only when both chains qualify, with "Use this store" | F2.1, F2.2 | Done: "Vertaa kauppoja" under the list total opens `src/ui/compare.tsx`. It is a separate component so it can move into the pinned total bar if U1 is approved |
| F2.4 | Development fixtures where the chains differ in price and in which items they carry. Focused UI test for compare, cancel and switch | F2.3 | Done: the K-Ruoka fixture has dearer mince and no salt; `tests/ui/compare.spec.ts`. Live check pending |

### F3. Delivery and pickup fees

Before F3, fees were shown as unknown. s-kaupat-mcp has a read-only delivery options tool; the K-Ruoka worker may not report fees.

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| F3.1 | Spike: what each worker reports about fees without choosing a slot. Record findings in [integrations.md](integrations.md) | | Done: S-kaupat reports pickup fees per store and per time without a login or a choice; delivery needs the home address; the K-Ruoka worker reports no fees |
| F3.2 | If F3.1 finds usable data: allow only the read-only fee tool, show the fee or fee range by the total and in the comparison. Otherwise mark F3 Dropped with the reason | F3.1, F2.3 | Done: S-kaupat allows only `get_delivery_options`; the pickup fee range shows under the total and as a comparison row, "not known" for delivery and K-Ruoka. Live check pending |

## 0.4.0: Complete prices

### F4. Prices for weighed goods and unclear packs

Today products sold by the kilo, or with an unreadable pack label, stay unresolved on both chains, so most real baskets have an incomplete total. After F4, weighed products get an approximate price from the kilo price and the needed amount, marked as approximate. An unclear pack can be confirmed once and Korikone remembers it for that product.

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| F4.1 | Spike: how each chain accepts a weighed quantity (K-Ruoka amount and unit, S-kaupat list quantity) and how it reads back. Record in [integrations.md](integrations.md) | | Planned |
| F4.2 | Approximate pricing in matching, kept separate from exact prices in the total, the review and the comparison | F4.1 | Planned |
| F4.3 | Transfer of weighed products, with readback that tolerates the store's rounding | F4.1 | Planned |
| F4.4 | "Confirm pack size" for an unclear label, saved per product and included in backups | | Planned |
| F4.5 | Fixtures with kilo-priced produce and meat for both chains, including a store that refuses a weighed quantity | F4.2, F4.3 | Planned |

### F5. Local price history and offer badges

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| F5.1 | Save each observed price locally: product, store, date, price, unit price. Included in backups, excluded from diagnostics, with a size limit | | Planned |
| F5.2 | Check which workers report offers (the K-Ruoka worker documents personal offers). Record in [integrations.md](integrations.md) | | Planned |
| F5.3 | Badges for "cheaper than usual" and for offers the worker reports | F5.1, F5.2 | Planned |
| F5.4 | Price changes since the last verified transfer, shown in the review | F5.1 | Planned |

## 0.5.0: Learn from purchases

### F6. Order history and recurring-item suggestions

The original design seeded staple cadence from order history. s-kaupat-mcp has read-only order tools; K-Ruoka order history is not established. Suggestions appear under "Unohtuiko jotain?", such as "Maito, bought in 6 of the last 8 weeks". Accepting one makes it a recurring item with that cadence. Nothing becomes recurring on its own.

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| F6.1 | Allow only the read-only S-kaupat order tools and import past orders into a local purchase table. Check whether the K-Ruoka worker offers anything comparable | | Planned |
| F6.2 | Import purchases from saved receipt text where lines can be read; unreadable lines are skipped and counted | F6.1 | Planned |
| F6.3 | Suggestion rules with a confidence threshold; accepting sets the cadence. Update the design rule in [design.md](design.md) | F6.1 | Planned |
| F6.4 | Fixtures for both sources, including empty history and unreadable receipts | F6.2, F6.3 | Planned |

### F7. What changed since last time

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| F7.1 | Compare the review with the latest verified transfer: new items, dropped items, quantity changes, and price changes once F5.1 exists | | Planned |
| F7.2 | Show the changes in the review, with fixtures and a focused UI test | F7.1 | Planned |

### F8. Spending against budget

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| F8.1 | Weekly totals from verified transfers and imported orders, labelled so a transfer is never presented as a purchase | F6.1 | Planned |
| F8.2 | A simple history chart against the weekly budget, in Finnish and English | F8.1 | Planned |

## 0.6.0: Plan the week

### F9. Saved, editable meal calendar

Today the schedule is a suggestion that is not saved. After F9, meals sit on days, can be moved with the mouse or keyboard, leftovers days are possible, and the calendar is kept across restarts. Changing the calendar never changes the shopping list.

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| F9.1 | Saved calendar in state, with migration and backup support | | Planned |
| F9.2 | Move meals by drag and by keyboard; leftovers days | F9.1 | Planned |
| F9.3 | Text export of the week; fixtures and a focused UI test | F9.2 | Planned |

### F10. Recipe import

Paste a recipe's text in Reseptit and get a recipe with ingredients and portions to review before saving. Fetching recipes from a URL is not included.

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| F10.1 | AI conversion of pasted text with the same validation and single retry as notes | | Planned |
| F10.2 | Review form before saving; AI fixtures for success, invalid output and usage limits | F10.1 | Planned |

### F11. Meal ideas from offers

The original goal of planning meals around offers. "Ideas from offers" suggests a few meals that use products on offer at the active store; the shopper adds the ones they want to the note. ChatGPT is used only when the shopper asks.

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| F11.1 | Collect current offers for the active store | F5.2 | Planned |
| F11.2 | Send offers to ChatGPT as untrusted data and show suggestion cards that add to the note | F11.1 | Planned |
| F11.3 | AI fixtures for suggestions, no offers and failures | F11.2 | Planned |

## 0.7.0: Take it to the store

### F12. List to phone by QR code

A QR code containing the shopping list as plain text, read with the phone camera. No server and no account. This does not replace the deferred phone sync.

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| F12.1 | QR code of the text export, split into several codes when the list is too long; fixtures for both cases | | Planned |

### F13. Text recognition for scanned receipts

Today scanned PDFs need OCR outside Korikone. A local OCR library may add 20 to 40 MB to the installer.

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| F13.1 | Spike: Finnish accuracy, installer size and license of a local OCR library. Record in [dependency-decisions.md](dependency-decisions.md) and ask the owner before adopting it | | Planned |
| F13.2 | If accepted: OCR in the receipt worker with the existing limits and timeout; synthetic scanned fixtures | F13.1 | Planned |

## 0.9.0: Beta

### F14. Release readiness

Feature freeze starts with 0.9.0: only fixes and the tasks below.

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| F14.1 | Decide on code signing (cost, SmartScreen warnings) with the owner and record it | | Planned |
| F14.2 | Update check against GitHub Releases; the user chooses when to install | | Planned |
| F14.3 | Clean install, upgrade and uninstall written down as a repeatable procedure | A.3 | Planned |
| F14.4 | Accessibility and keyboard pass over every view | | Planned |
| F14.5 | Local error and crash notes for the diagnostic export, without personal data | | Planned |
| F14.6 | Household pilot: two weeks of real use, issues filed and fixed | All features above | Planned |
