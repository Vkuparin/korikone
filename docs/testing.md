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
| Mode persistence, profile isolation and forbidden live calls | `tests/development.test.ts`, `tests/ui/development.spec.ts` |

Fixtures recognize pasta, soup/keitto, porridge/puuro, coffee/kahvi and frozen pizza/pakastepizza. Unrecognized notes return a pasta example. This tests app behavior, not language-model quality. Add fixtures for new input cases and failure paths when adding features.

Settings exposes AI scenarios: `success`, `delayedSuccess`, `invalidOnce`, `invalidDraft`, `usageLimit`, `incompleteDraft` and `aiFailed`. `invalidOnce` exercises the real validation retry. `delayedSuccess` exercises changes to a note while a response is pending and request cancellation. The basket's Demo controls simulate a price change or a transfer interrupted after a write. Unit tests use mocked HTTP streams for partial output and server errors, and mocked account state for token refresh and model selection.

Run `npm test`, `npm run test:ui`, `npm run build` and `npm run format:check`. These checks do not use the owner's ChatGPT allowance. Test dependencies may download pinned worker files, and the OAuth callback test connects only to localhost.

## Live acceptance

Ask for live testing only after implementation and fixture checks pass. State what remains to verify, such as actual account authorization, model availability, retailer browser handoff or a reviewed cart write. Live ChatGPT requests require an explicit user request. Offline tests cannot prove a remote service's current behavior or the quality of live meal interpretation.
