# S-kaupat integration: s-kaupat-mcp

Updated 8 October 2026. The separate [s-kaupat-mcp](https://github.com/Vkuparin/s-kaupat-mcp) project was released as **v1.0.0**, and Korikone pins **v1.3.0**: 1.1.0 added a stable account ID, 1.2.0 a login per data folder and 1.3.0 a host transport that runs calls in the app's own store tab (not yet enabled; U3.5). The prerequisite plan that preceded the release is kept in git history and summarized at the end of this page.

## What was released

| Item | Value |
|---|---|
| Release | `v1.3.0`, source commit `c2b0ada4383a86bca3b7725407783135a078b08c` |
| License | Apache-2.0; bundling and redistribution are permitted |
| Artifact Korikone ships | `s-kaupat-mcp.cjs`, SHA-256 `17f973844c2216be3f51b7b272351025e5dd1dec0d209b1fce15fb8fd0fc032a` |
| Schema description | `tools.json`, SHA-256 `a45d418363b3439cee9ddc1919ab2437d377db3e0395883c7f931c72b92461c4` |
| Protocol | stdio MCP; every result carries `schemaVersion: "1.0"`, fixed for all of 1.x |
| Compatibility promise | Semantic versioning: tool names, inputs, result fields, error codes and settings are stable within 1.x |
| Errors | `isError` results with a stable `code`, an `action`, `retryable` and Finnish/English `userMessage` |
| Demo mode | `--demo` serves a built-in catalogue, pretend login and in-memory lists with no network |

`scripts/prepare-s-kaupat.mjs` downloads the pinned files and refuses any checksum mismatch. At runtime Korikone checks the file checksum, the reported server version, the required tool names and the `schemaVersion` of every result before trusting it. An incompatible file stops store operations with the `workerIncompatible` message.

## What the S0 feasibility work decided

| Planned question | Outcome in the release |
|---|---|
| Managed browser session or extension | **Managed session.** The server keeps its own Edge or Chrome profile under its data folder and sends API calls from a minimised window of that browser, because S-kaupat refuses plain scripted requests since 7 October 2026. No extension, native helper or developer mode is needed. |
| Login | A small S-kaupat window opened by `start_login`; the server stores only the refresh token, in Windows Credential Manager. No passwords pass through MCP. |
| Authenticated cart | **S-kaupat has no server-side cart.** The website keeps its cart in the browser. The release writes to shopping lists on the account instead, and the site's *Lisää kaikki ostoskoriin* button fills the cart from a list. |
| Exact quantities and readback | List writes set an absolute quantity per product (never a second row) and return one result per product: `added`, `updated`, `unchanged`, `missing` (with a reason) or `uncertain`. |
| Same-session checkout handoff | `open_site` opens S-kaupat in the server's own, already logged-in window. |
| Checkout | The release can also review and place orders and start card payments. **Korikone does not use this**; see below. |

The planned cart gate is therefore met through account shopping lists rather than a cart. The final step from list to cart is the shopper's own press of *Lisää kaikki ostoskoriin* on the site, followed by manual checkout. This keeps the "approve before change, checkout by hand" model intact. It is not the catalogue-only preview mode the plan described as the failure case.

## How Korikone uses it

Code: [`src/stores/s-kaupat.ts`](../src/stores/s-kaupat.ts), generic worker in [`src/stores/worker.ts`](../src/stores/worker.ts).

- **Process.** Electron runs the single-file `.cjs` release with its own Node.js (`ELECTRON_RUN_AS_NODE`), so users install nothing beyond Korikone. The data folder is `<userData>/retailers/s-kaupat`. Logs on stderr are discarded because they may contain account details.
- **No ordering.** Korikone starts the server with `SKAUPAT_ORDERING=false` and allowlists only catalogue, login, list and site-handoff tools, plus the read-only `get_delivery_options` for pickup fees (F3). `review_order`, `place_order`, payment, order history, delivery-slot and list-deletion tools are never called. This follows the design rule that checkout and payment are always manual.
- **Store search.** The store picker searches K-Ruoka and S-kaupat together. Stores without online ordering are hidden. Choosing an S-kaupat store also calls `select_store`, so the server's site instructions name the same store; Korikone still passes the store ID explicitly on every call.
- **Products.** `search_products` supplies prices and pack labels. Only per-item, non-approximate prices with a recognisable pack size are priced; weighed goods and unclear packs stay unresolved, as with K-Ruoka. Search results never report stock, so Korikone asks `check_basket` for the same products and treats only `ok` as available. Deposits come from `depositPrice`.
- **Cart transfer.** Korikone's cart for S-kaupat is the single shopping list named **Korikone** on the account. A missing list is an empty cart; it is created by the first approved write. Two lists with that name stop the transfer. Writes use `add_to_shopping_list` with `allowSubstitutes: false` and absolute quantities. Any result other than `added`, `updated` or `unchanged` stops the transfer; `uncertain` becomes `writeUncertain`, and the usual journal and readback rules apply.
- **Account binding.** Since 1.1.0, `login_status` returns `accountId`, a stable one-way hash of the S-kaupat user ID that is the same on any device and across logins. Korikone binds each review and every write to it, so an account switch stops a transfer with `accountChanged`. A logged-in answer without `accountId` is treated as an incompatible server.
- **Handoff.** After a verified transfer, *Open store cart* calls `open_site` and tells the user to open the Korikone list, press *Lisää kaikki ostoskoriin*, choose the store and time, and finish there.
- **Errors.** Server codes map to Korikone message keys (`loginRequired`, `browserRequired`, `storeBusy`, `chooseStore`, `productUnavailable`, `writeUncertain` and others). Unknown codes fall back to `storeUnavailable`.

## Tests

`tests/s-kaupat.test.ts` covers the adapter with synthetic tool results and also runs the pinned release itself in demo mode over a real stdio connection: store search and selection, login, priced and stock-checked products, a reviewed transfer through `createReview` and `transfer`, and readback of the Korikone list. It also checks that a checkout tool is refused before reaching the server. These tests run offline in CI.

## Outstanding live acceptance

Observed on the owner's PC on 9 October 2026, live store search, product search with per-item prices and parsable packs, `check_basket` stock answers, and one reviewed transfer of three products to the Korikone list with before (no list) and after (three lines at quantity 1) read back from the account. Details are in [acceptance.md](acceptance.md).

Not yet observed in Korikone on the owner's PC:

- Store search, login and a priced basket from the packaged app (observed from a development build on 9 October 2026).
- `open_site` handoff: it opened a session that was not logged in ([#3](https://github.com/Vkuparin/korikone/issues/3)). Cause, from reading the v1.1.0 release: on Windows the server keeps its refresh token in Credential Manager under one name for the whole PC, but the site's own login lives in the browser profile inside each data folder (`login-browser`), and `start_login` returns at once when a token exists. A new or reset data folder, or a token saved by another s-kaupat-mcp client on the same PC, therefore gives working API calls and a signed-out site window. Korikone now treats S-kaupat as signed in only after `start_login` has shown its window in this data folder for the same account (`alreadyLoggedIn: false`), and remembers that account. Since s-kaupat-mcp 1.2.0 Korikone also runs the server with `SKAUPAT_LOGIN_SCOPE=data-dir`, which keeps the token in a Credential Manager entry of this data folder's own, so other apps' logins are never found or signed out here; *Open store cart* refuses with a sign-in prompt instead of opening a signed-out window. The window is still the server's own Edge or Chrome window, not one inside Korikone. Fixture tests cover this, and on 9 October 2026 the owner confirmed live that after one sign-in the handoff opens the window signed in. Still to observe: *Lisää kaikki ostoskoriin* on the site and manual checkout from that list.
- Combined onboarding with K-Ruoka, which uses Chrome while S-kaupat prefers Edge.

## Earlier prerequisite plan (summary)

Decision of 8 October 2026: build S-kaupat access as a separate repository and release it before Korikone's real store integration. The project owns S-kaupat discovery, login, sessions, catalogue, cart or list operations, schemas, fixtures and release artifacts; Korikone owns planning, preferences, budgets, approvals and its interface, with no dependency in the other direction. The plan proposed tools such as `get_cart`, `set_cart_item_quantity` and `open_cart`, stable error codes, no bulk clear, order placement or payment tools, and a sequence of S0 feasibility, S1 client and hermetic tests, S2 MCP and packaging, and S3 observed acceptance and release. The released tool names differ from that proposal and the release added optional ordering tools; Korikone's adapter translates the release's schemas rather than assuming the proposed names.
