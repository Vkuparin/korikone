# Store integration decisions

Research date: 8 October 2026. Update: s-kaupat-mcp v1.0.0 is released and adopted; see [S-kaupat integration](s-kaupat-mcp-plan.md) for the pinned artifact, adoption-gate results and Korikone's adapter. The rest of this page is the original research. It is a documentation and limited source review, not a live integration test or security audit. No retailer account was accessed and no cart was changed. Branch URLs are research references, not pinned dependencies. Pin and record exact revisions before adoption.

## Recommendation

Use a narrow local adapter around `k-ruoka-mcp` for K-Ruoka, subject to license, packaging and contract checks. Build `s-kaupat-mcp` in its own repository first, release it independently, and consume a pinned version from Korikone. Use `mcp-ruoka` as a catalogue feasibility reference; do not ship a second all-chain server by default.

This gives Korikone two equivalent integration boundaries and keeps retailer maintenance independent of meal-planning features. A new retailer adds an adapter and contract fixtures without changing household planning.

## Browser approach and component compatibility

The accepted plan review of 8 October 2026 added an early comparison of managed browser sessions and a minimal extension. The [S-kaupat S0 plan](s-kaupat-mcp-plan.md) owns the experiment and records a choice before implementation. Existing MCP research does not establish that an extension can reproduce the same authenticated operations. Prove that separately. Do not commit to both transports or a second user interface.

Keep K-Ruoka reuse conditional on its installation and same-cart handoff tests. A different S-kaupat transport does not by itself justify rewriting K-Ruoka. Test combined onboarding and make session identity explicit inside both adapters.

Pin release artifacts and also validate supported protocol/schema versions and required capabilities at startup. An incompatible worker or bridge must produce an update/reconnect action before any mutation. Include mismatched versions in the contract suite. The independent S-kaupat release includes any bridge it requires and remains usable without Korikone.

## What the existing projects establish

| Project | Evidence reviewed | Implication for Korikone |
|---|---|---|
| [nikosavola/k-ruoka-mcp](https://github.com/nikosavola/k-ruoka-mcp) | README describes store/product search, account status, browser login, personal offers, cart reads and mutations. `add_to_cart` sets a resulting quantity; cart item IDs differ from EANs. Anonymous carts can appear valid. It also exposes `clear_cart`. | Strong candidate for K-Ruoka. Require explicit account checks, normalize quantity semantics, and exclude bulk clearing. Order history is not established by the documented tool surface. |
| [p18a/mcp-ruoka](https://github.com/p18a/mcp-ruoka) | README documents product/store search for K-Ruoka, S-kaupat and Alko. S-kaupat uses persisted GraphQL queries. | Useful evidence for catalogue access, not evidence of authenticated S-kaupat cart support. Alko is outside Korikone's scope. |
| [mcp-ruoka server entrypoint](https://github.com/p18a/mcp-ruoka/blob/main/src/index.ts) | Registers search and store tools; supports stdio and HTTP. Its startup warms multiple chains. | Prefer selective catalogue research over shipping unrelated browser startup and an HTTP service. MCP transport authentication is separate from grocery-account authentication. |
| [mcp-ruoka package manifest](https://github.com/p18a/mcp-ruoka/blob/main/package.json) | Bun-based TypeScript project with MCP SDK, Playwright and stealth-related dependencies; the inspected manifest has no license field. | Reuse would add packaging work. Absence of a field does not establish the repository's license; confirm actual reuse rights before copying or distributing code. |

The K-Ruoka README also warns that some invalid cart operations can return apparent success. Its described behavior is a reason to require application-level readback, not a guarantee that current store behavior matches it. [K-Ruoka documentation](https://github.com/nikosavola/k-ruoka-mcp).

The S-kaupat [browser module](https://github.com/p18a/mcp-ruoka/blob/main/src/browser/s-kaupat.ts), [search tool](https://github.com/p18a/mcp-ruoka/blob/main/src/tools/search.ts) and [store tool](https://github.com/p18a/mcp-ruoka/blob/main/src/tools/stores.ts) are investigation starting points. Verify catalogue completeness, pack units, store scope and query refresh behavior against sanitized fixtures and a small live smoke test. Do not infer cart, loyalty-price or order-history support from search results.

## Adoption gates

Before bundling either upstream dependency:

- Resolve the license and redistribution terms for the exact revision, dependencies and browser components. Public source visibility alone is insufficient. This review did not establish redistribution permission for either project.
- Read executable startup, authentication, network and cart paths. Record outbound hosts, session locations and tool schemas. Do not run installation hooks against a real grocery profile during review.
- Package a pinned release with checksums. Users must not install a compiler, Bun, Docker or an MCP client. Verify clean-machine launch, process shutdown and browser/profile locking.
- Test tool results and `isError` handling over a real MCP connection with fake retailer responses. Translate into stable typed domain errors, not string matching scattered through the UI.
- Run one deliberately small, user-observed account/cart test. Record exact quantity behavior, weight units, authentication status and readback. Do not touch checkout automatically.

If K-Ruoka reuse fails a gate, keep the adapter interface and implement the smallest independent replacement or seek an upstream fix. Do not silently bundle unreviewed code to keep the schedule. Prefer upstream contributions for fixes that belong to the server; keep household policy in Korikone.

## Why a separate S-kaupat project

`mcp-ruoka` covers the discovery problem. Korikone also needs durable login, correct identification of the authenticated cart, quantity semantics, conflict handling and a human checkout handoff. Those need their own implementation and tests.

Model the new project after the useful boundaries of `k-ruoka-mcp`: a local process, user-driven login, focused store/cart tools, protected sessions, readable failures and verified writes. Do not assume K-Ruoka endpoints, cookies, identifiers or purchase units apply to S-kaupat. Bulk clear and checkout are deliberately omitted.

The new repository contains a reusable S-kaupat client and a thin stdio MCP server. Korikone consumes the server release, so it need not depend on the client's language or browser internals. Standalone MCP clients can use the same artifact. Remote hosting, multi-user sessions, order history and personalized offers are later work.

See [s-kaupat-mcp-plan.md](s-kaupat-mcp-plan.md) for the prerequisite release and handoff contract.

## ChatGPT and MCP compatibility

The current ChatGPT plan-usage preview excludes hosted MCP/connectors. It permits supported local function/custom tool execution, but Korikone does not need to hand retailer tools to the model: its local application can call MCP during deterministic matching and approved transfers. Keep OAuth credentials in the AI runtime and retailer sessions in their respective worker processes. [OpenAI preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

There is no public MCP endpoint, hosted worker or shared retailer session in v1. A new AI connection is not a new grocery connection. A store login does not authorize AI usage.

## Confirmed planning context (U9.1, 9 October 2026)

`Service.getContextOptions(context?)` returns a snapshot with `contextOptions: { context, fulfillments }`, without catalogue or AI requests. Only the active store, a per-chain remembered store or a result from `searchStores` can be proposed. The service uses that store's known name rather than trusting a supplied display name. `changeContext({ context, revision })` checks that the confirmation still refers to the saved list, reads supported fulfillment choices, then prices the unchanged requirements at the proposed store before saving. Lookup or state-save failure leaves the previous context, quote and approval intact. Concurrent transfers are blocked during confirmation. A successful change updates the active context and its per-chain remembered store, invalidates the review/comparison and stores a compatible quote. A failed quote-cache write after the state save returns the saved context as unpriced with `pricingError`, rather than claiming a durable quote.

These methods are exposed through restricted Electron IPC. They change Korikone's local planning context and read catalogue prices and pickup fees. They do not change a retailer basket/list, select a time, choose an address, generate a note or sign out either chain. K-Ruoka catalogue and cart calls already pass the store explicitly; cart reads reject a mismatched store. S-kaupat catalogue/list calls also pass the store explicitly. The new context path does not call S-kaupat's `select_store`, so it does not claim to change the retailer site's own selected store. The existing Settings `save` path still makes that session selection best effort; U9.2 must use the confirmed API for the new header controls.

The live fulfillment select was disabled because the adapters do not establish a complete delivery choice. Both live adapters currently expose pickup only through the confirmed API. K-Ruoka search reports pickup/home-delivery flags but Korikone retains only pickup-capable web stores; those flags do not establish an address or selected delivery session. S-kaupat delivery needs an address that Korikone does not collect. Delivery therefore returns `fulfillmentUnavailable` before fetching prices or changing state. Pickup remains a local planning choice; time selection and checkout stay in the retailer. Missing or failed fee readings remain unknown, never zero.

Development providers expose pickup and delivery locally. Search terms `alternate` and `pickup-only` provide another store and a pickup-only store. The `context` scenario fails fulfillment reads and `catalogue` fails product searches. `tests/context.test.ts` and `tests/ui/context-api.spec.ts` cover those boundaries, real validation/persistence, remembered chains, note preservation, failure and restart without live accounts. U9.2 remains responsible for selectors, unavailable-option explanations and updating the renderer with returned snapshots.

## Delivery and pickup fees (F3.1, 9 October 2026)

What each pinned worker reports about fees without choosing a time:

- **S-kaupat (s-kaupat-mcp 1.3.0).** `get_delivery_options` with only a store ID lists that store's pickup places (store pickup and pickup locker), each with a base `price` in euros and the `nextSlot` with that time's own `price`. It is marked read-only and needed no login in the server's demo mode. Fees vary by time: in demo data store pickup is 3,90 € and an evening time 5,90 €. `get_delivery_slots` gives every time's fee for up to 14 days, but it is a slot tool, and the per-time detail is not needed for an estimate. Home delivery and express need a location from `find_address`, which means the shopper's home address. Korikone does not ask for or store it, so delivery fees stay unknown.
- **K-Ruoka (k-ruoka-mcp 0.1.3).** The worker has eight tools: `search_stores`, `set_default_store`, `search_products`, `get_cart`, `add_to_cart`, `update_cart_item`, `remove_from_cart` and `clear_cart`. Stores report only `hasPickup` and `hasHomeDelivery`. The cart has a `priceSummary` with `itemsSubTotal` and `grandTotal`, but no time is chosen through the worker, so no fee is known. K-Ruoka fees stay unknown.

Decision for F3.2: allow only `get_delivery_options` for S-kaupat. For pickup at the chosen store, show a range from the lowest to the highest price it reports, labelled as depending on the pickup time. Show "unknown" for home delivery and for K-Ruoka. The comparison keeps item totals and fees apart, so an unknown fee never looks like a free one. A live read of `get_delivery_options` for the owner's store is part of the F3 live check; it needs no login and changes nothing.

## Model catalogue and transfer handoff (0.4.0)

The existing ChatGPT catalogue adapter reads `slug`, `display_name` and `visibility`; it exposes no comparable price or size metadata. Automatic recognizes small tiers from names (luna, nano, mini, small, lite or flash) and preserves catalogue order within that tier. This is a size inference, not a price guarantee. Unknown names require an explicit choice. Each note or recipe operation resolves the saved `aiModel` once; validation retries keep that slug and fail if it is no longer available.

The request's cancellation identity is allocated before model lookup. `cancelAI` aborts the lookup and invalidates that identity; both the initial selection and the provider's availability check accept its abort signal. A cancelled catalogue response cannot start a generation or restore a cancelled draft.

### ChatGPT allowance feasibility (U13, 9 October 2026)

The bounded review of official Sign in with ChatGPT account/session, model/inference and error documentation found no documented endpoint or response schema for reading remaining plan allowance or reset times with Korikone's existing `chatgpt.tokens.use.direct` grant. This is the result of the reviewed documentation, not a claim that no private endpoint exists. The supported usage route is a link to [ChatGPT Settings → Usage](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions#tracking-usage). API organization usage and rate-limit headers represent different limits and cannot provide this account's allowance.

The [official error guidance](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery#structured-responses-errors) says `subscription_sharing_usage_limit_exceeded` can mean an app-specific limit and does not establish that the whole plan is exhausted or reveal a reset time. Korikone currently maps HTTP 429 to `usageLimit`; the UI therefore says the request hit a usage or rate limit, without identifying the exact allowance. No usage meter, percentage, reset prediction, new billing route or private scrape is added. Settings always explains that allowance/reset information is unavailable and retains the usage-page action. The last request's limit indication is retained in the current renderer session for Settings, cleared on sign-out or a later request result, and never treated as a numeric allowance. Development mode suppresses the external usage page and uses local failures for these checks.

`transferDisplayed({ revision, quotedAt, batchKey })` approves the displayed quote and returns an exception or a verified/partial journal. Snapshots expose `transferBatchKey` and `transferException`; exceptions never substitute products. `execute({ id, acknowledged })` approves an exception or reconciled review. A durable journal `batchKey` retains repeat protection independently of changing quote timestamps. `openStoreCart` checks the verified journal's account and opens only that chain's destination. Main-process orchestration calls it automatically after verification and preserves success with `handoffError` if opening fails. U3.6 can reroute that same handoff into the embedded store view later; the current S-kaupat destination remains the Korikone list.
## S-kaupat inside an Electron view (U3.1, 9 October 2026)

Run on the owner's PC from a throwaway script outside `src/`: s-kaupat.fi in a `WebContentsView` in its own `BaseWindow`, with `session.fromPartition("persist:s-kaupat")`, no preload, context isolation and sandbox on, and Electron's default user agent. The owner signed in by hand. Nothing was written to a list or cart, and no checkout or payment page was opened. One sign-in on one day.

- **Bot protection.** The site loaded (HTTP 200) signed out and signed in with Electron's default user agent. No other user agent was tried or needed.
- **Login.** Sign-in works embedded through ordinary redirects: s-kaupat.fi → auth.tunnistus.s-ryhma.fi → tunnistus.s-ryhma.fi (S-ryhmä's own login, with MTCaptcha, which the owner passed by hand) → authorization.voikukka.fi callback (the Kauppa view allows voikukka.fi without asking since 9 October 2026; the owner was asked once before, and met the captcha again on a later sign-in, which is S-ryhmä's own) → s-kaupat.fi/kirjautuminen → front page. The S-ryhmä page (S-tunnus) offers an e-mail address with a one-time code or sign-in by text message, plus creating a new S-tunnus. No bank ID or social sign-in. The owner used e-mail and code.
- **Where the session lives.** In the site's localStorage on www.s-kaupat.fi, not in cookies. After sign-in no s-kaupat.fi cookie carries the login; only analytics cookies are set. The likely key is `session-storage`, which also exists signed out; its contents were not read. The identity provider keeps its own cookies on auth.tunnistus.s-ryhma.fi (`session_id`, `current_sessions`, `rp_origin_id` HTTP-only, `session_state`, `opbs`). A persistent partition keeps both.
- **Requests from the page.** `fetch` from the page to api.s-kaupat.fi with `RemoteStoreSearch`, the query behind s-kaupat-mcp's `search_stores`, returned HTTP 200 and 3 stores for "Herttoniemi", signed out and signed in. No authenticated query was tried yet; that belongs to U3.3.
- **New windows.** A deny-all `setWindowOpenHandler` was installed and never called: neither the front page nor the login opened a window. How payment and bank links open is still unknown, because no checkout was visited. U3.4 must keep its window-open handling and check this on the first checkout the owner does in the store tab.

Conclusion: S-kaupat can run inside Korikone in its own persistent session. U3.3 (s-kaupat-mcp using a host page) and U3.4 (the store view) can proceed. The session token is read by the page's own code from localStorage, so a host-page mode should call the API from the page context rather than copy the token.

## K-Ruoka inside an Electron view (U3.2, 9 October 2026)

Run on the owner's PC from a throwaway script outside `src/`: k-ruoka.fi in a `WebContentsView` in its own `BaseWindow`, with `session.fromPartition("persist:k-ruoka")` (signed out at start), no preload, sandbox on, and Electron 44.7.0's default user agent. The owner signed in by hand. Nothing was written to a cart or list, and no checkout page was opened. One sign-in, one account, one day. Before this, the owner had also loaded k-ruoka.fi, signed in and seen a transferred cart in Korikone's Kauppa tab on the test build.

- **Bot protection.** The site loaded signed out and signed in. Cloudflare set `cf_clearance` and `__cf_bm` on `.k-ruoka.fi`; no challenge appeared.
- **Login.** The sign-in page is `login.kesko.fi/u/login/identifier` ("Kirjaudu sisään K-Tunnuksella"). It offers K-Tunnus by e-mail with an e-mail code ("Sähköpostilla") or a password ("Salasanalla"), plus MobilePay, Google, Apple and Facebook. No bank ID. The owner used e-mail and code, which works embedded: `/authorize` → `/u/login/identifier` → code page → `/authorize/resume` → `www.k-ruoka.fi/auth/callback` → front page. Main-frame hosts were only `www.k-ruoka.fi` and `login.kesko.fi`. MobilePay, Google, Apple and Facebook were not tried; in the Kauppa view their hosts would ask before opening.
- **Where the session lives.** In cookies, not web storage: `session` on `www.k-ruoka.fi` (HttpOnly, Secure, SameSite=Lax, persistent; it also exists signed out, so its presence does not prove a login) and `auth0`, `auth0_compat`, `did`, `did_compat` on `login.kesko.fi` (HttpOnly, Secure). Nothing login-related is in localStorage or sessionStorage. The sign-in survived closing and reopening the window.
- **Requests from the page.** `POST /kr-api/v2/product-search/{query}?language=fi&storeId=…&offset=0&limit=3` with `credentials: "include"` and an `X-K-Build-Number` header returned HTTP 200 signed out and signed in; without the header it returned 409. `POST /kr-api/stores/search` with a JSON body returned 200 (`GET` returned 400).
- **Endpoints k-ruoka-mcp 0.1.3 uses** (read from the binary's strings, not observed live): cart read `POST /kr-api/basket/active` (the site makes the same call on every page load); cart write `PATCH /kr-api/basket/by-id/{basketId}` with operations `ADD-ITEM`, `SET-ITEM-AMOUNT`, `REMOVE-ITEM`, `CLEAR-ITEMS`; product search `/kr-api/v2/product-search/{query}`; store search `/kr-api/stores/search`. It sends `X-K-Build-Number` and fetches with `credentials: 'include'` from `https://www.k-ruoka.fi/kauppa`.
- **New windows.** A deny-all `setWindowOpenHandler` was never called, on the front page or during sign-in.

Conclusion: K-Ruoka can run inside Korikone in its own persistent session, and its API answers same-origin `fetch` from the page with the session cookie. The first cart `PATCH` from the view needs an owner check. The choice for U3.7 is in [dependency-decisions.md](dependency-decisions.md#k-ruoka).


## S-kaupat "Lisää kaikki ostoskoriin" (U4.1, 9 October 2026)

Watched by the owner on his PC in a signed-in S-kaupat window, with checkout, delivery-time and payment pages blocked. Nothing was automated and no time was chosen.

- **What the button does.** Pressing *Lisää kaikki ostoskoriin* on a shopping list first opens a popup that asks for a store, found by the owner's address. After the store it shows pickup options and a calendar. According to the owner, choosing the pickup type would then reserve a delivery slot. He stopped there on purpose and closed the dialog.
- **Conclusion: not automated.** The site ties adding a whole list to choosing a pickup store, a pickup type and a time, and the last of these reserves a slot. Korikone never picks times or reserves slots, and it does not use the shopper's address, so it cannot press this button for the shopper. Read-only look at the requests behind the dialog (all GET persisted queries to `api.s-kaupat.fi`: `GetAddressAutosuggestions`, `DeliveryMethodSelection`, `remotePickupAvailabilities`, `remotePickupSlots`): no mutation was sent, and the only POST was the token renewal. With no pickup or delivery choice on the account the button added nothing. The request that adds the items and how the cart is read back sit behind choosing a pickup time and were not learned. Whether the button adds directly once a store and time are already chosen was not tested.
- **What Korikone does instead (U4.2, "not" branch).** After a verified transfer it opens the tab on the Korikone list under *Ostoslistat*, where the shopper presses the button and chooses store and time themselves.

### Finding the list page and the button (U4.2)

Read-only, on the owner's PC, 9 October 2026; nothing was clicked.

- `https://www.s-kaupat.fi/ostoslistat` lists the shopping lists. Each is an `li[data-test-id=shoppinglist-item]` with a link to `/ostoslistat/<list id>`, its name in `h2[data-test-id=title]` and its own `button[data-test-id=add-products-to-cart]`.
- One list is at `https://www.s-kaupat.fi/ostoslistat/<list id>`, no query string. The id is the list's `id` in the site's `RemoteGetUserLists` response and matches the `id` that s-kaupat-mcp's `get_shopping_lists` returns, so no lookup by name on the page is needed.
- On that page the site's button is `button[data-test-id=addAllToCart]` (exactly one, enabled). Its text starts with "Lisää kaikki ostoskoriin" and goes on with the approximate total, so match the prefix. It has no `role`, `aria-label` or `id`, and its class names are generated. The `data-test-id` values are the site's own test hooks and can change with a deploy; keep the text prefix as a fallback.
- Side finding for the host transport: on a load with an expired access token the first queries return a GraphQL error, then the page POSTs `GetRemoteAuthenticationTokens` with the refresh token and no `authorization` header and gets new tokens. So the site does renew on a page load, which is what the 1.3.0 reload-and-wait relies on.
- No list named "Korikone" existed under the PC session's sign-in when it looked (two lists, neither with that name), but the owner confirmed the same day that the list exists on his account, so the PC session's window most likely showed lists for another store or sign-in.

## Final v0.5.0 handoff checks, 10 October 2026

Authorized live checks used the packaged app, an isolated copy of existing embedded sessions and one manual coffee pack per chain. No ChatGPT request, checkout, payment or slot selection was made. Account, quantities, restart and open-only reopening are recorded in [acceptance.md](acceptance.md).

K-Ruoka's `/kauppa/ostoskori` path redirected to a store chooser and retained the site's previously selected store. The public frontend at build 33094 reads `kauppa=<store slug>` and opens its basket when `ostoskori` is present. `KRuokaSite.cartUrl` reads `GET /kr-api/store/<reviewed store id>`, validates the returned ID and slug, then opens `/kauppa?kauppa=<slug>&ostoskori=`. The site performs its own store selection. Live reopening showed K-Supermarket Hertta and the verified coffee quantity one. Only store metadata is read for the URL; no delivery or payment endpoint is called.

S-kaupat's advertising iframe redirected to a DoubleClick host and triggered the former redirect handler. `will-redirect` now checks `isMainFrame` before deciding whether to interrupt and ask about leaving the retailer. The embedded page, signed-in account, quantity two and manual add-all button remained intact after restart and reopening. Unknown top-level navigation still requires confirmation.

## F15.1 released matching baseline, 10 October 2026

Source baseline: published v0.6.0/main `5494654`; audit branch `codex/v0.7.0-strong`. [Matching baseline](matching-baseline.md) records the exact cases, mechanisms and module assignments. `tests/fixtures/matching-baseline.ts` contains 16 independently authored synthetic shopping cases for milk, bread, eggs, mince, onions, rice, cream and coffee; `tests/matching-baseline.test.ts` exercises both real adapters and `Service.save/buildBasket` with mocked tool responses. Additional cases cover malformed normalization, search errors and lost draft provenance. No retailer/ChatGPT calls, private receipts or account material were used.

Per chain: four fixture-safe priced selections, one forbidden plant-drink selection and eleven unresolved cases. Five unresolved cases per chain are compound-name misses; six others distinguish empty search, stock, pack, unknown price, incompatible units and weighed-price exclusion. Current whole-pack cost ranking succeeds. Current `draftPrompt` demands a meat type; `validateDraft` drops category/provenance, so model specificity cannot be distinguished from an explicit note. These are measured fixture outcomes, not an approved non-milk default policy or the expanded F16 acceptance report.

K-Ruoka normalization consumes `ean/name/price/priceUnit/priceIsApproximate/isAvailable`; S-kaupat 1.3.0 consumes `id/name/price/depositPrice/approximatePrice/priceBasis/packSize/quantityUnit`, plus `check_basket` stock status. Missing S-kaupat stock remains null; weighed/unsupported price bases remain unpriced. Neither adapter currently supplies normalized qualifier/dietary evidence. Names never certify allergens.

F15.7 is assigned `src/domain/categories.ts` and backward-compatible model/draft fields; F15.8 `src/stores/candidates.ts` plus both adapters; F15.2 `src/domain/matching.ts` plus planner/service call sites. F16.1 owns the single expanded evaluation schema/runner, reusing this audit instead of creating another baseline. Details and protected name tests are in [matching-baseline.md](matching-baseline.md). Focused checks: `npm test -- tests/matching-baseline.test.ts` (37 passed), typecheck and changed-file formatting.
