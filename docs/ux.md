# Korikone UX

Revised 9 October 2026. Follow the first-round refined feedback and redesign PDF. The original human feedback explains the friction; where they conflict, the refined direction takes precedence.

The shared [category matcher](matching-contract.md) keeps unknown default types unresolved for explicit approval, hides hard-conflicting alternatives and applies the same eligibility to cheaper suggestions. Generic onion labels do not establish yellow onion. Row details explain matching decisions and offer “Käytä kerran” / “Use once” separately from “Muista tyyppi” / “Remember type”. Remember opens an evidence-supported type summary and an explicit Required/Preferred choice. Opening or cancelling it changes nothing. A stale form reloads the current rows without retrying the choice. Portable rule storage and Advanced management are implemented in [preference-contract.md](preference-contract.md).

“Tarkista ratkaisemattomat rivit” / “Review unresolved rows” opens one optional inline panel grouped by food category. It reuses the row choices and shows the rows captured when opened, including rows subsequently approved, so focus stays within the review. Leave unresolved retains the saved row and its transfer exception; it does not mark the product at home or create memory. Closing the panel saves nothing. Escape cancels an open Remember form first, then closes the review. Focus returns to the opener, or the saved-list heading after every captured row is resolved. Valid list rows, the quoted total and the existing transfer decision remain available. Typing and list updates never open the panel automatically.

## Navigation and first use

The owner accepted the [initial category policy](category-policy.md) on 10 October 2026 for F15 implementation. Generic category defaults stay visible; generic cream needs review. Remember explicitly offers Required or Preferred: missing Required types stay unresolved, while a Preferred fallback needs approval. Current explicit qualifiers override saved fields for that list without changing memory; row details explain when this happens. Advanced manages Edit/Forget/Reset.

“Tarkoitin jotain muuta” / “I meant something else” opens an inline correction even when the row already has a selected product. Choose the reason, then a retained replacement or a whole amount in the current unit. No suitable replacement leaves the row unresolved. Remember requires a separate unchecked-by-default choice and a visible type/strength summary. Corrections use the retained quote without new AI or catalogue requests, preserve unrelated rows and invalidate old transfer approval. Cancel or Escape saves nothing. A stale form reloads rows and asks the user to reopen it. See [correction-contract.md](correction-contract.md).

Use a left rail: Ostoslista, Viikkosuunnitelma, Reseptit, Historia, Kauppa and Asetukset. Vakiotuotteet opens from Asetukset and from "Unohtuiko jotain?". There is no separate basket page: product details open from a list row, and the transfer is confirmed in the list column. Keep Finnish/English switching available. Use the native Windows title-bar overlay. Keep the existing optional store/ChatGPT setup and a working manual path.

The everyday entry is the shopping list. Avoid a large hero, photo or weekday-entry grid. An empty note has starter ideas in one place. An empty list explains that groceries and their meal sources will appear there. Show only real local history and recurring items, never the mockup's invented weeks, prices or user name.

## Note and interpretation

One note accepts all requested meals and groceries: “Nakkikeitto, kanapasta, pakastepizza. Aamupalaksi jogurttia ja banaaneja. Herkkuja viikonlopuksi.” Do not add category toggles that repeat this input. Ready foods, breakfasts, evening foods and treats must be preserved.

Only the primary AI button or Ctrl+Enter requests interpretation. The button reads "Taio ostoslista" / "Create my shopping list" for the first list and explicit New list draft, or "Taio muutokset" / "Update my shopping list" for edits to the current list. Its static spark, chain-accent fill and soft border treatment distinguish it from secondary actions. It has a minimum 44-pixel hit area and a separate keyboard focus outline. Pending work immediately disables it, changes its treatment and shows a static activity symbol without changing its label or width. There is no idle animation, including with reduced motion. New list remains a separate action. Typing, returning to the view and restoring an edited note do not submit. Show “Muistiinpanoa ei ole päivitetty listaan” / “Note changes have not been applied to the list” when the note differs from the saved list's note. Run one interpretation at a time and discard obsolete responses. The note remains editable while work runs, and an edit during a request does not submit a follow-up request. Show an animated activity state with readable status and cancellation only while an explicit update runs; respect reduced motion. No invented percentage or completion estimate.

Show household size, date and branch as compact context. Explain the AI data flow next to the input. Connection, usage and validation errors preserve the saved list and offer retry or manual editing.

The store name and pickup/delivery label above the note are buttons. Each opens an in-place selector with the current choice, confirm and cancel. Escape closes it and returns focus to its button. Opening, searching stores and cancelling start no catalogue or AI requests. Store search shows remembered choices, empty results and errors; changing a choice remains provisional until confirmation. Confirmation prices the unchanged groceries before saving the context. A failed lookup preserves the previous selection and quote and offers retry. Successful changes keep the typed note and refresh product prices and pickup fees without interpreting the note. Live delivery is disabled with an explanation; selecting a planning context does not select a retailer address or time.

“Näin ymmärsin” displays a card for each meal/group. Show its type, ingredient count, approximate share of the quoted total, and portions. Selecting the card highlights the ingredient rows without hiding other rows. Ingredient cost shares are estimates because packages can be shared. Persist any portion assumptions from the interpretation.

Saved recipes are behind “Lisää valmiita reseptejä.” Pick a recipe and portions, then add its ingredients. No weekday is required. Remove a meal from its card. “Viikkosuunnitelma” is a separate optional view with seven days from today and only cooked meals already on the list. Drag a meal onto a day, or focus it and use arrow keys to move one day at a time. Delete returns it to “Ei päivää”. “Luonnostele viikko” distributes current meals across the seven days. A day can be marked “Tähteitä”. Each change is saved automatically and keeps the shopping list and its quoted total unchanged.

“Kopioi viikko” copies one plain-text line per visible day: the day name in the selected language, ISO date, scheduled meal names and any leftovers flag. Empty days say “Vapaa” or “Open”. Unscheduled meals and removed meal references are omitted. The button confirms copying with “Viikko kopioitu” or “Week copied”; it resets when the exported text changes. Copying does not alter the calendar or shopping list.

## Shopping rows

The list stays on the right on desktop and moves below the note in narrow windows. Use compact category headings and rows. No hidden tail of the list.

An empty list shows manual-entry controls and guidance without a total or transfer action. Once rows exist, the footer appears and reserves its own space. Update and error banners sit beside the navigation rail, so their messages and actions remain readable at the approved desktop and narrow sizes.

Each row contains a product name (or unresolved ingredient), required amount, source meals, pack quantity when quoted, cost, home marker, remove action and optional replacement picker. All controls have text or accessible labels. Highlighting and selection must not rely solely on color.

Product and meal names wrap in full. Row names use 16 px text; amounts, sources and quantity units use 14 px. Home and remove controls stay visible. Unresolved rows show “Hinta puuttuu” / “Price unknown” rather than a blank price. A selected meal also says its ingredients are highlighted. Product details keep unknown pack sizes and prices visible and prevent selecting unavailable or incomplete candidates; confirming a pack size reprices through the normal saved-list path.

- Plus/minus changes the required quantity by a pack when a quote is available, or a base amount otherwise.
- “Löytyy kotoa” retains a muted row and excludes it from the total and transfer. Clicking again restores it.
- Remove hides the row independently from home status.
- Brand preference changes reselect products and refresh quotes.
- A saved explicit choice is reused while available. Otherwise use the cheapest sufficient eligible packs.
- A cheaper alternative has “Vaihda” and a local undo action. Other candidates are under “Vaihda tuotetta.”
- Manual additions accept name, quantity and unit. Units must match catalogue pack data to receive an automatic quote.

“Unohtuiko jotain?” offers configured recurring purchases. Do not claim a product is bought every week without purchase evidence. Previously enabled due staples remain automatically included.

## Total, export and transfer

Clear-list appears once, in the list menu. Copy/save are under the total. Text files can be moved to a phone manually; there is no direct phone sync button pretending to work.

Show the quoted total and explicitly count missing prices/products. Excluded home items are separate. Fees and unreported deposits are unknown. Never label an incomplete quote as the full basket cost.

On desktop, list rows scroll in their own area above a separate total and transfer footer. Keyboard focus cannot be covered by the footer. Tall confirmations or results use page flow when fewer than 180 px would remain for rows; narrow windows always use page flow. An incomplete quote is labelled “Tunnettujen hintojen välisumma” / “Subtotal of known prices”. Transfer decisions and results use readable text beside the same total. Reopening the retailer destination retries only opening; development fixtures expose the store-write count for verification.

An explicit note update immediately announces its start, then displays actual discovery, interpretation, catalogue, resolver and commit phases from validated planning events. Brief transitions use the same status live region. There are no percentages, predicted durations or AI pass counts. Cancel names the current operation UUID and remains available until commit starts. It returns focus to the note and retains typed text. Cancellation, source changes and failure retain the saved list and quote. The saved list stays readable with its previous quote timestamp while work runs. Editing the in-flight note invalidates the operation; late catalogue or inference output cannot install a quote. Only the still-current successful planning reply can authorize atomic commit. The primary AI button focuses the note before starting work; later responses do not move focus. Reduced motion keeps a static activity indicator while status text remains visible.

One operation has one visible progress and Cancel surface. The composer shows its real stage, elapsed seconds and cancellation control when its action row is fully visible. Scrolling it out of view or opening another page switches to a fixed global fallback with the same state and Cancel action. Surface changes do not move focus. The workspace stays mounted during navigation, so returning restores the pending input and leaving it does not drop a successful commit. Cancelling from either surface retains the saved list, quote and typed input; the active surface then explains that cancellation. Non-composer operations retain the global busy feedback.

B2.15's UI contract is `ComposerProgress` exported by `src/ui/shopping.tsx`: `active`, `finished`, `visible`, `label`, `phase`, `elapsed`, `cancellable`, `cancelling` and `cancel`. `ShoppingWorkspace.visible` and `onProgress` let `src/ui/main.tsx` select the surface while the workspace owns the operation. The local `.note-actions` / `#note-update-help` and global `.operation-fallback` share that status; only the visible surface has the operation's live region. Elapsed seconds are excluded from live announcements. The global fallback uses the existing `.progress::before` activity indicator; completed feedback has `.operation-finished`. Animation follow-ups must keep this ownership and visibility contract and use validated planning events and provisional results.

Show “Viimeksi haetut hinnat” / “Last quoted prices” with the quote time. Returning to the list and restarting keep these prices without a catalogue request. If there is no compatible quote, show “Ei hinnoiteltu” / “Not priced” and “Hae tuotteet ja hinnat” / “Get products and prices”. Explicit list, product and store changes refresh pricing. If an edit saves but pricing fails, show the saved rows as unpriced, a persistent error and the same retry action. The list menu also offers a manual refresh. Transfer review checks current prices and stops on a changed price or pack before writing.

The total and transfer button stay pinned under the list. The button names the actual basket or list destination, product count and quoted total. Its initial click approves the displayed batch, checks current data, transfers and opens the destination after verification. Show progress while it runs. Only missing products, existing quantities, a budget overrun or interrupted transfers need another decision. Changed prices or packs require an explicit refresh and a new approval. Cheaper alternatives remain on rows. Before/after quantities and retained cart items are under "Näytä kaikki rivit"; only a budget overrun needs a separate checkbox.

The result shows in the same panel: verified counts, omitted requirements and a close action. K-Ruoka opens its basket in the Kauppa tab with the reviewed store selected. S-kaupat opens its authenticated account list in its own tab, scrolls the add-all button into view and leaves that step to the shopper. Opening failures offer an open-only retry. Repeated approval of the same batch reopens it without adding products; the separate repeat action requires approval of additional quantities. Interrupted transfers offer reconciliation before retry. Never describe a partial transfer as a complete list. Do not turn a transfer into purchase history; checkout and purchase confirmation remain separate.

The compact AI model selector below the note shares its saved choice with the separate "ChatGPT ja tekoäly" / "ChatGPT and AI" Settings card. A rounded button opens a floating menu with a checkmark beside the selected model. Long names wrap in the menu; the compact button shows a shortened name with the full name in its tooltip. Arrow keys, Home and End move through choices; Enter selects; Escape closes and returns focus. Automatic is the default and prefers an available small model to reduce usage. Settings explains that size is inferred from names and exact prices are unknown. If no suitable small model is found, ask for an explicit choice. Disconnected, empty, failed and unavailable-selection states explain the next action. Loading or changing models never submits the note or changes its list and prices. A request retains the model it started with through validation retries.

Language uses the same rounded button and floating menu, with native names Suomi and English and a selected checkmark. Only the selected language appears on the button; "Kieli" / "Language" remains its accessibility label. It supports the same keyboard controls and stays inside the viewport, including opening above the button near the bottom of the sidebar. Switching language preserves unsaved notes and recipe fields and persists across restart. Svenska stays hidden until Swedish support is complete.

Settings shows one category at a time: General, Household, Stores, ChatGPT and AI, Data, Advanced and About. Category buttons become a labelled select in narrow windows. Changing category focuses its heading. Visited sections stay mounted so unsaved fields survive navigation, language changes and recurring-item editing. Household save failures retain the draft. Backup restoration updates untouched household fields and keeps edited values visibly unsaved.

The household chip opens Household; store chips, comparison sign-in hints, price/context errors and the store toolbar open Stores. AI connection/model errors open ChatGPT and AI. The development banner opens Advanced. Operation errors offer the relevant section beside the message. Explicit entries focus the section heading even when that section is already open. Navigation and automatic model-catalogue loading retain the current error; an explicit operation clears it before its result. Household drafts survive these entries, and saved preferences can be changed back through the same real save path.

About shows the running Electron application's version, including a prerelease suffix, through `getAppInfo`. If the read fails, the version says unavailable. Its notices action opens the bundled local third-party notices. A release action appears when an update was found and retains development-mode suppression.

The AI card explains that remaining ChatGPT allowance and reset time are unavailable in Korikone and offers "Avaa ChatGPT:n käyttö" / "Open ChatGPT usage". A received request limit is shown as a usage or rate limit; it does not imply the whole plan is empty or establish a reset time. No quota request or generation is made just to open Settings.

When ChatGPT is connected, the sign-in button reads "Kirjautunut ChatGPT:llä" / "Signed in with ChatGPT" and is disabled with subdued, readable colors in both themes. Sign-out, usage and model controls remain available. A saved email alone does not imply a connection: signed-out or expired authentication restores "Continue with ChatGPT"; waiting authentication keeps that button disabled. Development fixtures `authWaiting`, `authExpired` and `authRestored` exercise these states with a synthetic account. `developmentSignInCalls` counts only local fixture sign-ins, allowing disabled-button checks without live authentication.

## Receipts

Settings offers PDF, TXT and CSV import plus an editable text area. PDF text extraction is local and runs off the main thread. Shopping-note interpretation never sends imported raw receipt text. Receipt import/paste/save stays local; future optional receipt enrichment has separate consent. Show distinct errors for unreadable/protected files, image-only PDFs needing OCR, and size limits. Import failure preserves all existing receipt text.

The v0.7.0 compact context implementation removes raw receipt text and unrelated history from shopping prompts; see [the payload and bounds](ai-context.md). Planned v0.9.0 [receipt learning](receipt-learning.md) presents actual parse/accounting stages, printed totals, balance/unknowns and one optional grouped correction entry. Local import remains usable without AI. First import offers a small optional sanitized-label enrichment consent, also changeable in Settings; disclose the selected provider and distinguish one-receipt use from future automatic enrichment. Sanitized evidence is retained by default, originals only by explicit local-retention choice. No receipt correction automatically saves a household preference or changes the shopping list.

## Visual and interaction checks

Compare desktop, narrow and empty-state captures with the redesign. Check long Finnish names, row density, keyboard focus, disabled states, language switching, stale note responses, manual additions, home/removal behavior, additive quantities and clear-list. Keep transfer recovery and existing setup/form persistence tests. Live model and retailer behavior need user-account checks beyond automated fixtures.

For explicit updates and retained quotes, use the [U8 owner-check steps](testing.md#explicit-update-owner-check-u83): edit without updating, leave and return, restart, then update by button and Ctrl+Enter. Verify stable rows and quote time before an update and visible progress only while it runs. Record the mode and observed result in acceptance.

## Preserved store and support features

Both retailers remain searchable during setup. Settings lists K-Ruoka and S-kaupat side by side, each with its own sign-in state, remembered store and a _Use this store_ action; one is marked active, and switching keeps the other chain signed in. Setup connects one chain. When exactly one chain is signed in, the pinned shopping total offers the other chain and leads to its store selection and sign-in in Settings. Keep S-kaupat sign-out and its authenticated handoff. Redacted diagnostic export stays in settings. Household exclusion terms filter products before automatic selection. The basket detail view retains decision reasons, unit prices, surplus and omission. Earlier-week reuse remains available in History alongside the new verified-transfer history.

Development tools and diagnostic export are under Advanced. Forced test launches show a locked development checkbox. Data contains receipt import/paste/save and backup export/restore. Edited receipt text survives category changes and imports; untouched text follows the saved value, and edited text shows an unsaved message.

General offers System, Light and Dark. System is the default and shows its current resolved appearance; explicit modes override system changes. Selection applies immediately through the preference-only setter, preserving shopping input/list and Settings drafts without AI or catalogue calls. Restart and backup restoration retain the preference. The renderer bootstrap applies it before the built stylesheet and app module; retailer pages keep their own appearance.

Advanced Settings lists remembered product types and explains Required versus Preferred. Edit and Forget apply to one category; Forget all requires explicit confirmation. A backup export action supports restoring earlier rules. Cancelling a draft or reset changes nothing. Saved changes use the existing pricing refresh; unavailable requested types remain unresolved. Opening the section never generates a list or refreshes prices.

During planning, List in progress / Muodostuva lista selects the provisional region. Saved list / Tallennettu lista deliberately opens the retained list, previous quote timestamp and its total. Only one list view is visible at a time. Preview rows have no aggregate total, editing or transfer controls. The result region keeps a fixed height as validated events arrive. Cancelling or committing removes previews; if a disappearing preview control held focus, focus returns to the note without scrolling. Reload restores only the committed list.

Grouped review and quantity correction keep unresolved requests visible. Remembering a product type is explicit and applies to later plans. A quantity-less grocery remains unpriced even after all product rows resolve; the footer still says Subtotal of known prices. Normal transfer requires a complete list. Partial preparation identifies omitted requests before approval and excludes them from its targets.

## Store selection, comparison and return audit (U19.1)

Audited 12 October 2026 against issues [#6](https://github.com/Vkuparin/korikone/issues/6), [#7](https://github.com/Vkuparin/korikone/issues/7) and [#10](https://github.com/Vkuparin/korikone/issues/10), on the v0.7.0 source of `src/ui/chains.tsx`, `compare.tsx`, `shopping.tsx`, `main.tsx`, `store.tsx`, `settings-sections.tsx` and `src/main/store-view.ts`; none of those files has changed since the v0.7.0 tag. Development fixtures only; no live account, AI request or retailer write. The issues were written on 9 October against earlier revisions, so each point is classed by what the current source does.

| Issue point | Finding | Evidence |
| --- | --- | --- |
| #6 Each chain card chooses its own store | Already fixed | `Chains` in `chains.tsx` has a per-chain "Valitse kauppa" / "Vaihda kauppa" action with its own search, filtered to that chain |
| #6 A card without a store says what to do | Already fixed | The card shows "Kauppaa ei ole valittu" with the "Valitse kauppa" action beside it |
| #6 Choosing a store for the other chain must not change the active one | Fixed in the cards, **reproducible** in Settings | The card picker saves only `stores[chain]` for a non-active chain. The older search form under the cards in `StoresSettings` (`settings-sections.tsx`, "Etsi K-Ruoka- tai S-kaupat-kauppa") still lists both chains together as plain buttons and saves the clicked store as the active `context`, switching chain without saying so. Its buttons are keyed by `storeId` alone |
| #6 Say why the comparison is unavailable | **Reproducible** | `shopping.tsx` renders `CompareSummary` only when `canCompare(snapshot)`. `compareBlocker(snapshot)` in `compare.tsx` already returns the missing prerequisite (`{ need: "store" | "login", chain }`) but is imported and never used. The only hint is shown when exactly one chain is signed in, and it always says "kirjaudu sisään" even when the missing piece is the other chain's store. With both chains signed in and no second store, or with neither signed in, nothing is shown |
| #7 "Vertaa kauppoja" is too small | Partly fixed; owner check outstanding | The trigger is now a full-width `secondary` button in the total region (`.shopping-total .compare-summary`), no longer a text link. Whether it is prominent enough is a visual judgement the owner has not yet repeated |
| #10 A way back to the store from elsewhere | Fixed in navigation, **gap** in Settings | After the Kauppa view has been opened, the navigation entry is filled and reads "K-Ruoka · palaa" or "S-kaupat · palaa" from every other view. Stores settings, where the shopper goes to check sign-in, has no action that returns to the store |
| #10 The entry shows a session waiting for sign-in | **Gap** | The cue depends on renderer state `storeOpen`, set only when the Kauppa view is shown. A sign-in started from Settings during setup shows the store over the setup screen without setting it, and a chain in the `waiting` login state is not reflected in the entry |
| #10 The store tab keeps its page and half-finished sign-in | No bug | `StoreViews.hide()` detaches the view and keeps it; `show()` reattaches the same one and loads the front page only when it has no URL. Each chain keeps its own persistent session. The owner's follow-up on the issue reports the same |

**Lifecycle evidence.** `tests/ui/store-return.spec.ts` drives the real application in development mode: both chains get a fixture store, the S-kaupat tab is left on its login page before submitting and the K-Ruoka tab on a product page, each with a marker set in the page. After going to Settings and the shopping list and back, both pages have the same web-contents IDs, URLs and markers, so nothing was reloaded or duplicated. Finishing the sign-in and leaving and returning three more times keeps the S-kaupat session and leaves the K-Ruoka session signed out; there are still exactly two store pages, no store write and no AI request. Expiry reporting and the post-transfer opening of the destination were already covered by `tests/ui/chains.spec.ts` and `tests/ui/store.spec.ts` in the v0.7.0 release flow on this same source. No session or page loss was reproduced, so U19.3 is dropped rather than changed speculatively.

**Handoff to U19.2** (visual affordances only; no lifecycle, login or pricing change):

1. `src/ui/shopping.tsx`, total region: when `canCompare(snapshot)` is false and `compareBlocker(snapshot)` is not null, show one line naming what is missing and for which chain, with an action to `settings("stores")`. `need: "store"`: FI "Vertailu: valitse kauppa ketjulle K-Ruoka", EN "Compare: choose a K-Ruoka store". `need: "login"`: FI "Vertailu: kirjaudu sisään ketjuun S-kaupat", EN "Compare: sign in to S-kaupat". Replace the current single-sign-in hint with this, since `compareBlocker` covers its case. Show nothing at a sample (demo) store. `tests/compare-blocker.test.ts` fixes the helper's results for ready, missing-store and signed-out states of both chains.
2. `src/ui/settings-sections.tsx`, `StoresSettings`: remove the mixed-chain search form and its result buttons below the chain cards. The per-chain pickers in `Chains` replace it and never switch the active chain silently; "Käytä tätä kauppaa" stays the explicit switch.
3. `src/ui/main.tsx` and `StoresSettings`: pass the existing `storeOpen` state and an `openStore` callback so Stores settings shows "Palaa kauppaan" / "Return to store" when a store page is open. Set `storeOpen` also when a sign-in opens the store tab (`openStore` in a call result, including the setup overlay), and show the cue while any chain's login state is `waiting`.
4. Keep `CompareSummary` as the full-width button; do not restyle it further before the owner's visual check.

Fixtures for U19.2: FI and EN, keyboard and narrow width, for both chains in signed-out, missing-store and ready states, through `changeContext`, `save` and the fixture sign-in as `tests/ui/store-return.spec.ts` and `tests/ui/chains.spec.ts` do. Assert that browsing the other chain's tab, opening a picker and selecting a comparison candidate leave `state.context` unchanged, and that the catalogue and AI request counts do not move.

**Implemented (U19.2, b5ca649 on `claude/project-thread-ahxe8n`).** The comparison line names the missing store or sign-in; the mixed-chain search is removed from Stores settings; Stores settings and the navigation offer the way back while a store page is open or a sign-in is waiting. `tests/ui/store-access.spec.ts` covers FI and EN for both chains.

**U19.4** exercises the three U19.2 changes through real development IPC and reuses `tests/ui/store-return.spec.ts`, `tests/ui/chains.spec.ts`, `tests/ui/compare.spec.ts` and `tests/ui/store.spec.ts` results. Remaining owner checks: the prominence of the comparison button (#7), and finding the way back to the store from Settings in live use (#10).

The shopping composer shows today's date as compact Today / Tänään text in a semantic time element. It has no chip border/background, hover action or tab stop; household, store and model controls remain visibly interactive. B2.2 focused FI/EN development checks passed at 1280 and 800 pixels, with keyboard navigation skipping the date and no list mutation, AI request or retailer write. Normal Finnish and narrow English captures were inspected.

B2.18 uses `planningActivityPending` in `src/ui/planning-status.ts` to animate the shared status surface only during pending discovery, interpretation, catalogue search, resolution or editing. Settling and cancellation keep the indicator static; reduced motion also keeps it static. The composer uses a steady outline instead of pulsing the whole input. Reserved indicator space, status height and tabular elapsed seconds from zero keep the controls stable. Provisional previews remain read-only and expose their pending state through `aria-busy`; they show validated results without invented completion percentages or streaming text.

## Startup (B2.1)

Opening the app reads the saved list, quote and transfer record from this computer. It starts no generation, catalogue search or transfer, and neither does returning to Ostoslista from another page.

Audit of the reported "processing" at startup found two causes. The first `load` waited up to 1.5 seconds for the daily update check before returning the saved list, and until it returned the window showed the general "Käsitellään…" / "Working…" text, the same words used for real work.

- `load` no longer waits for the network. A saved or local update answer is included at once; a check that finishes later is sent to the window as `app:updateChanged` (`window.korikone.onUpdateChange`) and the update notice appears then.
- Until the first snapshot arrives the window shows "Avataan tallennettua listaa…" / "Opening your saved list…" (`opening` in `src/ui/i18n.ts`, marked `data-startup="opening"`), which names the local read.
- A later `load` (used to re-read saved rows after a refused action) is not shown as work in progress and offers no Cancel.
- Sign-in recovery after launch still asks each chain with a chosen store whether its saved login holds. It updates the store state quietly and reads no catalogue.
- Genuine conditions stay visible: an interrupted transfer is reported beside the transfer action, and a failed load shows its error.

Fixtures: `tests/ui/startup.spec.ts` launches development Electron with an empty profile, a saved priced list (launch, reload and return to the list) and a profile with an interrupted transfer. Each checks the kept content, the status texts shown from the first moment of the page, and zero AI, catalogue and store-write counters. Launch-to-list time is recorded as a test annotation, not asserted.

## Store view navigation (B2.11)

The Store view has two different ways back and names each for what it does.

- **Previous page (K-Ruoka / S-kaupat)** is the store site's own history. `StoreViews.history(chain)` in `src/main/store-view.ts` reports `{ canGoBack }` from the page's navigation history; it is sent to the window as `app:storeHistoryChanged` (`window.korikone.onStoreHistoryChange`) after every navigation and load, and read once with `window.korikone.storeHistory({ chain })` when a chain's tab is shown. The button is disabled while the page has nothing earlier, with the reason in its description ("Kaupan sivustolla ei ole aiempaa sivua tässä näkymässä."). When enabled its description says it does not leave the Store view. A page opened directly, such as the list Korikone opens after a transfer, starts with no history.
- **Palaa ostoslistaan / Return to shopping list** leaves the Store view for Korikone's list (`returnToList` on `StorePage`). The list comes back at the scroll position it was left at, for the window and for the list panel. The store page stays loaded, as before. During first setup the existing "back to setup" control is used instead.

Nothing here reads the catalogue, asks a model or writes to a store.

Fixture: `tests/ui/store-back.spec.ts` uses the local development store pages for both chains: a directly opened page with no history, history after the shopper moves on, a reload, walking back until history is exhausted, the toolbar's measured layout at 800 px, and the return to the same place in an unchanged list.

## Store comparison coverage (B2.12)

Audit of the reported "about EUR 14 against EUR 30" comparison. No arithmetic fault was found: both chains are priced for the same rows and the same required amounts, each row's total is whole packs at that chain's price (or the weighed estimate, marked approximate), deposits are inside the totals, and the stated difference is computed only over rows both chains priced (`compareBaskets` in `src/domain/compare.ts`). What the owner saw is consistent with the panel's "all priced" totals, which sit side by side but cover different rows when one chain cannot price part of the list. The panel and the summary line did not say how much of the list the stated difference rested on.

Changes:

- `Comparison.coverage` is `{ rows, common, onlyA, onlyB, neither, complete }`. `complete` is true only when both chains priced every row.
- The summary line in the total bar adds the coverage when it is partial: "K-Ruoka 1,00 € halvempi yhteisissä 5/11 rivissä". It never states a difference between totals that cover different rows.
- The panel adds, when coverage is partial: how many rows both priced, how many only one chain priced, how many neither, and that the all-priced totals are not a saving on the whole basket.

Fixture explained: eleven rows; this store prices all for 30,00 €, the other prices five for 14,00 €. The raw totals differ by 16,00 € in the other chain's favour. On the five rows both sell, this store costs 13,00 € against 14,00 €, so the truthful statement is "this store is 1,00 € cheaper on 5 of 11 rows". `tests/compare.test.ts` checks this result, the four coverage counts, whole-pack and deposit reconciliation to the cent, and the rendered Finnish and English texts.

Not changed: comparison speed (accepted by the owner), offer conditions, and prices themselves. No live price survey was made.

The composer has no duplicate store button. Use the store selector at the top of the shopping page to change the selected store.
Clicking an already-open store or delivery selector cancels its unsaved selection and closes the panel, just like Cancel.
The offer ideas section has a 16-pixel gap below the composer so their borders and focus outlines remain separate.
