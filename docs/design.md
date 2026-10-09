# Korikone design

Revised 9 October 2026 after the first user feedback round. The current direction follows `scratch/feedback2.md` and `scratch/Korikone redesign.pdf`, with the original `scratch/feedback1.md` as context. The source PDF is a reference, not a claim about live prices or available products.

Korikone turns a household's plain-language shopping note into an editable, priced shopping list. Meals, ready foods, breakfasts, evening foods and treats belong in the same note. Product choices happen automatically; the user corrects exceptions and reviews the resulting cart changes. Checkout stays in the retailer.

Current published delivery: **0.2.0-alpha.3 pre-release**. See [pre-release scope and gates](pre-release.md). This stage preserves the current design and focuses on distributable builds and observed acceptance. Development and automated checks use local fixtures; live ChatGPT tests require an explicit user request.

## Product decisions

| Decision | Behavior |
| --- | --- |
| Note-driven shopping | One input replaces the competing prompt and weekday-entry controls. No setup toggles for categories already expressed in the note. |
| Visible interpretation | “Näin ymmärsin” cards show meals or grocery groups, ingredient counts, estimated cost shares and portions. Selecting a card highlights its list rows. |
| Explicit list updates | “Päivitä lista” / “Update list” and Ctrl+Enter request interpretation. Typing, returning to the shopping view and restoring an edited note start no AI request. Unapplied note changes have a visible hint. Editing during a request discards its obsolete response and does not start another request. |
| Retained quotes | Returning to the list or restarting restores compatible last quoted products, prices and pickup fees without catalogue requests. Explicit list, product or store changes fetch new quotes. Transfer review still checks current retailer data before any write. |
| Automatic product matching | Prefer an explicit saved selection when available. Otherwise choose sufficient packs at the lowest total cost within the brand preference. |
| Deterministic shopping calculations | AI supplies recipes and grocery amounts. Code merges ingredients, scales portions, chooses packs, computes totals and applies cart changes. |
| Separate optional scheduling | “Viikkosuunnitelma” shows seven days from today. Cooked meals move by drag and drop or arrow keys; days can be marked as leftovers. Calendar-only saves preserve shopping quantities, quotes and transfer approvals. “Kopioi viikko” copies these seven dates, meal names and leftovers as plain text in the selected language, without changing saved data. The saved `calendar` field maps ISO dates to `{ mealIds: string[], leftovers: boolean }`, defaults to empty for older profiles and is included in backups. |
| Local Windows app | Electron, React and TypeScript; local SQLite; Finnish first and English available throughout. |
| Manual checkout | A cart transfer is not an order or payment. Purchase confirmation alone advances recurring-item cadence. |

## Main workspace

Use a quiet green/white palette, a compact heading, a left navigation rail, a note and interpretation area, and a complete shopping list on the right. At narrow widths, stack the list below the note. Use the Windows title-bar overlay rather than drawing fake window buttons.

The note footer shows household size, current date and selected branch. Settings remain one click away. Explain that the note, recipes, household preferences and imported receipt text are sent to ChatGPT. Do not fabricate prices, history, account names or connection states from the mockup.

`src/ui/context.tsx` makes the header store and fulfillment labels actionable. Inline selectors keep provisional choices separate from saved state and use `getContextOptions`, `searchStores` and `changeContext({ context, revision })`. Opening/cancelling starts no catalogue or AI requests; only confirmation reprices groceries. The renderer applies the confirmed snapshot without remounting the note editor. Escape/cancel restores focus; confirmation restores it after controls are enabled. A failed lookup preserves the previous context and prices. See [context limits](integrations.md#confirmed-planning-context-u91-9-october-2026) for live pickup-only support and local-versus-retailer meaning.

Every list row includes the chosen product or unresolved ingredient, source meals, required amount, quantity controls, price when known, a home marker and removal (shown on hover or keyboard focus), and details that open from the product name with the product picker. Shared ingredients appear once with additive amounts and all source meals. “Löytyy kotoa” leaves a visible row but excludes it from matching and totals. Removal hides the row independently; restoring home items does not restore removed rows.

Manual additions accept decimal commas or points for kg and l, converted to integer g and ml. Base units and pieces require whole numbers. Matching names and units reuse the existing ingredient identity, so manual additions and recipe amounts share one row. Additions increase an explicit row quantity too, restore a removed row, and preserve its home marker. Invalid amounts leave the list and input intact.

Put clear-list and text export in the list menu. Keep the running total and the transfer button in a bar pinned to the bottom of the list column, which scrolls on its own; copy/save actions sit above it. Keep all rows available; do not collapse a long list behind “show more.” A missing quote is shown as unknown and excluded from the estimate.

Saved recipes are added through a disclosure, without choosing a day. Recurring items appear under “Unohtuiko jotain?” and can be added with one click. Existing enabled recurring items retain their cadence behavior. No purchase frequency is inferred from transfer history.

## AI interpretation and updates

`src/ai/draft.ts` validates JSON before any list change. It accepts multiple recipes, existing recipe references and direct grocery items. A recipe can be a cooked meal, ready food, breakfast, evening food or treat group. Frozen pizza stays a purchased food rather than becoming a recipe for homemade pizza.

Recipe-ID collisions are remapped with their references. Ingredient identities are reused for matching Finnish names and units, so shared ingredients add together. Markdown-wrapped JSON is accepted. Unknown references, duplicate incoming recipe IDs, invalid quantities and incomplete JSON are rejected. Validation failure triggers at most one corrective generation attempt. Network, authorization and usage failures do not trigger that retry.

On successful interpretation, replace the current generated list, persist the note and assumptions, and retain saved recipes. Manual list changes made after generation started invalidate its revision. The renderer ignores responses for an obsolete note or an unmounted workspace. Failures leave the saved list intact and show a persistent error. Users can retry with Ctrl+Enter or the labelled update button.

Cancel is available beside the note while generation runs. It aborts the request and invalidates pending drafts. The saved list stays intact and the typed note remains available for an explicit retry. Cancellation has its own status rather than a network-failure alert. Development mode exposes request counts in its snapshots for explicit-update, retry and cancellation checks.

Keep the saved list and quote stable through note edits, view return and restart. Check this separately from the button and shortcut updates using the [U8 owner-check steps](testing.md#explicit-update-owner-check-u83); record owner observations in acceptance rather than inferring them from fixture results.

The saved `aiModel` preference defaults to `auto` for older profiles and survives backup restore. Shared selectors below the note and in a separate ChatGPT Settings card edit it through `setAIModel`; preference changes preserve the note, quote, revision and review. Each explicit note or recipe request resolves one model before validation retries. Automatic recognizes small tiers from catalogue names; the catalogue exposes no comparable price metadata. If no small tier is identified, it requires an explicit selection. An unavailable saved choice remains visible and causes an actionable error without generation. OAuth, credentials, streaming completion checks and usage errors stay in the local AI provider. The renderer never receives tokens. There is no automatic paid API fallback.

## Product selection and transfer

The selection preference is lowest total pack cost, prefer store brands, or avoid store brands. Brand preferences are soft: if no matching brand candidate is usable, other available candidates remain eligible. An explicit product choice takes precedence. Household exclusion terms filter candidates before selection, including saved choices. Only products with known price, compatible unit and positive pack size/increment are automatically selected. This name-based filter cannot certify allergens or dietary suitability.

Alternatives are chosen in the row details. When a cheaper product for the same ingredient exists, the row shows the saving and the details offer the swap; undo stays on the row. Undo changes a local choice; it does not reverse a retailer write. Catalogue data cannot certify dietary suitability; the confirmation panel lists the products under "Näytä kaikki rivit" for the shopper to check.

Transfer flow:

1. The pinned transfer-and-open button names the destination, product count and quoted total. Its initial click approves that displayed batch, bound to its quote time, revision, context, products and quantities. Read the current cart and validate selected product quotes without substituting another batch.
2. Only exceptions require a confirmation panel: missing products, existing quantities and a budget overrun. Exact before/after quantities and retained unrelated items are under "Näytä kaikki rivit". A changed price or pack stops the flow and offers an explicit refresh before another approval. Cheaper alternatives stay on the shopping rows.
3. Apply an unchanged batch automatically. For exceptions, the confirm button approves the displayed changes; a separate checkbox accepts a budget overrun. Keep revision, account, store, price and quantity checks.
4. Journal each operation and read back the cart. A failure stops the batch and offers reconciliation; never blindly repeat an uncertain write.
5. Show verified and unresolved items in the same panel, with the next step. Save verified runs to local transfer history so they can be reused.
6. Automatically open the destination only after verification: K-Ruoka's basket in the default browser, or S-kaupat's authenticated Korikone list. A failed opening preserves the verified result and offers an open-only retry. The journal's `batchKey` prevents repeating the same approved batch across view return, refresh and restart. Reopening is safe; adding the same list again requires the explicit repeat action and exception approval. S-kaupat's "Lisää kaikki ostoskoriin" and checkout stay manual. The app does not copy browser cookies or claim K-Ruoka browser session continuity.

Unsupported weighted prices and ambiguous pack labels remain unresolved. A partial batch may transfer the available products only after the review lists what is excluded. It must not imply the complete list was transferred. Fees and unreported deposits remain outside the estimate.

## Receipts and history

Receipt import accepts PDF, TXT and CSV. A dedicated worker uses pinned Mozilla PDF.js to extract PDF text locally. Limits are 20 MB per file, 100 PDF pages, 50,000 saved characters, and a 30-second extraction timeout. Invalid, password-protected or textless PDFs produce a specific error and do not change saved receipt data. Scanned/image-only PDFs require OCR before import; automatic OCR is not implemented.

Imported text is visible and editable in settings. It is supplied as untrusted purchase data for subsequent AI suggestions, never as instructions. It is not sent to ChatGPT merely by importing it. Receipt storage is included in local backups.

The recipe-import API accepts pasted recipe text as untrusted data and requests one `recipeSchema` object. Notes and recipe import share one corrective retry for invalid output; usage and cancellation errors are not retried. Imported recipes reuse saved ingredient identities and receive a new ID if their ID collides with a saved recipe. The result stays in the temporary `recipeDraft` snapshot field, outside saved state and backups. Cancelling AI, signing out or restarting clears it. The review form and explicit save action are planned in F10.2; there is no recipe-import control yet.

The new `listHistory` records verified transfers, not completed purchases. Existing `history` entries keep the earlier-week schema and remain reusable through the History view; clearing the list archives its meals there. It stores the note, meal references, extras, home/removal flags and quantity overrides. Reusing an entry replaces the local list and obtains fresh quotes. Prices are not reused as current prices.

## Architecture

![Current architecture](architecture.svg)

- `src/ui`: note, interpretation, shopping list, schedule, history, recipes and settings.
- `src/domain`: versioned schemas, additive requirements, quantities and pack-cost matching.
- `src/application`: saved state, list application, product matching, review and journaled transfer.
- `src/ai`: protected ChatGPT authorization, model discovery and validated interpretation.
- `src/receipts`: local file reader and isolated PDF extraction worker.
- `src/stores`: demo providers and the pinned K-Ruoka and S-kaupat MCP adapters.
- `src/persistence`: SQLite storage and durable operation journal.
- `src/main`: restricted IPC, file dialogs, clipboard and default-browser handoff.

Schema defaults retain compatibility with older saved profiles. Language changes remain presentation-only and preserve quantities, typed notes, approvals and in-flight requests.

The latest successful quote is a separate SQLite document, `last-quote` (`development:last-quote` in development mode), outside `AppState`, JSON backups and diagnostics. It holds the basket, candidates, pickup fee, context and `quotedAt`. `src/application/quotes.ts` validates the document and binds it to the store/fulfillment context, computed requirements, accepted choices, exclusions and product preference. Language, calendar, budget and unrelated saved recipes do not invalidate it. Startup rejects malformed or incompatible documents without fetching replacements.

Explicit saved changes that affect this binding refresh prices through `Service.refreshAfterChange`. If the save succeeds but pricing fails, the snapshot retains the changed list, clears incompatible prices and exposes `pricingError` for a visible retry. A failed manual refresh preserves the previous successful quote. Quotes are published only after their cache write succeeds and their binding still matches the saved list. Cached prices never replace fresh transfer validation.

## Current boundaries

K-Ruoka and S-kaupat are implemented live adapters; both demo stores remain available. S-kaupat uses the pinned s-kaupat-mcp v1.2.0 release. It writes to the account's Korikone shopping list because S-kaupat has no server-side cart that the app can fill. The user then adds that list to the cart on the retailer site. Live acceptance is still required. The meal calendar is editable and saved locally; changes do not alter the shopping list. Recurring-item suggestions use configured items, not statistical receipt-frequency analysis. There is no direct phone sync, embedded retailer browser, automatic OCR, automatic checkout, loyalty optimization or shared household cloud service.

See [UX behavior](ux.md), [roadmap](roadmap.md), [dependency decisions](dependency-decisions.md) and [acceptance evidence](acceptance.md). Live model quality, retailer writes, browser account continuity and packaged installation require separate acceptance checks.
