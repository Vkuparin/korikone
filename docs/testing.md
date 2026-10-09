# Fixture testing

Development mode runs the real app with local AI and retailer responses. It has a separate saved profile, including its transfer journal and carts. Enable it in Settings. Use `KORIKONE_DEVELOPMENT=1` to force it from the command line. Automated Electron tests use a temporary `KORIKONE_TEST_DATA` directory; this also prevents disabling development mode.

The app never initializes the live AI connection in development mode. AI sign-in, model selection, generation and sign-out use fixtures. Store search, login, catalogue lookup, review, transfer and recovery use fixture providers for both retailer IDs. Opening a retailer cart or the ChatGPT usage page stays local. File dialogs can be stubbed with fixture paths; receipt parsing, backup validation, exports and diagnostics run normally.

## Coverage

| Feature | Fixture checks |
| --- | --- |
| Onboarding, store selection, AI sign-in and settings | `tests/ui/setup.spec.ts`, `tests/ui/development.spec.ts` |
| AI draft validation, automatic model choice, retry and failures | `tests/ai.test.ts`, `tests/models.test.ts`, `tests/development.test.ts`, `tests/ui/development.spec.ts` |
| Delayed notes, stale results, recipes, quantities, home items, schedule and history | `tests/ui/shopping.spec.ts`, `tests/ui/forms.spec.ts`, `tests/service.test.ts`, `tests/domain.test.ts` |
| Matching, unavailable products, price changes, transfers and interrupted recovery | `tests/domain.test.ts`, `tests/service.test.ts`, `tests/ui/journey.spec.ts` |
| Retailer protocol and normalization | `tests/k-ruoka.test.ts`, `tests/s-kaupat.test.ts` (mock transports and the offline S-kaupat worker) |
| Receipt import, PDF extraction, backups, diagnostics and persistence | `tests/receipts.test.ts`, `tests/persistence.test.ts`, `tests/service.test.ts`, `tests/ui/shopping.spec.ts`, `tests/ui/backup.spec.ts` |
| Saved calendar schema, older profiles, restart and backup validation | Calendar cases in `tests/persistence.test.ts`; real backup export and restore in `tests/ui/calendar-backup.spec.ts` |
| Editable seven-day calendar | `tests/calendar.test.ts` covers local dates and meal moves; `tests/service-calendar.test.ts` covers quote preservation and failed saves; `tests/ui/calendar.spec.ts` covers drag, keyboard, leftovers, unknown meal IDs, restart and unchanged shopping total |
| Copy saved week | `tests/calendar.test.ts` checks Finnish and English text and omitted meal references; `tests/ui/calendar-copy.spec.ts` uses the real clipboard for both languages and an empty calendar, with no saved-state or basket changes |
| Mode persistence, profile isolation and forbidden live calls | `tests/development.test.ts`, `tests/ui/development.spec.ts` |

Fixtures recognize pasta, soup/keitto, porridge/puuro, coffee/kahvi, frozen pizza/pakastepizza, nakkikeitto/sausage soup, kanapasta/chicken pasta, yoghurt-and-banana breakfast, and chocolate treats. The original multi-dish acceptance note retains its cooked meals, direct ready food, breakfast and snack groups. Unrecognized notes return a pasta example. This tests app behavior, not language-model quality. Add fixtures for new input cases and failure paths when adding features.

Development snapshots expose `developmentRequests`, counting started fixture generations since the scenario was selected. The note regression test checks one request after a typing burst, cancellation without changing the saved list or automatically submitting an edited note, failure without an automatic retry, and an explicit retry. Counts apply only to fixtures; no live prompts or usage telemetry are recorded.

Synthetic PDF fixtures use explicit WinAnsi character encoding and correct byte offsets. Receipt tests cover Finnish accents, euro signs, parentheses, Helvetica and Courier, multiple-page order, textless and malformed files, 101-page rejection and the 20 MB file limit. Fixture data contains no customer information. Whitespace varies between fonts, so content assertions normalize spacing while checking character preservation and page order.

Settings exposes AI scenarios: `success`, `delayedSuccess`, `invalidOnce`, `invalidDraft`, `usageLimit`, `incompleteDraft` and `aiFailed`. `invalidOnce` exercises the real validation retry. `delayedSuccess` exercises changes to a note while a response is pending and request cancellation. The basket's Demo controls simulate a price change or a transfer interrupted after a write. Unit tests use mocked HTTP streams for partial output and server errors, and mocked account state for token refresh and model selection.

During implementation, run focused unit tests for the changed feature, such as `npm test -- tests/receipts.test.ts` or `npm test -- tests/development.test.ts -t "multi-dish"`. Add focused desktop checks when interaction or real IPC behavior needs verification. Run full unit and desktop suites only when preparing a release; that gate also includes the build, formatting and relevant packaged-app checks. These checks do not use the owner's ChatGPT allowance. Test dependencies may download pinned worker files, and the OAuth callback test connects only to localhost.

## Live acceptance

Ask for live testing only after implementation and fixture checks pass. State what remains to verify, such as actual account authorization, model availability, retailer browser handoff or a reviewed cart write. Live ChatGPT requests require an explicit user request. Offline tests cannot prove a remote service's current behavior or the quality of live meal interpretation.
