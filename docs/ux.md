# Korikone UX

Revised 9 October 2026. Follow the first-round refined feedback and redesign PDF. The original human feedback explains the friction; where they conflict, the refined direction takes precedence.

## Navigation and first use

Use a left rail: Ostoslista, Viikkosuunnitelma, Reseptit, Vakiotuotteet, Historia, Ostoskori and Asetukset. Keep Finnish/English switching available. Use the native Windows title-bar overlay. Keep the existing optional store/ChatGPT setup and a working manual path.

The everyday entry is the shopping list. Avoid a large hero, photo or weekday-entry grid. An empty note has starter ideas in one place. An empty list explains that groceries and their meal sources will appear there. Show only real local history and recurring items, never the mockup's invented weeks, prices or user name.

## Note and interpretation

One note accepts all requested meals and groceries: “Nakkikeitto, kanapasta, pakastepizza. Aamupalaksi jogurttia ja banaaneja. Herkkuja viikonlopuksi.” Do not add category toggles that repeat this input. Ready foods, breakfasts, evening foods and treats must be preserved.

Wait 1.8 seconds after typing before requesting interpretation. Ctrl+Enter and the arrow update immediately. Run one interpretation at a time and discard obsolete responses. The note remains editable while work runs. Show an animated activity state with readable status and cancellation; respect reduced motion. No invented percentage or completion estimate.

Show household size, date and branch as compact context. Explain the AI data flow next to the input. Connection, usage and validation errors preserve the saved list and offer retry or manual editing.

“Näin ymmärsin” displays a card for each meal/group. Show its type, ingredient count, approximate share of the quoted total, and portions. Selecting the card highlights the ingredient rows without hiding other rows. Ingredient cost shares are estimates because packages can be shared. Persist any portion assumptions from the interpretation.

Saved recipes are behind “Lisää valmiita reseptejä.” Pick a recipe and portions, then add its ingredients. No weekday is required. Remove a meal from its card. “Viikkosuunnitelma” is a separate optional view that starts from today's date and uses only cooked meals already on the list.

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

The transfer button opens one review with destination, before/after quantities, retained unrelated cart items, total and omitted unresolved requirements. The user can transfer available products while the missing ones remain on the list. Keep explicit live-product and budget acknowledgement in that review.

The result shows verified counts, omitted requirements, a return-to-list action and default-browser checkout. Interrupted transfers offer reconciliation before retry. Never describe a partial transfer as a complete list. Do not turn a transfer into purchase history; checkout and purchase confirmation remain separate.

## Receipts

Settings offers PDF, TXT and CSV import plus an editable text area. PDF text extraction is local and runs off the main thread. Only future AI note interpretation sends imported text to ChatGPT. Show distinct errors for unreadable/protected files, image-only PDFs needing OCR, and size limits. Import failure preserves all existing receipt text.

## Visual and interaction checks

Compare desktop, narrow and empty-state captures with the redesign. Check long Finnish names, row density, keyboard focus, disabled states, language switching, stale note responses, manual additions, home/removal behavior, additive quantities and clear-list. Keep transfer recovery and existing setup/form persistence tests. Live model and retailer behavior need user-account checks beyond automated fixtures.
