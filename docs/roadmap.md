# Korikone roadmap to 1.0.0

Agreed with the owner on 9 October 2026. This page lists the accepted features and splits them into tasks for implementation. New features are added only after the owner accepts them. Proposals and discussion happen in the project's roadmap thread.

## How to use this page

- Work milestone by milestone, and within a milestone in task order, unless a task says it can run in parallel. A task's dependencies must be done first.
- Before starting a task, check the code for its real status. Mark it **In progress** here when you start and **Done** with the commit when it lands. Record anything learned in a spike in the page it names.
- Every task follows [AGENTS.md](../AGENTS.md): development-mode fixtures with success and failure cases at the retailer or AI boundary, focused unit tests, and a focused UI test when the task changes interaction. No task uses the owner's ChatGPT allowance or retailer accounts.
- Each feature ends with one live check by the owner. Ask for it only after the feature's fixture tests pass, and say what to look at and how much ChatGPT use it needs.
- Keep design rules: checkout and payment stay manual, retailer writes need approval of the displayed batch (the initial transfer button under U10, or an exception confirmation if that batch changes), and ordering, payment and slot-selection tools stay off the allowlists.
- Update [design.md](design.md), [ux.md](ux.md), [testing.md](testing.md) and [acceptance.md](acceptance.md) when a feature changes behavior they describe.

From 0.5.0 on, each task names what to build, the files involved and a "Done when" check, and an **Agent** level:

- **Simple**: a well-scoped change that follows existing patterns. A smaller coding agent can take it from the card alone. If the card turns out to be ambiguous, or the change needs files or behavior the card does not mention, stop and ask in the roadmap thread instead of guessing.
- **Strong**: needs design judgment, unfamiliar APIs, cross-cutting changes or another repository. After a strong task lands, its agent updates the cards that depend on it with the names and details it found, so they can become Simple.
- **Owner**: needs the owner's decision, account or observation. "Strong, with owner" means a strong agent does the work while the owner is present for the live part.

Status values: **Planned**, **In progress**, **Done**, **Dropped** (with the reason).

## Decisions made with this roadmap

- The store comparison (F2) runs when the shopper asks for it, not after every list change. It doubles catalogue requests, and S-kaupat requests go through a browser window.
- Korikone may suggest recurring items from past purchases (F6). A suggestion becomes a recurring item only when the shopper accepts it. This replaces the earlier rule that no purchase frequency is inferred, once F6 lands.
- Agreed 9 October 2026 with the UX proposals: U1 replaced the checkbox on every live transfer with a labelled confirm button. U10 supersedes its routine second confirmation: the initial transfer button approves the displayed batch; only exceptions require another decision.
- Agreed 9 October 2026: the retailer sites open inside Korikone, one private session per chain, and Korikone's own catalogue and cart calls use that session (U3). A chain that refuses the embedded browser keeps its external window. Korikone still never fills in or presses anything on checkout or payment pages. ChatGPT sign-in stays in the default browser.
- Agreed 9 October 2026: note interpretation and its list update require an explicit "Päivitä lista" / "Update list" action (U8). Ctrl+Enter performs the same action. Typing, opening the shopping view and restoring an edited note do not start interpretation. Opening the view also reuses the last priced list instead of starting catalogue requests. Implement U8 next, before starting the 0.5.0 store-view work. This replaces the automatic 1.8-second pause rule and drops A.5.
- Agreed 9 October 2026: the store name and pickup/delivery label above the shopping note become controls for changing those choices in place (U9). Opening a selector starts no list update; only confirming a changed choice updates the shopping context and affected prices. Pickup/delivery selection does not select a time slot or place an order.
- Agreed 9 October 2026: one transfer action checks, writes and verifies the displayed batch, then automatically opens the retailer destination (U10). No routine second confirmation or separate open-cart click. Changed prices or packs, unavailable products, budget overruns, unexpected existing quantities and uncertain transfers interrupt the flow. K-Ruoka opens its basket; S-kaupat opens the Korikone shopping list until U4 establishes reliable basket access. Investigate S-kaupat at U4.1 after the store-session work, without assuming direct basket access is possible.
- Agreed 9 October 2026: show a compact, changeable AI model selector below the note and the same saved choice in a separate "ChatGPT ja tekoäly" / "ChatGPT and AI" card near the top of Asetukset (U11). Automatic is the default and prefers a small, low-cost model available to the connected account. Settings explains that rule. Changing the choice affects the next AI request; it never submits the note or reprices the list.
- Out of scope for 1.0: automatic checkout or payment (permanent), cloud sync and shared household accounts, a browser extension, nutrition goals, other chains, a mobile app.

## Milestones

| Version | Theme | Features |
| --- | --- | --- |
| 0.2.x | Finish the alpha | A |
| 0.3.0 | Both chains at once | F1, F2, F3 |
| 0.4.0 | Smooth flow | U1, U2, U7, U8, U9, U10, U11 |
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
| A.5 | With an explicitly requested live session, check whether the 1.8-second note pause makes too many ChatGPT requests, and tune it from observed use | Dropped (9 October 2026): U8 removes automatic note submission; no pause to tune |

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

This describes the completed U1 implementation. U10 replaces the routine confirmation and manual storefront-opening step; keep U1's completed cards as implementation history.

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

### U8. Update the shopping list only when asked

Typing in the note leaves the current meals, shopping rows and prices unchanged. A visible, labelled "Päivitä lista" / "Update list" button applies the note; Ctrl+Enter is the keyboard shortcut. When the note differs from the one used for the current list, show "Muistiinpanoa ei ole päivitetty listaan" / "Note changes have not been applied to the list". Loading appears only while an explicitly requested update runs. Reopening the shopping view restores the current list and last quoted prices without interpreting the note or fetching the catalogue. Prices are last quoted values; transfer review still checks current prices before any retailer write. Explicit product, quantity and store changes keep their required pricing behavior.

| ID | Task, and done when | Agent | Depends on | Status |
| --- | --- | --- | --- | --- |
| U8.1 | In `src/ui/shopping.tsx`, remove the automatic note-submission timer. Replace the arrow-only update control with the labelled button, keep Ctrl+Enter, and show when note edits have not been applied, in Finnish and English. Keep one update at a time, cancellation, obsolete-response protection and the existing bounded validation retry. Editing during a request must not submit a follow-up request. Done when `tests/ui/shopping.spec.ts` uses development fixture counts to prove that typing, waiting beyond the old pause, returning to the view and restoring an edited note start zero generations; button and shortcut each start one; cancellation, failure and edits during a request preserve the current list until an explicit successful update | Simple | | Done (4b55c80): labelled button, Ctrl+Enter and unapplied-note hint; fixture counts prove zero automatic generations and preserve cancellation and obsolete-response behavior |
| U8.2 | Remove the unconditional view-open `buildBasket` request in `src/ui/shopping.tsx`. Inspect `src/application/service.ts` and persistence to determine where the last basket and its quote context must be retained, including across app restart. Reuse that basket on view entry without catalogue calls, identify prices as last quoted, and invalidate incompatible quotes after a store or list change. Keep explicit row changes and transfer review working, including fresh price validation before writes. Done when focused service and development-mode UI tests cover view return, restart, no previous quote, changed store, an explicit list update and a price rise at transfer review; opening the unchanged list causes no catalogue calls. Update the affected design and persistence documentation with the chosen representation | Strong | | Done: `5d73dd5`; validated `last-quote` cache, explicit repricing and retry, fresh transfer checks; focused unit/SQLite and desktop fixtures passed |
| U8.3 | Update `README.md`, `docs/design.md`, `docs/ux.md`, `docs/testing.md` and `docs/acceptance.md` to describe explicit updates and retained quotes. Adjust affected UI fixtures and tests that previously relied on typing to submit. Done when the affected focused tests pass and documentation no longer promises automatic note submission. Record an owner check: edit the note, leave and return, restart, then update by button and shortcut; verify stable rows and prices before updating and clear progress during the update. The owner check needs two explicit ChatGPT generations if run live; all automated checks use local fixtures | Simple | U8.1, U8.2 | Done: documentation/fixture alignment `9b06d60`, owner observations `d4880f7`; focused checks passed; interactive development-mode check confirmed editing, view return, restart with retained quotes, and explicit button/Ctrl+Enter updates with progress; no live requests |

U8.2 implementation for follow-up work: `src/application/quotes.ts` binds the separate `last-quote` cache to pricing inputs; development uses `development:last-quote`. Snapshots expose `quotedAt`, `pricingError` and fixture-only `developmentCatalogueRequests`. `Service.refreshAfterChange(() => service.save(next))` refreshes changed pricing inputs and returns saved edits as unpriced if fetching fails. U8.3 should finish README and remaining fixture/documentation alignment and record the owner check. U9.1 must separately establish retailer context-change success and failure semantics; the current S-kaupat selection remains best effort.

### U9. Change store and pickup or delivery from the shopping header

The store name and "Nouto" / "Pickup" or "Toimitus" / "Delivery" above the note are visibly clickable, keyboard-accessible controls. Clicking the store name opens a compact selector with remembered stores and the existing store search. Clicking the fulfillment label opens pickup/delivery choices. Both selectors stay on the shopping page, show the current choice, and have confirm and cancel actions. Cancel or Escape preserves the current choice and returns focus to the label. Confirming a change preserves the typed note, meals and grocery requirements; it refreshes affected prices and fees without calling ChatGPT. Opening a selector does not start catalogue requests; an explicit store search may do so.

The fulfillment control must work for supported live-store contexts, not only demo stores. Korikone must explain an unavailable option or a required retailer step rather than claim the retailer's delivery method has changed. Delivery address, time-slot selection, checkout and payment remain in the retailer's flow.

| ID | Task, and done when | Agent | Depends on | Status |
| --- | --- | --- | --- | --- |
| U9.1 | Define and implement the context-change behavior in `src/application/service.ts`, using the existing `save` and `searchStores` paths and the per-chain `stores` state in `src/domain/model.ts`. Inspect why live fulfillment changes are disabled in `src/ui/main.tsx` and determine what each adapter can support without retailer writes or slot selection. Record the limitation and local-versus-retailer meaning in `docs/integrations.md`. Keep the selected context and per-chain remembered store consistent, invalidate reviews and incompatible quotes after a confirmed change, and refresh affected prices and fees while preserving the note and requirements. Add deterministic success, unavailable-option and adapter-failure fixtures. Done when focused service and development tests cover changing stores within a chain, switching to a remembered store in the other chain, pickup/delivery changes and failure without falsely reporting a completed change. Update U9.2 with the exact APIs and any retailer limitations found | Strong | U8.2 | Done: `bf38cab`; confirmed context/options IPC, pre-save pricing, remembered stores and deterministic failure handling; 12 focused unit cases and real IPC/restart fixture passed; live pickup-only limitation recorded in integrations |
| U9.2 | Replace the context spans in `src/ui/main.tsx` with accessible buttons and in-place selectors, reusing `src/ui/chains.tsx` and the existing Settings/setup store-search behavior where useful. Use `getContextOptions(context?)` and its snapshot `contextOptions: { context, fulfillments }`; propose only current, remembered or `searchStores` results. Confirm with `changeContext({ context, revision })` and apply its returned snapshot; do not use the legacy Settings `save` path for header changes. Live adapters currently offer pickup only; explain unavailable delivery without claiming a retailer address or time was selected. Development has pickup/delivery, `alternate` and `pickup-only` search fixtures, and `context`/`catalogue` failure scenarios. If confirmation succeeds with `pricingError`, show the saved context as unpriced with retry. See `docs/integrations.md` for local-versus-retailer semantics. Add Finnish and English labels, current-choice indicators, confirm/cancel, Escape, focus return, loading and error states. Keep the typed note when a selector opens or a choice changes. Done when a focused development-mode desktop test covers mouse and keyboard use, cancellation, store search with no results and an error, successful store and fulfillment changes, and an unavailable fulfillment option. Fixture counters prove opening/cancelling starts no catalogue or AI requests, and confirming a change starts no AI request | Simple | U9.1 | Done: `216fee4`; Finnish/English inline selectors, provisional choices, confirm/cancel/Escape, focus return, errors/retry and fixture request counters; focused unit/desktop, build, formatting and desktop/narrow visual checks passed |
| U9.3 | Update `docs/ux.md`, `docs/design.md`, `docs/testing.md` and `docs/acceptance.md` with the header controls and their price/context behavior. Done when the affected focused checks pass and an owner check is recorded: open both highlighted labels, cancel each, then change store and fulfillment; verify the note and groceries stay intact and prices/fees reflect the chosen context. The live owner check needs read-only retailer access and no ChatGPT generations; request it only after fixture checks pass | Simple | U9.2 | Done: documentation/UI `216fee4`, owner observations `7b0e6da`; development-mode interactive check confirmed cancel/Escape, focus return, store repricing and pickup/delivery changes with note/groceries preserved; live pickup-only limitation remains documented |

### U10. Transfer and open the storefront in one action

The pinned button names the destination, product count and quoted total: "Siirrä ja avaa K-Ruoan ostoskori" / "Transfer and open K-Ruoka basket", or "Siirrä ja avaa S-kaupat-lista" / "Transfer and open S-kaupat list". Its first press approves the displayed batch. Korikone checks the current account, store, products, prices and basket, transfers that batch, journals every write and verifies the result in the background. Show progress while this runs, then open the actual retailer destination automatically. Keep storefront basket interaction out of the transfer phase so the shopper cannot unknowingly edit quantities while Korikone writes.

Show an exception panel only when the checked batch differs from the displayed one, products cannot be transferred, the budget is exceeded, existing quantities would receive unexpected additions, or a previous transfer needs reconciliation. Explain the change and require a decision before writing the affected batch. Cheaper alternatives remain available on shopping rows without blocking an otherwise valid transfer. A repeated press or reopening the same verified batch must not add it again; opening the destination is safe, and an intentional additional transfer needs explicit approval. An interrupted or uncertain write uses reconciliation rather than a blind retry. Failure to open the storefront after a verified transfer offers an open-only retry, never another transfer. Checkout and payment remain manual; a verified transfer is not a purchase.

S-kaupat continues through the Korikone shopping list. U4.1 investigates reliable basket access later; until then the label and result must describe a list, and the retailer's "Lisää kaikki ostoskoriin" remains the shopper's next step.

| ID | Task, and done when | Agent | Depends on | Status |
| --- | --- | --- | --- | --- |
| U10.1 | Add service orchestration in `src/application/service.ts` around `prepare`, `execute` and the checks/journal in `src/application/transfer.ts`. Bind approval to the displayed products, quantities, quote, revision and context; the background check cannot silently substitute a different batch. Define structured exceptions for changed prices/packs, unavailable rows, budget and existing quantities. Retain account/cart-change checks and partial-transfer recovery. Persist enough batch identity to prevent duplicate additions after a second press, view return or restart; intentional additional quantities require fresh explicit approval. Update downstream cards with the API and persistence fields found. Done when focused `tests/service.test.ts`, transfer and persistence tests cover a normal transfer, each exception, concurrent/repeated presses, restart after success, a changed cart/account and an uncertain write with reconciliation. All retailer responses use deterministic fixtures | Strong | U1.4 | Done: source implementation and focused local fixture checks passed; release verification underway |
| U10.2 | In `src/ui/shopping.tsx` and `src/ui/confirm.tsx`, make the first transfer click use U10.1; remove the quiet confirmation step, keep exception decisions and recovery, and show progress plus a verified result. Show destination, count and total before approval, use correct Finnish/English basket-versus-list labels, disable duplicate submission, and keep cheaper alternatives on rows without a blocking panel. Done when focused development-mode `tests/ui/confirm.spec.ts` and `tests/ui/journey.spec.ts` verify one transfer click in the normal path, no retailer write before an exception decision, cancellation of an exception, repeated-click protection and clear partial-failure recovery | Simple | U10.1 | Done: source implementation and focused local fixture checks passed; release verification underway |
| U10.3 | After verified success, invoke the existing `openStoreCart` handoff in `src/main/main.ts` automatically for the transferred chain/account: K-Ruoka basket, S-kaupat Korikone list. Keep an open-only action for reopening or failed navigation. Do not replay retailer writes when login or navigation fails. U3.6 later routes this same handoff into the embedded store tab. Done when local fixture tests verify the destination, exactly one handoff after success, no automatic handoff claiming success after a partial transfer, and an opening failure followed by an open-only retry with zero additional writes | Simple | U10.1, U10.2 | Done: source implementation and focused local fixture checks passed; release verification underway |
| U10.4 | Update `docs/design.md`, `docs/ux.md`, `docs/testing.md` and `docs/acceptance.md` for initial-click approval, exception decisions, duplicate protection and automatic handoff. Update affected fixtures/tests that assumed routine confirmation. Done when focused checks pass and an owner check is recorded: transfer a small displayed batch to each chain, verify quantities and automatic destination opening, reopen without adding again, and confirm checkout remains manual. This check changes retailer baskets/lists but needs no ChatGPT requests; request it only after fixture checks pass | Simple | U10.3 | In progress (Codex): documentation and fixtures pass; owner acceptance pending after release verification |

### U11. Visible and changeable AI model

Below the note, show a small selector displaying "Automaattinen" / "Automatic" or the selected model's display name. Use one short line and a dropdown indicator, with an accessible "AI-malli" / "AI model" label; opening it shows Automatic and the account's available models. Keep it visually secondary to the note and update button. Long model names must not widen the page or hide the update action. Keep explanations in Settings so the note area stays compact.

Near the top of Asetukset, a separate "ChatGPT ja tekoäly" / "ChatGPT and AI" card contains connection status, sign-in/out, usage access and the same model selector. Move the existing ChatGPT controls out of the store card. Explain Automatic in Finnish and English: Korikone prefers a small, low-cost model available to the account to reduce usage; it checks availability before a request. Do not promise an exact price or the cheapest model when the provider supplies no comparable cost data. Do not silently fall back to an arbitrary potentially expensive model when no suitable small model can be identified; explain this and ask the shopper to choose an available model explicitly.

Both selectors edit one saved app preference, defaulting to Automatic for older profiles. The choice survives restarts and backup round trips, applies to note interpretation and recipe import (and F11 meal ideas when implemented), and affects only future explicit AI requests. Switching models preserves the typed note, current list, quoted prices and any transfer approval. An in-flight request keeps the model it started with. If a manually chosen model disappears, retain the choice, explain that it is unavailable, and offer Automatic or another available model rather than silently substitute. Disconnected, empty-catalogue and catalogue-error states stay readable and do not start a generation.

| ID | Task, and done when | Agent | Depends on | Status |
| --- | --- | --- | --- | --- |
| U11.1 | Define the saved model preference in `src/domain/model.ts`, its persistence/backup migration, and selection behavior in `src/ai/models.ts`. Inspect the model catalogue in `src/ai/chatgpt.ts` for usable size/cost metadata; prefer a supported small, low-cost tier, document any name-based inference and never claim price certainty from names. Replace the arbitrary first-model fallback with an actionable selection-required result if Automatic cannot identify a suitable small model. Use the saved choice in the `generate` and `importRecipe` paths in `src/main/main.ts`; preserve the request's starting choice during retries. Ensure preference-only changes in `src/application/service.ts` neither invalidate the shopping quote/review nor submit a request. Done when focused `tests/models.test.ts`, AI, service and persistence tests cover Automatic, explicit selection, renamed/removed models, no suitable small model, empty/failed catalogues, older profiles, backup round trips and an unchanged shopping quote/review after a preference change. Update downstream cards with exact fields/APIs | Strong | | Done: source implementation and focused local fixture checks passed; release verification underway |
| U11.2 | Add a shared compact model selector in `src/ui/` and use it below the note in `src/ui/shopping.tsx` and in a separate ChatGPT card near the top of Settings in `src/ui/main.tsx`. Reuse `modelsAI` and account catalogue state; loading models is read-only and never generates content. Add Finnish/English accessible labels, the Automatic explanation in Settings, current-choice synchronization and unavailable/disconnected/error states. An explicit model choice saves immediately; the note selector stays on one compact line at normal desktop width. Done when focused development-mode UI tests switch the choice from both locations, navigate back, restart, check synchronization and unchanged note/list/prices, and reach both selectors by keyboard with long model names at 1280 × 800 | Simple | U11.1 | Done: source implementation and focused local fixture checks passed; release verification underway |
| U11.3 | Extend `src/ai/fixtures.ts` with multiple named model choices, a catalogue without a suitable small model, a removed selection, an empty catalogue and a catalogue failure. Expose fixture evidence of the model used by a generation without storing live prompts or credentials. Done when focused fixture/UI tests prove opening/changing selectors starts zero generations, the next explicit note and recipe-import requests use the saved choice, Automatic selects the fixture small model, and unavailable/failed choices leave the current list intact. Do not replace application IPC handlers | Simple | U11.1, U11.2 | Done: source implementation and focused local fixture checks passed; release verification underway |
| U11.4 | Update `README.md`, `docs/design.md`, `docs/ux.md`, `docs/testing.md` and `docs/acceptance.md` with model selection, Automatic's small/low-cost preference and its limitations. Done when focused checks pass and an owner check is recorded: find/change the model below the note and in Settings, restart, and verify the next request honors the choice. Finding/changing the setting needs no generations; validating Automatic and one explicit model live needs two ChatGPT generations. Request the live check only after fixture tests pass | Simple | U11.3 | In progress (Codex): documentation and fixtures pass; owner acceptance pending after release verification |

## 0.5.0: Stores inside the app

The S-kaupat and K-Ruoka sites open inside Korikone in a "Kauppa" view with a tab per chain. Signing in happens there once per chain. After a transfer the tab opens on the K-Ruoka cart or the S-kaupat Korikone list, and checkout happens in the same window. Korikone's searches and cart writes run in that same session, so the shopper sees exactly the account and cart Korikone changed. No Edge, Chrome or default-browser window opens for shopping.

Start with the spikes. If a chain refuses Electron's built-in Chromium, or its login needs a provider that refuses embedded windows, that chain keeps today's external window and the result is recorded here. The spikes load the real store sites, so they need the owner's go-ahead and stay read-only: no list or cart writes, no checkout pages. After each spike, the agent that ran it rewrites the cards that depend on it with the APIs and file names it found.

### U3. Store sessions inside Korikone

| ID | Task, and done when | Agent | Depends on | Status |
| --- | --- | --- | --- | --- |
| U3.1 | Spike: open s-kaupat.fi in an Electron `WebContentsView` with `session.fromPartition("persist:s-kaupat")`, sign in by hand, and repeat one read-only GraphQL call that s-kaupat-mcp makes, from the page context. Done when [integrations.md](integrations.md) records: whether the site and its bot protection accept the view (and with which user agent), the login providers on offer and whether each works embedded, where the session token lives, whether `fetch` from the page succeeds, and whether bank redirects at checkout open as new windows. Throwaway code stays out of `src/` | Strong, with owner | | Planned |
| U3.2 | Spike: the same for k-ruoka.fi with `persist:k-ruoka`, plus which site endpoints k-ruoka-mcp calls for search, cart read and cart write. Done when [integrations.md](integrations.md) records the same answers as U3.1, and [dependency-decisions.md](dependency-decisions.md) records the choice: an upstream host-page mode for k-ruoka-mcp, or a Korikone K-Ruoka client in `src/stores/`, with the reason | Strong, with owner | | Planned |
| U3.3 | s-kaupat-mcp (separate repository): a mode where the host app passes in the page that runs API calls, keeping today's own-browser mode as the default. Done when it is released with checksums, pinned in `scripts/prepare-s-kaupat.mjs` and `src/stores/s-kaupat.ts` like 1.2.0, and its demo-mode contract test in `tests/s-kaupat.test.ts` passes | Strong | U3.1 | Planned |
| U3.4 | Store view in `src/main/`: a "Kauppa" entry in the navigation that shows one `WebContentsView` tab per signed-in chain, with persistent partitions `persist:s-kaupat` and `persist:k-ruoka`. Store pages get no preload, `nodeIntegration: false`, `sandbox: true`; `setWindowOpenHandler` opens popups and payment redirects as views in the same tab; navigation outside the chain's own domains and known payment domains asks first. Done when a desktop test in development mode opens the fixture site from U3.8 in the tab, a popup stays inside it, and `window.korikone` is undefined in the store page | Strong | U3.1 | Planned |
| U3.5 | Sign-in through the store tab: "Kirjaudu kauppaan" in setup and Asetukset opens that chain's tab on its login page, and Korikone counts the chain as signed in once the tab's session reports an account. Remove the external login windows for chains that passed their spike. Done when `tests/ui/setup.spec.ts` and `tests/ui/chains.spec.ts` cover sign-in through the fixture site, and the chain keeps its login after an app restart | Strong | U3.3, U3.4 | Planned |
| U3.6 | Route U10's automatic post-verification handoff and open-only retry to the Kauppa view: load the chain's cart page (K-Ruoka) or Korikone list page (S-kaupat) in its tab instead of calling `shell.openExternal`. Done when a desktop test in development mode checks the tab's URL after a one-click fixture transfer and an open-only retry, and the old external handoff remains only for chains that failed their spike | Simple | U3.4, U10.3 | Planned |
| U3.7 | K-Ruoka through the store session, as chosen in U3.2. Done when `src/stores/k-ruoka.ts` (or its replacement) passes `tests/k-ruoka.test.ts` against mocked page responses for search, cart read, cart write and an expired login, and the review still binds to the account | Strong | U3.2, U3.4 | Planned |
| U3.8 | Development fixture site: a small local HTML site served from the app in development mode only, with a login page, a product page, a cart page and a Korikone list page, plus a popup link. The store view loads it instead of the real site whenever development mode is on. Done when no test can reach s-kaupat.fi or k-ruoka.fi, checked by a test that fails on any request to those hosts | Simple | U3.4 | Planned |

### U4. S-kaupat list to cart without extra clicks

| ID | Task, and done when | Agent | Depends on | Status |
| --- | --- | --- | --- | --- |
| U4.1 | Spike: after the S-kaupat store session works, investigate whether the real basket can be accessed and reliably written/read directly, or whether the Korikone shopping-list workaround is required. Inspect how the site's "Lisää kaikki ostoskoriin" works (a page function, a request, or only the button), the destination URL and cart readback. Do not assume either route is supported. Inspection stays read-only unless the owner explicitly authorizes an observed cart-write check; never open checkout. Done when [integrations.md](integrations.md) records supported mechanisms, limitations and the chosen direct-basket, list-to-basket or manual-list fallback, and U4.2 is rewritten with exact APIs and fixture requirements | Strong, with owner | U3.5 | Planned |
| U4.2 | Implement the route established by U4.1 within U10's one-click flow. If direct basket access is reliable, transfer the approved batch there with journalling and readback; otherwise use a reliable list-to-basket action if available. Open the basket automatically only after verified basket success. If neither is reliable, retain the Korikone list and open it with "Lisää kaikki ostoskoriin" visible. Name the actual destination on the transfer button. Done when the fixture site covers success, a partial write, an uncertain result, repeat-transfer protection and failure for the chosen route, each with focused tests; no ordering, payment or slot tools are enabled | Strong | U4.1, U3.8, U10.3 | Planned |

### U6. Shorter setup

| ID | Task, and done when | Agent | Depends on | Status |
| --- | --- | --- | --- | --- |
| U6.1 | One setup screen in `src/ui/setup.tsx`: store search by town or postcode, sign in through the store tab, an optional "Continue with ChatGPT" button, and "Valmis". Heading at most 32 px so every action is visible at 1280 × 800 without scrolling. Done when `tests/ui/setup.spec.ts` goes from first launch to the empty list in one screen and asserts the actions are inside the viewport | Simple | U3.5 | Planned |
| U6.2 | Remove the second-chain section from setup. Offer it in two places: a one-line hint under the pinned total ("Vertaa K-Ruokaan: kirjaudu sisään") shown only when one chain is signed in, and in Asetukset. Done when `tests/ui/chains.spec.ts` covers both entry points and the hint disappears once both chains are signed in | Simple | U6.1 | Planned |
| U6.3 | A fixture desktop test from first launch to the opened retailer destination, counting clicks: setup, explicit note update, transfer. The normal transfer has no second confirmation or separate open action; test exception confirmation separately. Done when it passes and asserts no external window or `shell.openExternal` call happens in development mode | Simple | U6.1, U3.6 | Planned |

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
| F5.1 | Save every observed product price in the SQLite store under its own key prefix, not in `AppState`: product ID, chain, store ID, date, price, unit price. Keep at most 365 days and at most 20,000 entries, oldest dropped first. Include it in backup export and import, exclude it from `src/application/diagnostics.ts`. Done when `tests/persistence.test.ts` checks the limits and a backup round trip, and the diagnostics test checks no prices appear | Simple | | Planned |
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
| F9.1 | A `calendar` field in `stateSchema` (`src/domain/model.ts`): date (ISO) to a list of meal IDs plus a leftovers flag, with a schema default of empty so older profiles and backups load. Done when `tests/persistence.test.ts` loads an older profile and round-trips a backup with a calendar | Simple | | Done (ea9e2ef): ISO dates map to `{ mealIds: string[], leftovers: boolean }`; older profiles default to empty; persistence and real desktop backup checks pass |
| F9.2 | Viikkosuunnitelma shows 7 days from today with the cooked meals on the list. Save dates in `state.calendar` as `{ mealIds: string[], leftovers: boolean }` through the existing `save` path; F9.1 includes this field in profiles and backups. Meals move by drag and drop and by keyboard (focus a meal, arrow keys change the day). A day can be marked "Tähteitä". Done when a desktop test moves a meal by both methods, restarts the app, and checks the shopping list total is unchanged | Strong | F9.1 | Done (1d4dd3e): `src/ui/calendar.tsx` shows seven saved days; drag, arrows, Delete and leftovers; unit and desktop tests preserve the shopping total and approval |
| F9.3 | "Kopioi viikko" in `src/ui/calendar.tsx` puts the seven dates from `calendarDays` (`src/domain/calendar.ts`), their saved meal names and leftovers flags from `state.calendar` on the clipboard as plain text (day name, date, meals), using the existing clipboard path. Ignore meal IDs no longer on the current cooked-meal list, as the calendar view does. Done when a desktop test checks the text in Finnish and English | Simple | F9.2 | Done (341d566): `calendarText` exports seven saved dates; real clipboard checks pass in Finnish and English, including an empty calendar |

F9 owner check pending: in the normal profile, move a meal, mark a leftovers day, restart, and copy the week in Finnish and English. The calendar and copied text should keep those choices, and the shopping total should stay unchanged. This needs no ChatGPT requests or retailer access.

### F10. Recipe import

Paste a recipe's text in Reseptit and get a recipe with ingredients and portions to review before saving. Fetching recipes from a URL is not included.

| ID | Task, and done when | Agent | Depends on | Status |
| --- | --- | --- | --- | --- |
| F10.1 | "Tuo resepti tekstistä" sends the pasted text to the AI provider as untrusted data with a prompt that returns one recipe in the existing `recipeSchema` shape, validated with the same single corrective retry as notes in `src/ai/draft.ts`. Add AI fixtures for success, invalid output and usage limit in `src/ai/fixtures.ts`. Done when `tests/ai.test.ts` covers all three | Strong | | Done (71615cc): `recipePrompt`, `validateRecipe` and shared `generateValidated` in `src/ai/draft.ts`; `importRecipe` IPC returns a temporary `recipeDraft`; unit and real IPC fixture checks pass |
| F10.2 | Add "Tuo resepti tekstistä" in Reseptit in `src/ui/main.tsx`; call `importRecipe` with `{ text, model: "auto", consent: true }`. On success, open `snapshot.recipeDraft` in the existing recipe form for review; nothing is saved until "Tallenna". Use `cancelAI` to cancel; errors are `invalidDraft`, `usageLimit` or the existing AI errors. Development scenarios `success`, `invalidOnce`, `invalidDraft`, `usageLimit` and `delayedSuccess` also work for imports; "Nakkikeitto" returns the deterministic soup fixture. Done when a desktop test imports a fixture recipe, edits one amount and saves it | Simple | F10.1 | Planned |

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
