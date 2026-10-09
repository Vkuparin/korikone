# Korikone UX

Revised 9 October 2026. Follow the first-round refined feedback and redesign PDF. The original human feedback explains the friction; where they conflict, the refined direction takes precedence.

## Navigation and first use

Use a left rail: Ostoslista, Viikkosuunnitelma, Reseptit, Historia and Asetukset. Vakiotuotteet opens from Asetukset and from "Unohtuiko jotain?". There is no separate basket page: product details open from a list row, and the transfer is confirmed in the list column. Keep Finnish/English switching available. Use the native Windows title-bar overlay. Keep the existing optional store/ChatGPT setup and a working manual path.

The everyday entry is the shopping list. Avoid a large hero, photo or weekday-entry grid. An empty note has starter ideas in one place. An empty list explains that groceries and their meal sources will appear there. Show only real local history and recurring items, never the mockup's invented weeks, prices or user name.

## Note and interpretation

One note accepts all requested meals and groceries: “Nakkikeitto, kanapasta, pakastepizza. Aamupalaksi jogurttia ja banaaneja. Herkkuja viikonlopuksi.” Do not add category toggles that repeat this input. Ready foods, breakfasts, evening foods and treats must be preserved.

Only “Päivitä lista” / “Update list” or Ctrl+Enter requests interpretation. Typing, returning to the view and restoring an edited note do not submit. Show “Muistiinpanoa ei ole päivitetty listaan” / “Note changes have not been applied to the list” when the note differs from the saved list's note. Run one interpretation at a time and discard obsolete responses. The note remains editable while work runs, and an edit during a request does not submit a follow-up request. Show an animated activity state with readable status and cancellation only while an explicit update runs; respect reduced motion. No invented percentage or completion estimate.

Show household size, date and branch as compact context. Explain the AI data flow next to the input. Connection, usage and validation errors preserve the saved list and offer retry or manual editing.

The store name and pickup/delivery label above the note are buttons. Each opens an in-place selector with the current choice, confirm and cancel. Escape closes it and returns focus to its button. Opening, searching stores and cancelling start no catalogue or AI requests. Store search shows remembered choices, empty results and errors; changing a choice remains provisional until confirmation. Confirmation prices the unchanged groceries before saving the context. A failed lookup preserves the previous selection and quote and offers retry. Successful changes keep the typed note and refresh product prices and pickup fees without interpreting the note. Live delivery is disabled with an explanation; selecting a planning context does not select a retailer address or time.

“Näin ymmärsin” displays a card for each meal/group. Show its type, ingredient count, approximate share of the quoted total, and portions. Selecting the card highlights the ingredient rows without hiding other rows. Ingredient cost shares are estimates because packages can be shared. Persist any portion assumptions from the interpretation.

Saved recipes are behind “Lisää valmiita reseptejä.” Pick a recipe and portions, then add its ingredients. No weekday is required. Remove a meal from its card. “Viikkosuunnitelma” is a separate optional view with seven days from today and only cooked meals already on the list. Drag a meal onto a day, or focus it and use arrow keys to move one day at a time. Delete returns it to “Ei päivää”. “Luonnostele viikko” distributes current meals across the seven days. A day can be marked “Tähteitä”. Each change is saved automatically and keeps the shopping list and its quoted total unchanged.

“Kopioi viikko” copies one plain-text line per visible day: the day name in the selected language, ISO date, scheduled meal names and any leftovers flag. Empty days say “Vapaa” or “Open”. Unscheduled meals and removed meal references are omitted. The button confirms copying with “Viikko kopioitu” or “Week copied”; it resets when the exported text changes. Copying does not alter the calendar or shopping list.

## Shopping rows

The list stays on the right on desktop and moves below the note in narrow windows. Use compact category headings and rows. No hidden tail of the list.

Each row contains a product name (or unresolved ingredient), required amount, source meals, pack quantity when quoted, cost, home marker, remove action and optional replacement picker. All controls have text or accessible labels. Highlighting and selection must not rely solely on color.

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

Show “Viimeksi haetut hinnat” / “Last quoted prices” with the quote time. Returning to the list and restarting keep these prices without a catalogue request. If there is no compatible quote, show “Ei hinnoiteltu” / “Not priced” and “Hae tuotteet ja hinnat” / “Get products and prices”. Explicit list, product and store changes refresh pricing. If an edit saves but pricing fails, show the saved rows as unpriced, a persistent error and the same retry action. The list menu also offers a manual refresh. Transfer review checks current prices and stops on a changed price or pack before writing.

The total and transfer button stay pinned under the list. The button names the actual basket or list destination, product count and quoted total. Its initial click approves the displayed batch, checks current data, transfers and opens the destination after verification. Show progress while it runs. Only missing products, existing quantities, a budget overrun or interrupted transfers need another decision. Changed prices or packs require an explicit refresh and a new approval. Cheaper alternatives remain on rows. Before/after quantities and retained cart items are under "Näytä kaikki rivit"; only a budget overrun needs a separate checkbox.

The result shows in the same panel: verified counts, omitted requirements and a close action. K-Ruoka opens the default browser automatically. S-kaupat opens its authenticated list and explains that the user must add the Korikone account list to the cart. Opening failures offer an open-only retry. Repeated approval of the same batch reopens it without adding products; the separate repeat action requires approval of additional quantities. Interrupted transfers offer reconciliation before retry. Never describe a partial transfer as a complete list. Do not turn a transfer into purchase history; checkout and purchase confirmation remain separate.

The compact AI model selector below the note shares its saved choice with the separate "ChatGPT ja tekoäly" / "ChatGPT and AI" Settings card. Automatic is the default and prefers an available small model to reduce usage. Settings explains that size is inferred from names and exact prices are unknown. If no suitable small model is found, ask for an explicit choice. Disconnected, empty, failed and unavailable-selection states explain the next action. Loading or changing models never submits the note or changes its list and prices. A request retains the model it started with through validation retries.

## Receipts

Settings offers PDF, TXT and CSV import plus an editable text area. PDF text extraction is local and runs off the main thread. Only future AI note interpretation sends imported text to ChatGPT. Show distinct errors for unreadable/protected files, image-only PDFs needing OCR, and size limits. Import failure preserves all existing receipt text.

## Visual and interaction checks

Compare desktop, narrow and empty-state captures with the redesign. Check long Finnish names, row density, keyboard focus, disabled states, language switching, stale note responses, manual additions, home/removal behavior, additive quantities and clear-list. Keep transfer recovery and existing setup/form persistence tests. Live model and retailer behavior need user-account checks beyond automated fixtures.

For explicit updates and retained quotes, use the [U8 owner-check steps](testing.md#explicit-update-owner-check-u83): edit without updating, leave and return, restart, then update by button and Ctrl+Enter. Verify stable rows and quote time before an update and visible progress only while it runs. Record the mode and observed result in acceptance.

## Preserved store and support features

Both retailers remain searchable during setup. Settings lists K-Ruoka and S-kaupat side by side, each with its own sign-in state, remembered store and a *Use this store* action; one is marked active, and switching keeps the other chain signed in. Setup shows the other chain below the chosen store. Keep S-kaupat sign-out and its authenticated handoff. Redacted diagnostic export stays in settings. Household exclusion terms filter products before automatic selection. The basket detail view retains decision reasons, unit prices, surplus and omission. Earlier-week reuse remains available in History alongside the new verified-transfer history.
