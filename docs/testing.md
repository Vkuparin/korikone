# Fixture testing

Development mode runs the real app with local AI and retailer responses. It has a separate saved profile, including its transfer journal and carts. Enable it in Settings. Use `KORIKONE_DEVELOPMENT=1` to force it from the command line. Automated Electron tests use a temporary `KORIKONE_TEST_DATA` directory; this also prevents disabling development mode.

The app never initializes the live AI connection in development mode. AI sign-in, model selection, generation and sign-out use fixtures. Store search, login, catalogue lookup, review, transfer and recovery use fixture providers for both retailer IDs. Opening a retailer cart or the ChatGPT usage page stays local. File dialogs can be stubbed with fixture paths; receipt parsing, backup validation, exports and diagnostics run normally.

## Coverage

The v0.5.0 embedded sign-in fixtures use real local HTTP forms and cookies in each retailer's persistent Electron partition. `tests/ui/chains.spec.ts` covers successful and rejected sign-in, expiry, the second-chain hint and restart persistence. `tests/ui/setup.spec.ts` checks the one-screen setup. These paths do not replace login IPC handlers.

`tests/ui/store-journey.spec.ts` runs setup, one explicit note update and one transfer approval through to the selected retailer destination for both chains. It checks ten clicks including fixture sign-in and return, exactly one fixture generation, one application window and no external browser opening. `tests/ui/store.spec.ts` checks sandboxing and the S-kaupat add-all destination. Development store sessions reject non-local networking. Transfer exceptions remain covered separately.

`tests/s-kaupat-library.test.ts` exercises the released library with deterministic data. `tests/s-kaupat-tab.test.ts` runs the same mocked host-session contract against library and worker. K-Ruoka site tests also reject account or quantity changes between review and the final write boundary.

| Feature | Fixture checks |
| --- | --- |
| Onboarding, store selection, AI sign-in and settings | `tests/ui/setup.spec.ts`, `tests/ui/development.spec.ts` |
| AI draft validation, automatic model choice, retry and failures | `tests/ai.test.ts`, `tests/models.test.ts`, `tests/development.test.ts`, `tests/ui/development.spec.ts` |
| Recipe-import API (F10.1) | `tests/ai.test.ts` covers one recipe, schema failures, corrective retry, usage limit and cancellation; `tests/ui/recipe-import-api.spec.ts` runs the real IPC path and confirms imports never save recipes, including across restart |
| Delayed notes, stale results, recipes, quantities, home items, schedule and history | `tests/ui/shopping.spec.ts`, `tests/ui/forms.spec.ts`, `tests/service.test.ts`, `tests/domain.test.ts` |
| Matching, unavailable products, price changes, transfers and interrupted recovery | `tests/domain.test.ts`, `tests/service.test.ts`, `tests/ui/journey.spec.ts` |
| Retailer protocol and normalization | `tests/k-ruoka.test.ts`, `tests/s-kaupat.test.ts` (mock transports and the offline S-kaupat worker) |
| Receipt import, PDF extraction, backups, diagnostics and persistence | `tests/receipts.test.ts`, `tests/persistence.test.ts`, `tests/service.test.ts`, `tests/ui/shopping.spec.ts`, `tests/ui/backup.spec.ts` |
| Saved calendar schema, older profiles, restart and backup validation | Calendar cases in `tests/persistence.test.ts`; real backup export and restore in `tests/ui/calendar-backup.spec.ts` |
| Editable seven-day calendar | `tests/calendar.test.ts` covers local dates and meal moves; `tests/service-calendar.test.ts` covers quote preservation and failed saves; `tests/ui/calendar.spec.ts` covers drag, keyboard, leftovers, unknown meal IDs, restart and unchanged shopping total |
| Copy saved week | `tests/calendar.test.ts` checks Finnish and English text and omitted meal references; `tests/ui/calendar-copy.spec.ts` uses the real clipboard for both languages and an empty calendar, with no saved-state or basket changes |
| Mode persistence, profile isolation and forbidden live calls | `tests/development.test.ts`, `tests/ui/development.spec.ts` |
| Retained quotes (U8.2) | `tests/quotes.test.ts` covers compatibility, invalid cache, failed fetch/cache writes, stale responses and fresh transfer validation; `tests/persistence-quotes.test.ts` exercises real SQLite restart; `tests/ui/quotes.spec.ts` covers no quote, navigation, restart, Finnish/English labels, explicit store/list updates, a price rise and failed pricing with retry |
| Confirmed context API (U9.1) | `tests/context.test.ts` covers capabilities, no-op, remembered chains, pickup/delivery, unavailable choices, failed reads/writes and concurrent confirmation; `tests/ui/context-api.spec.ts` exercises real IPC, deterministic adapter failures, preserved note/groceries and restart |
| Header context selectors (U9.2) | `tests/ui/context.spec.ts` covers mouse/keyboard, Escape/cancel and focus return, Finnish/English labels, no-results and failed store search, provisional choices, confirmed repricing, unsupported delivery, adapter failure and retry. Fixture counters prove no AI requests and no catalogue requests from opening/cancelling |

Fixtures recognize pasta, soup/keitto, porridge/puuro, coffee/kahvi, frozen pizza/pakastepizza, nakkikeitto/sausage soup, kanapasta/chicken pasta, yoghurt-and-banana breakfast, and chocolate treats. The original multi-dish acceptance note retains its cooked meals, direct ready food, breakfast and snack groups. Unrecognized notes return a pasta example. This tests app behavior, not language-model quality. Add fixtures for new input cases and failure paths when adding features.

Development snapshots expose `developmentRequests`, counting started fixture generations since the scenario was selected. Note regression tests check zero requests from typing, waiting beyond the former pause, returning to the view and restoring edited text. The update button and Ctrl+Enter each start one generation. Cancellation, failure and edits during a request preserve the saved list until an explicit successful update. Counts apply only to fixtures; no live prompts or usage telemetry are recorded.

`developmentCatalogueRequests` counts fixture product searches in the current process. Quote checks assert zero calls on view return and restart, and new calls only for explicit fetches, pricing changes or transfer validation. The `catalogue` retailer scenario fails product searches locally; it checks that saved edits remain visible as unpriced and can be retried without another AI generation. Quote cache checks use the separate development profile and real persistence paths.

Synthetic PDF fixtures use explicit WinAnsi character encoding and correct byte offsets. Receipt tests cover Finnish accents, euro signs, parentheses, Helvetica and Courier, multiple-page order, textless and malformed files, 101-page rejection and the 20 MB file limit. Fixture data contains no customer information. Whitespace varies between fonts, so content assertions normalize spacing while checking character preservation and page order.

Settings exposes AI scenarios: `success`, `delayedSuccess`, `invalidOnce`, `invalidDraft`, `usageLimit`, `incompleteDraft` and `aiFailed`. `invalidOnce` exercises the real validation retry. `delayedSuccess` exercises changes to a note while a response is pending and request cancellation. The basket's Demo controls simulate a price change or a transfer interrupted after a write. Unit tests use mocked HTTP streams for partial output and server errors, and mocked account state for token refresh and model selection.

During implementation, run focused unit tests for the changed feature, such as `npm test -- tests/receipts.test.ts` or `npm test -- tests/development.test.ts -t "multi-dish"`. Add focused desktop checks when interaction or real IPC behavior needs verification. Run full unit and desktop suites only when preparing a release; that gate also includes the build, formatting and relevant packaged-app checks. These checks do not use the owner's ChatGPT allowance. Test dependencies may download pinned worker files, and the OAuth callback test connects only to localhost.

## Live acceptance

### Explicit-update owner check (U8.3)

Use the current source build with an existing priced list. Development mode uses local fixtures and no ChatGPT allowance. A live check requires an explicit request and two successful ChatGPT generations, one for each update action; invalid output can cause one corrective retry per action. Typing, navigation and restart should use no generations or catalogue requests. Explicit updates also read the retailer catalogue; this check transfers no products.

1. Note the current meals, rows, total and quote time. Edit the note without updating. Check the unapplied-edit hint and unchanged list and prices; no update progress should appear.
2. Open Recipes and return to Shopping list; check that the edited note remains. Restart the app. Check that the saved rows, total and quote time remain, without interpretation or pricing progress. Unsaved note edits stay in the current window session; restart restores the saved note.
3. Press “Päivitä lista” / “Update list”. Check that update progress and cancellation appear while it runs, then that the completed list matches the applied note and has a quote time.
4. Edit the note again and press Ctrl+Enter. Check the same progress and completed-list behavior. Record the build/commit, mode, date, observations and any failures in `docs/acceptance.md`.

Automated counterparts are the explicit-update and obsolete-response cases in `tests/ui/shopping.spec.ts`, the retained-quote restart case in `tests/ui/quotes.spec.ts`, and the explicit button/validation retry in `tests/ui/development.spec.ts`. These fixture checks do not establish an owner-observed result.

### Header context owner check (U9.3)

Use the current source build with a priced list. In development mode, both chains, fulfillment choices, fees and failures use local fixtures. A live check needs read-only retailer access for confirmed price/fee reads and no ChatGPT generations. It changes only Korikone's planning context; no transfer, retailer address or time selection is part of the check.

1. Edit the note without updating the list. Open each header selector and cancel, once by button and once by Escape. Check focus returns to the opener and the typed note, groceries, total and quote time stay intact.
2. Open the store selector, search, choose another store and confirm. Check progress, the new header store and refreshed quote, unchanged note/groceries, and focus return. In development mode, `alternate` searches return another store for both chains; `no-results` and `search-error` exercise empty results and retry.
3. Open fulfillment and change pickup/delivery where supported. Check the header and fees update after confirmation. Development supports both; `pickup-only` stores and live adapters show delivery unavailable with an explanation. No address or time is selected.
4. Record the tested commit, mode, date and observed result in `docs/acceptance.md`. Report any unclear control, unexpected list change or failed focus return.

Ask for live testing only after implementation and fixture checks pass. State what remains to verify, such as actual account authorization, model availability, retailer browser handoff or a reviewed cart write. Live ChatGPT requests require an explicit user request. Offline tests cannot prove a remote service's current behavior or the quality of live meal interpretation.

## One-action transfer and model checks (0.4.0)

`tests/ui/settings-info.spec.ts` compares Settings/About with the real runtime version. Its source fixture uses an isolated alpha manifest to check the suffix; the packaged run checks the actual executable. It checks language-menu keyboard selection, Escape/focus return, selected state, the menu at 1280 × 800, unsaved note preservation and language restart persistence. `forms.spec.ts` retains the unsaved decimal-comma recipe check. The same Settings check covers unavailable ChatGPT allowance while disconnected/connected, a failed model read, a fixture request limit without list changes, and sign-out. The fallback makes no allowance request or inferred quota calculation; opening the usage action in development mode opens no remote page.

`tests/service.test.ts` covers initial-click approval, displayed-batch identity, budget and existing-quantity exceptions, missing rows, changed prices/packs, concurrent presses, account changes, restart and duplicate protection. Existing domain tests retain durable journalling, changed-cart rejection, cancellation and uncertain-write reconciliation. `tests/ui/confirm.spec.ts` exercises an exception cancellation followed by a one-click S-kaupat transfer; `tests/ui/journey.spec.ts` exercises recovery. `tests/ui/transfer-api.spec.ts` uses real IPC and a fixture opening failure to verify open-only retry with the same journal. Development handoffs are recorded as chain/destination names only and open no remote pages.

`tests/models.test.ts`, `tests/service.test.ts` and `tests/persistence.test.ts` cover selection rules, unchanged quote/review, older profiles, SQLite restart and backup restore. `tests/ui/models.spec.ts` exercises both selectors, keyboard focus, long names at 1280 x 800, zero generations from preference changes, the next explicit note/recipe model, restart, removed selections, empty/failed catalogues and no recognized small model. The `delayedModels` fixture verifies cancellation during both catalogue checks for note updates and recipe imports, with zero generations and unchanged saved lists. `developmentModelCatalogueRequests` records only fixture lookup counts for this check. Fixture snapshots expose `developmentModel`, not prompts or credentials. Other model scenarios are `noSmallModel`, `removedModel`, `emptyModels` and `modelsFailed`; `handoffFailed` fails storefront opening after a verified transfer.

Owner check after fixture and release checks pass: transfer a small displayed batch to each chain, compare quantities and automatic destination opening, reopen without additions, and verify checkout remains manual. This writes retailer baskets/lists and needs no ChatGPT generations. Separately find and change both model selectors, restart, then check one Automatic and one explicit-model note request. This needs two successful ChatGPT generations, with at most one corrective validation retry per request. Development-mode observation can check interaction with zero live requests. Record observations in acceptance; automated results do not establish live behavior.
