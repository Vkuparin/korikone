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

- **S-kaupat (s-kaupat-mcp 1.2.0).** `get_delivery_options` with only a store ID lists that store's pickup places (store pickup and pickup locker), each with a base `price` in euros and the `nextSlot` with that time's own `price`. It is marked read-only and needed no login in the server's demo mode. Fees vary by time: in demo data store pickup is 3,90 € and an evening time 5,90 €. `get_delivery_slots` gives every time's fee for up to 14 days, but it is a slot tool, and the per-time detail is not needed for an estimate. Home delivery and express need a location from `find_address`, which means the shopper's home address. Korikone does not ask for or store it, so delivery fees stay unknown.
- **K-Ruoka (k-ruoka-mcp 0.1.3).** The worker has eight tools: `search_stores`, `set_default_store`, `search_products`, `get_cart`, `add_to_cart`, `update_cart_item`, `remove_from_cart` and `clear_cart`. Stores report only `hasPickup` and `hasHomeDelivery`. The cart has a `priceSummary` with `itemsSubTotal` and `grandTotal`, but no time is chosen through the worker, so no fee is known. K-Ruoka fees stay unknown.

Decision for F3.2: allow only `get_delivery_options` for S-kaupat. For pickup at the chosen store, show a range from the lowest to the highest price it reports, labelled as depending on the pickup time. Show "unknown" for home delivery and for K-Ruoka. The comparison keeps item totals and fees apart, so an unknown fee never looks like a free one. A live read of `get_delivery_options` for the owner's store is part of the F3 live check; it needs no login and changes nothing.
