# Korikone roadmap to 1.0.0

Agreed with the owner on 9 October 2026. This page lists the accepted features and splits them into tasks for implementation. New features are added only after the owner accepts them. Proposals and discussion happen in the project's roadmap thread.

## How to use this page

- Work milestone by milestone, and within a milestone in task order, unless a task says it can run in parallel. A task's dependencies must be done first.
- Before starting a task, check the code for its real status. Mark it **In progress** here when you start and **Done** with the commit when it lands. Record anything learned in a spike in the page it names.
- Every task follows [AGENTS.md](../AGENTS.md): development-mode fixtures with success and failure cases at the retailer or AI boundary, focused unit tests, and a focused UI test when the task changes interaction. No task uses the owner's ChatGPT allowance or retailer accounts.
- Each feature ends with one live check by the owner. Ask for it only after the feature's fixture tests pass, and say what to look at and how much ChatGPT use it needs.
- Keep design rules: checkout and payment stay manual, retailer writes need a reviewed batch, and ordering, payment and slot-selection tools stay off the allowlists.
- Update [design.md](design.md), [ux.md](ux.md), [testing.md](testing.md) and [acceptance.md](acceptance.md) when a feature changes behavior they describe.

From 0.5.0 on, each task names what to build, the files involved and a "Done when" check, and an **Agent** level:

- **Simple**: a well-scoped change that follows existing patterns. A smaller coding agent can take it from the card alone. If the card turns out to be ambiguous, or the change needs files or behavior the card does not mention, stop and ask in the roadmap thread instead of guessing.
- **Strong**: needs design judgment, unfamiliar APIs, cross-cutting changes or another repository. After a strong task lands, its agent updates the cards that depend on it with the names and details it found, so they can become Simple.
- **Owner**: needs the owner's decision, account or observation. "Strong, with owner" means a strong agent does the work while the owner is present for the live part.

Status values: **Planned**, **In progress**, **Done**, **Dropped** (with the reason).

## Decisions made with this roadmap

- The store comparison (F2) runs when the shopper asks for it, not after every list change. It doubles catalogue requests, and S-kaupat requests go through a browser window.
- Korikone may suggest recurring items from past purchases (F6). A suggestion becomes a recurring item only when the shopper accepts it. This replaces the earlier rule that no purchase frequency is inferred, once F6 lands.
- Agreed 9 October 2026 with the UX proposals: a live transfer is approved with one labelled confirm button that names the store, product count and total. A separate acknowledgement remains only when the total is over budget or a price rose since it was quoted (U1). This replaces the earlier checkbox on every live transfer.
- Agreed 9 October 2026: the retailer sites open inside Korikone, one private session per chain, and Korikone's own catalogue and cart calls use that session (U3). A chain that refuses the embedded browser keeps its external window. Korikone still never fills in or presses anything on checkout or payment pages. ChatGPT sign-in stays in the default browser.
- Out of scope for 1.0: automatic checkout or payment (permanent), cloud sync and shared household accounts, a browser extension, nutrition goals, other chains, a mobile app.

## Milestones

| Version | Theme | Features |
| --- | --- | --- |
| 0.2.x | Finish the alpha | A |
| 0.3.0 | Both chains at once | F1, F2, F3 |
| 0.4.0 | Smooth flow | U1, U2, U7 |
| 0.5.0 | Stores inside the app | U3, U4, U6 |
| 0.6.0 | Complete prices | F4, F5 |
| 0.7.0 | Learn from purchases | F6, F7, F8, U5 |
| 0.8.0 | Plan the week and take it along | F9, F10, F11, F12, F13 |
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
| A.5 | With an explicitly requested live session, check whether the 1.8-second note pause makes too many ChatGPT requests, and tune it from observed use | Planned |

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

## 0.4.0: Smooth flow

From the UX review of 9 October 2026, done on a development-mode build. Today a transfer takes four clicks, three long scrolls, a checkbox and a page switch, and the same basket appears three times: the list, the review and the basket details.

### U1. Transfer from the list in one click

The total and a "Siirrä S-kauppaan · 25,39 €" button stay pinned at the bottom of the list column, which scrolls on its own. Pressing it opens a confirmation panel on the same page that shows only what needs attention: rows without a product, products whose price or pack changed since they were quoted, cheaper alternatives and anything over budget. When nothing needs attention it says so in one line and the confirm button has focus. The full before and after list is under "Näytä kaikki rivit". Nothing is written to the store until confirm is pressed.

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| U1.1 | Pinned total and transfer bar; the list column scrolls independently of the note column | | Done: the list column is sticky and fits the window, the total and "Siirrä … · total" bar stays at its bottom; `tests/ui/pinned.spec.ts` |
| U1.2 | Confirmation panel on the list page with attention items only, built on the existing review and journal code | U1.1 | Done: `src/ui/confirm.tsx` in the pinned bar; attention items are excluded rows, products already in the cart, cheaper alternatives of the same ingredient and a budget overrun; `tests/ui/confirm.spec.ts` |
| U1.3 | Replace the checkbox with the labelled confirm button; keep an explicit acknowledgement only when over budget or a price rose since quoting. Update [design.md](design.md) and [ux.md](ux.md) | U1.2 | Done: the service asks for an acknowledgement only over budget. A changed price or pack already stops the review in `createReview`, so it never reaches the panel |
| U1.4 | Show the transfer result in the same panel: verified count, what was left out, next step | U1.2 | Done: an interrupted transfer shows its recovery action there too. The Ostoskori page still works until U2.2 |
| U1.5 | Move the F2 comparison into the pinned bar, for example "K-Ruoka 2,10 € halvempi · Vertaa", opening the existing panel | U1.1 | Done: the bar shows "Vertaa kauppoja" and, after comparing, the result such as "S-kaupat 0,30 € halvempi · Vertaa" until the list changes. Comparing still runs only when pressed, since it searches the other chain for every row |

### U2. One basket view instead of three

The Ostoskori page leaves the navigation. Its decision details (why a product was chosen, unit price, surplus, alternatives) open from the row on the list. Vakiotuotteet moves under Asetukset or into "Unohtuiko jotain?".

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| U2.1 | Row detail drawer with the basket details from today's Ostoskori page | | Done: the product name opens `src/ui/details.tsx` under the row: needed and bought amounts, surplus, why this product, unit prices, deposits, hidden products and the other products with "Valitse tuote"; `tests/ui/details.spec.ts` |
| U2.2 | Remove the Ostoskori page and its "Tarkista korin muutokset" button; recovery of an interrupted transfer moves into the U1 panel | U1.2, U2.1 | Done: the page and its nav item are gone; an interrupted transfer shows "Edellinen siirto keskeytyi · Tarkista" in the bar, and the demo-store scenarios moved under the list. `tests/ui/journey.spec.ts` now runs the whole demo transfer and recovery from the list |
| U2.3 | Quieter rows: quantity and price always visible; home, remove and alternatives on hover, focus or in the drawer, reachable by keyboard | U2.1 | Done: home and remove appear on hover or focus (always on touch screens); "Vaihda tuotetta" and the swap line moved into the details; a row only shows "Edullisempi vaihtoehto" with the saving. Look-alikes such as chicken mince no longer count as cheaper at live stores |
| U2.4 | Navigation without Ostoskori; Vakiotuotteet under Asetukset or in "Unohtuiko jotain?"; desktop tests updated | U2.2 | Done: the nav is Ostoslista, Viikkosuunnitelma, Reseptit, Historia and Asetukset. The editor opens from Asetukset and from "Muokkaa vakiotuotteita" in "Unohtuiko jotain?" |

### U7. Readable text

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| U7.1 | Raise secondary text (hints, store name, "Korissa nyt", help lines) to WCAG AA contrast, 4.5:1, in Finnish and English. This covers colour for F14.4 | | Done: 15 grey-green text colours darkened to at least 4.5:1 on every light background; `tests/contrast.test.ts` checks the stylesheet. Faded "at home" rows and disabled buttons are inactive states and keep their lower contrast |

## 0.5.0: Stores inside the app

The S-kaupat and K-Ruoka sites open inside Korikone in a "Kauppa" view with a tab per chain. Signing in happens there once per chain. After a transfer the tab opens on the K-Ruoka cart or the S-kaupat Korikone list, and checkout happens in the same window. Korikone's searches and cart writes run in that same session, so the shopper sees exactly the account and cart Korikone changed. No Edge, Chrome or default-browser window opens for shopping.

Start with the spikes. If a chain refuses Electron's built-in Chromium, or its login needs a provider that refuses embedded windows, that chain keeps today's external window and the result is recorded here. The spikes load the real store sites, so they need the owner's go-ahead and stay read-only: no list or cart writes, no checkout pages. After each spike, the agent that ran it rewrites the cards that depend on it with the APIs and file names it found.

### U3. Store sessions inside Korikone

| ID | Task, and done when | Agent | Depends on | Status |
| --- | --- | --- | --- | --- |
| U3.1 | Spike: open s-kaupat.fi in an Electron `WebContentsView` with `session.fromPartition("persist:s-kaupat")`, sign in by hand, and repeat one read-only GraphQL call that s-kaupat-mcp makes, from the page context. Done when [integrations.md](integrations.md) records: whether the site and its bot protection accept the view (and with which user agent), the login providers on offer and whether each works embedded, where the session token lives, whether `fetch` from the page succeeds, and whether bank redirects at checkout open as new windows. Throwaway code stays out of `src/` | Strong, with owner | | In progress: findings in [integrations.md](integrations.md#s-kaupat-inside-an-electron-view-u31-9-october-2026). Site, login, session storage and page `fetch` work in a `WebContentsView`; still to record which login providers the page offers. Payment-window handling stays open until the first checkout in U3.4 |
| U3.2 | Spike: the same for k-ruoka.fi with `persist:k-ruoka`, plus which site endpoints k-ruoka-mcp calls for search, cart read and cart write. Done when [integrations.md](integrations.md) records the same answers as U3.1, and [dependency-decisions.md](dependency-decisions.md) records the choice: an upstream host-page mode for k-ruoka-mcp, or a Korikone K-Ruoka client in `src/stores/`, with the reason | Strong, with owner | | Planned |
| U3.3 | s-kaupat-mcp (separate repository): a mode where the host app passes in the page that runs API calls, keeping today's own-browser mode as the default. Done when it is released with checksums, pinned in `scripts/prepare-s-kaupat.mjs` and `src/stores/s-kaupat.ts` like 1.2.0, and its demo-mode contract test in `tests/s-kaupat.test.ts` passes | Strong | U3.1 | Planned |
| U3.4 | Store view in `src/main/`: a "Kauppa" entry in the navigation that shows one `WebContentsView` tab per signed-in chain, with persistent partitions `persist:s-kaupat` and `persist:k-ruoka`. Store pages get no preload, `nodeIntegration: false`, `sandbox: true`; `setWindowOpenHandler` opens popups and payment redirects as views in the same tab; navigation outside the chain's own domains and known payment domains asks first. Done when a desktop test in development mode opens the fixture site from U3.8 in the tab, a popup stays inside it, and `window.korikone` is undefined in the store page | Strong | U3.1 | Planned |
| U3.5 | Sign-in through the store tab: "Kirjaudu kauppaan" in setup and Asetukset opens that chain's tab on its login page, and Korikone counts the chain as signed in once the tab's session reports an account. Remove the external login windows for chains that passed their spike. Done when `tests/ui/setup.spec.ts` and `tests/ui/chains.spec.ts` cover sign-in through the fixture site, and the chain keeps its login after an app restart | Strong | U3.3, U3.4 | Planned |
| U3.6 | "Avaa kaupan ostoskori" in the transfer result switches to the Kauppa view and loads the chain's cart page (K-Ruoka) or the Korikone list page (S-kaupat) in its tab instead of calling `shell.openExternal`. Done when a desktop test in development mode checks the tab's URL after a fixture transfer, and the old external handoff remains only for chains that failed their spike | Simple | U3.4 | Planned |
| U3.7 | K-Ruoka through the store session, as chosen in U3.2. Done when `src/stores/k-ruoka.ts` (or its replacement) passes `tests/k-ruoka.test.ts` against mocked page responses for search, cart read, cart write and an expired login, and the review still binds to the account | Strong | U3.2, U3.4 | Planned |
| U3.8 | Development fixture site: a small local HTML site served from the app in development mode only, with a login page, a product page, a cart page and a Korikone list page, plus a popup link. The store view loads it instead of the real site whenever development mode is on. Done when no test can reach s-kaupat.fi or k-ruoka.fi, checked by a test that fails on any request to those hosts | Simple | U3.4 | Planned |

### U4. S-kaupat list to cart without extra clicks

| ID | Task, and done when | Agent | Depends on | Status |
| --- | --- | --- | --- | --- |
| U4.1 | Spike: in the S-kaupat tab, find how the site's own "Lisää kaikki ostoskoriin" works (a page function, a request, or only the button) and how to read the cart back afterwards. Cart only; never open checkout. Done when [integrations.md](integrations.md) records the mechanism and whether it is reliable enough to automate | Strong, with owner | U3.5 | Planned |
| U4.2 | If U4.1 says yes: after a verified S-kaupat transfer, Korikone adds the Korikone list to the cart in the tab, reads the cart back, shows "Lisätty ostoskoriin: n / n" in the result, and opens the cart page. If not: open the tab on the Korikone list with the button scrolled into view. Done when the fixture site covers success, a partial add and a failure, each with a desktop test | Strong | U4.1, U3.8 | Planned |

### U6. Shorter setup

| ID | Task, and done when | Agent | Depends on | Status |
| --- | --- | --- | --- | --- |
| U6.1 | One setup screen in `src/ui/setup.tsx`: store search by town or postcode, sign in through the store tab, an optional "Continue with ChatGPT" button, and "Valmis". Heading at most 32 px so every action is visible at 1280 × 800 without scrolling. Done when `tests/ui/setup.spec.ts` goes from first launch to the empty list in one screen and asserts the actions are inside the viewport | Simple | U3.5 | Planned |
| U6.2 | Remove the second-chain section from setup. Offer it in two places: a one-line hint under the pinned total ("Vertaa K-Ruokaan: kirjaudu sisään") shown only when one chain is signed in, and in Asetukset. Done when `tests/ui/chains.spec.ts` covers both entry points and the hint disappears once both chains are signed in | Simple | U6.1 | Planned |
| U6.3 | A fixture desktop test from first launch to a transferred list, counting clicks: setup, note, transfer, confirm. Done when it passes and asserts no external window or `shell.openExternal` call happens in development mode | Simple | U6.1, U3.6 | Planned |

## 0.6.0: Complete prices

### F4. Prices for weighed goods and unclear packs

Today products sold by the kilo, or with an unreadable pack label, stay unresolved on both chains, so most real baskets have an incomplete total. After F4, weighed products get an approximate price from the kilo price and the needed amount, marked as approximate. An unclear pack can be confirmed once and Korikone remembers it for that product.

F4.1 and F4.3 use the in-app store sessions from U3 where a chain has one.

| ID | Task, and done when | Agent | Depends on | Status |
| --- | --- | --- | --- | --- |
| F4.1 | Spike: how each chain reports kilo prices in search results (`priceUnit`, approximate flags), and how it accepts and reads back a weighed quantity in the K-Ruoka cart and the S-kaupat list. Read-only unless the owner runs the write check. Done when [integrations.md](integrations.md) records field names, units and rounding for both chains, with one saved, anonymised search result per chain added under `tests/fixtures/` | Strong, with owner | U3.7 | Planned |
| F4.2 | Approximate pricing in `src/domain/planner.ts` matching: a product priced per kg or l gets `approximate: true` and a total from the needed amount. The list row shows "noin 2,40 €", the pinned total shows exact and approximate parts separately ("23,10 € + noin 4,80 €"), and the comparison counts approximate rows as priced but labels the difference as approximate. Done when `tests/domain.test.ts` covers the arithmetic and rounding, and a desktop test shows the split total | Strong | F4.1 | Planned |
| F4.3 | Transfer of weighed products using the quantity format from F4.1. Readback accepts the store's rounding within the tolerance F4.1 recorded. Done when `tests/service.test.ts` covers a weighed write, a rounded readback and a refused quantity, through the demo providers | Strong | F4.1 | Planned |
| F4.4 | "Vahvista pakkauskoko" on a row whose product has an unreadable pack label: the shopper enters the size and unit once, and it is saved per product ID in a new state field with a schema default, included in backups. Done when `tests/domain.test.ts` checks the saved size is used for matching, `tests/persistence.test.ts` checks an older profile still loads, and a desktop test confirms a size | Simple | | Planned |
| F4.5 | Development fixtures for kilo-priced produce and meat for both chains in `src/stores/demo.ts`, including a chain that refuses a weighed quantity. Done when `tests/development.test.ts` builds a basket with bananas by the kilo and minced meat and checks the split total | Simple | F4.2, F4.3 | Planned |

### F5. Local price history and offer badges

| ID | Task, and done when | Agent | Depends on | Status |
| --- | --- | --- | --- | --- |
| F5.1 | Save every observed product price in the SQLite store under its own key prefix, not in `AppState`: product ID, chain, store ID, date, price, unit price. Keep at most 365 days and at most 20,000 entries, oldest dropped first. Include it in backup export and import, exclude it from `src/application/diagnostics.ts`. Done when `tests/persistence.test.ts` checks the limits and a backup round trip, and the diagnostics test checks no prices appear | Simple | | Done: `src/domain/prices.ts` keeps one entry per product, store and day under `prices:observations`, written after each pricing run; backups carry it as `priceHistory` (older releases ignore it) and import accepts files without it; diagnostics never include it. Tests in `tests/persistence.test.ts` and `tests/service.test.ts` |
| F5.2 | Check which workers report offers or campaign prices (k-ruoka-mcp documents personal offers; check s-kaupat-mcp search fields). Done when [integrations.md](integrations.md) lists the tool, field and meaning for each chain, or says none | Strong | | Planned |
| F5.3 | Badges on list rows: "Tarjous" when the worker marks an offer (F5.2), and "Halvempi kuin yleensä" when today's unit price is at least 10 % below the median of that product's last 8 observations, needing at least 4. Done when `tests/domain.test.ts` covers the threshold and the minimum count, and a desktop test shows both badges from fixture history | Simple | F5.1, F5.2 | Planned |
| F5.4 | In the confirm panel, list products whose price rose by more than 5 % since the last verified transfer that included them. Done when `tests/service.test.ts` and `tests/ui/confirm.spec.ts` cover a rise, a fall (not shown) and a product never bought before (not shown) | Simple | F5.1 | Planned |

## 0.7.0: Learn from purchases

### F6. Order history and recurring-item suggestions

The original design seeded staple cadence from order history. s-kaupat-mcp has read-only order tools; K-Ruoka order history is not established. Suggestions appear under "Unohtuiko jotain?", such as "Maito, bought in 6 of the last 8 weeks". Accepting one makes it a recurring item with that cadence. Nothing becomes recurring on its own.

| ID | Task, and done when | Agent | Depends on | Status |
| --- | --- | --- | --- | --- |
| F6.1 | Add only `get_orders` and `get_order_items` to `S_KAUPAT_TOOLS` in `src/stores/s-kaupat.ts`, import completed orders into a local purchase table (date, chain, product ID, name, quantity, unit, price) under its own SQLite key prefix, included in backups and excluded from diagnostics. Record in [integrations.md](integrations.md) whether K-Ruoka offers anything similar. Done when `tests/s-kaupat.test.ts` imports demo-mode orders and an ordering tool is still refused | Strong | | Planned |
| F6.2 | Import purchases from the saved receipt text: one line per product with a name and a euro amount. Add synthetic K-group and S-group receipt text fixtures that copy the line layout of one real receipt of each, supplied by the owner, with no personal data. Unreadable lines are skipped and counted. Done when `tests/receipts.test.ts` covers both formats, a discount line, a deposit line and an unreadable line | Strong, with owner | F6.1 | Planned |
| F6.3 | Suggestion rule: suggest a product bought in at least 4 of the last 8 weeks that is not already a recurring item, with the median gap between purchases as its cadence in days. Show at most 5 under "Unohtuiko jotain?" with "Lisää vakiotuotteeksi" and "Ei kiitos"; a dismissed product is not suggested again for 90 days. Update the rule in [design.md](design.md). Done when `tests/domain.test.ts` covers the threshold, cadence, dismissal and an empty history, and a desktop test accepts one suggestion | Simple | F6.1 | Planned |
| F6.4 | Development fixtures: demo order history for both chains, an empty history, and receipts that cannot be read. Done when `tests/development.test.ts` produces the expected suggestions from each | Simple | F6.2, F6.3 | Planned |

### F7. What changed since last time

| ID | Task, and done when | Agent | Depends on | Status |
| --- | --- | --- | --- | --- |
| F7.1 | A pure function in `src/domain/` that compares the current review with the latest verified transfer in `listHistory`: new products, dropped products, quantity changes, and price changes when F5.1 has them. Done when unit tests cover each case, an empty history and a changed store | Simple | | Planned |
| F7.2 | Show the changes in the confirm panel under "Muutokset edelliseen", collapsed when there are none. Done when `tests/ui/confirm.spec.ts` covers a second transfer with one new, one dropped and one changed product | Simple | F7.1 | Planned |

### F8. Spending against budget

| ID | Task, and done when | Agent | Depends on | Status |
| --- | --- | --- | --- | --- |
| F8.1 | Weekly totals (Monday to Sunday) from imported orders (F6.1) and, where no order exists, verified transfers, each labelled with its source so a transfer is never shown as a purchase. Done when unit tests cover weeks with orders only, transfers only, both and neither | Simple | F6.1 | Planned |
| F8.2 | A bar chart in Historia of the last 12 weeks against the weekly budget line, Finnish and English, with a text table for screen readers. No chart library; plain SVG. Done when a desktop test checks the bars and the budget line from fixture data | Simple | F8.1 | Planned |

### U5. Purchases recorded without "Olen tehnyt tilauksen"

After checkout Korikone notices the order and updates recurring items itself. The button stays as a fallback.

| ID | Task, and done when | Agent | Depends on | Status |
| --- | --- | --- | --- | --- |
| U5.1 | Detect a completed order in the store tab from the order confirmation page URL (recorded during U3.1 and U3.2), never reading page content on payment domains. Match it to the latest verified transfer for that chain and call the existing `confirmPurchase` path. Done when the fixture site has a confirmation page and a desktop test checks recurring items advance without pressing the button | Strong | U3.4 | Planned |
| U5.2 | Also confirm the purchase when an imported order (F6.1) contains at least half of the transferred products within 3 days of the transfer. Done when unit tests cover a match, a partial match below the threshold and an order without a transfer | Simple | U5.1, F6.1 | Planned |

## 0.8.0: Plan the week and take it along

### F9. Saved, editable meal calendar

Today the schedule is a suggestion that is not saved. After F9, meals sit on days, can be moved with the mouse or keyboard, leftovers days are possible, and the calendar is kept across restarts. Changing the calendar never changes the shopping list.

| ID | Task, and done when | Agent | Depends on | Status |
| --- | --- | --- | --- | --- |
| F9.1 | A `calendar` field in `stateSchema` (`src/domain/model.ts`): date (ISO) to a list of meal IDs plus a leftovers flag, with a schema default of empty so older profiles and backups load. Done when `tests/persistence.test.ts` loads an older profile and round-trips a backup with a calendar | Simple | | Planned |
| F9.2 | Viikkosuunnitelma shows 7 days from today with the cooked meals on the list. Meals move by drag and drop and by keyboard (focus a meal, arrow keys change the day). A day can be marked "Tähteitä". Done when a desktop test moves a meal by both methods, restarts the app, and checks the shopping list total is unchanged | Strong | F9.1 | Planned |
| F9.3 | "Kopioi viikko" puts a plain-text week (day name, date, meals) on the clipboard, using the existing clipboard path. Done when a desktop test checks the text in Finnish and English | Simple | F9.2 | Planned |

### F10. Recipe import

Paste a recipe's text in Reseptit and get a recipe with ingredients and portions to review before saving. Fetching recipes from a URL is not included.

| ID | Task, and done when | Agent | Depends on | Status |
| --- | --- | --- | --- | --- |
| F10.1 | "Tuo resepti tekstistä" sends the pasted text to the AI provider as untrusted data with a prompt that returns one recipe in the existing `recipeSchema` shape, validated with the same single corrective retry as notes in `src/ai/draft.ts`. Add AI fixtures for success, invalid output and usage limit in `src/ai/fixtures.ts`. Done when `tests/ai.test.ts` covers all three | Strong | | Planned |
| F10.2 | The draft opens in the existing recipe form in `src/ui/main.tsx` for review; nothing is saved until "Tallenna". Done when a desktop test imports a fixture recipe, edits one amount and saves it | Simple | F10.1 | Planned |

### F11. Meal ideas from offers

The original goal of planning meals around offers. "Ideas from offers" suggests a few meals that use products on offer at the active store; the shopper adds the ones they want to the note. ChatGPT is used only when the shopper asks.

| ID | Task, and done when | Agent | Depends on | Status |
| --- | --- | --- | --- | --- |
| F11.1 | Collect up to 30 current offers for the active store through the source F5.2 found. Done when the adapter test for that chain covers offers, no offers and an error | Strong | F5.2 | Planned |
| F11.2 | "Ideoita tarjouksista" sends the offers to the AI provider as untrusted data and shows up to 4 meal cards; "Lisää muistiinpanoon" appends the meal name to the note. Done when a desktop test adds one idea and the note updates | Strong | F11.1 | Planned |
| F11.3 | AI fixtures for ideas, no offers and failure. Done when `tests/development.test.ts` covers all three without a live request | Simple | F11.2 | Planned |

### F12. List to phone by QR code

A QR code containing the shopping list as plain text, read with the phone camera. No server and no account. This does not replace the deferred phone sync.

| ID | Task, and done when | Agent | Depends on | Status |
| --- | --- | --- | --- | --- |
| F12.1 | "Näytä QR-koodi" under the copy and save actions shows the text export as one QR code, or several numbered codes when it exceeds 1,000 bytes. Choose a small, maintained, permissively licensed QR library, pin it, and add it to the notices. Done when a unit test splits a long list and a desktop test shows one and three codes | Simple | | Planned |

### F13. Text recognition for scanned receipts

Today scanned PDFs need OCR outside Korikone. A local OCR library may add 20 to 40 MB to the installer.

| ID | Task, and done when | Agent | Depends on | Status |
| --- | --- | --- | --- | --- |
| F13.1 | Spike: Finnish accuracy on synthetic scanned receipts, installer size and license of a local OCR library. Done when [dependency-decisions.md](dependency-decisions.md) records the numbers and the owner has said whether to adopt it | Strong, with owner | | Planned |
| F13.2 | If adopted: OCR inside the receipt worker in `src/receipts/` for image-only PDFs, with the existing size, page and timeout limits. Done when `tests/receipts.test.ts` reads a synthetic scanned fixture and a too-slow file still times out | Strong | F13.1 | Planned |

## 0.9.0: Beta

### F14. Release readiness

Feature freeze starts with 0.9.0: only fixes and the tasks below.

| ID | Task, and done when | Agent | Depends on | Status |
| --- | --- | --- | --- | --- |
| F14.1 | Decide on code signing with the owner: cost, certificate type, SmartScreen behaviour. Done when [pre-release.md](pre-release.md) records the decision | Owner | | Planned |
| F14.2 | Check GitHub Releases for a newer version at startup at most once a day; show "Uusi versio saatavilla" with a link to the release page. No automatic download. Done when a unit test with a mocked releases response covers newer, same and failed checks | Simple | | Planned |
| F14.3 | Write the clean install, upgrade and uninstall procedure in [acceptance.md](acceptance.md) as numbered steps with expected results | Simple | A.3 | Planned |
| F14.4 | Keyboard and screen-reader pass over every view: every control reachable by Tab, visible focus, labels on icon buttons. Done when a desktop test tabs through the list, confirm panel and Asetukset and checks focus order and accessible names | Simple | | Planned |
| F14.5 | Keep the last 50 error messages (code, time, view) locally and include them in the diagnostic export, with no product names, notes or account data. Done when the diagnostics test checks the redaction | Simple | | Planned |
| F14.6 | Household pilot: two weeks of real use by the owner's household. Issues filed and fixed before 1.0.0 | Owner | All features above | Planned |
