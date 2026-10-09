# Prototype dependency decisions

## K-Ruoka

Use the Apache-2.0 `nikosavola/k-ruoka-mcp` Windows binary from release `v0.1.3`, source revision `558a22e526057f35c7804081a77c19659cc3e671`.

- Release wheel SHA-256: `2bda8fd257286da6554b65375d0fa878211ffc8b48f13e5c6d2d1365276c09db`.
- Extracted executable SHA-256: `6b662fbe702dfea353689c7f7042c53a417f426e58e255d33aedb44f52392f2d`.
- License copied from the release wheel into `vendor/k-ruoka/LICENSE`.
- `scripts/prepare-worker.mjs` checks the release archive before extraction. Runtime checks the executable checksum, reported version and required tool names before operations.
- The real stdio handshake and tool listing passed on Windows on 8 October 2026.
- Upstream manages a separate Chrome profile. Korikone sets its path under local application data and detects installed Chrome. No Python, Rust or MCP setup is needed by the user.
- The adapter allows only catalogue, login, cart read and absolute quantity tools. No bulk clear or checkout command is exposed.
- Products expose normal prices and availability but lack structured pack sizes, deposits and dietary attributes. Pack labels are parsed conservatively. Weighted prices and ambiguous pack labels remain unresolved. Product acceptance must include checking the pack label and dietary suitability. Prices are estimates, with fees and any unreported deposits unresolved until store checkout.
- Same-profile checkout handoff closes the worker and launches Chrome against that profile. Live account continuity remains an acceptance check; it is not established by the protocol test.

Decision for U3.7 (U3.2 spike, 9 October 2026): replace the worker with a Korikone K-Ruoka client in `src/stores/` that calls the site's API from the `persist:k-ruoka` store tab, rather than asking upstream for a host-page mode.

- The API is four same-origin calls (product search, store search, cart read, cart write) authenticated only by the HttpOnly `session` cookie that the store tab already holds, so a page-context `fetch` is enough ([integrations.md](integrations.md#k-ruoka-inside-an-electron-view-u32-9-october-2026)).
- k-ruoka-mcp is a third-party Rust binary that launches and drives its own Chrome over the DevTools protocol. A host-page mode would need an upstream change and either an open debugging port in Korikone or a new bridge protocol.
- The client returns the same tool-shaped results, so `KRuokaProvider` and its review binding stay unchanged.
- It must keep the worker's safeguards: the build-number header with a retry on 409, at least 500 ms between calls, a null account treated as signed out, item IDs validated before a write, and rollback of an unknown EAN.
- The owner checked one cart write from the view on 9 October 2026, and the client became the default. The worker stays pinned behind `KORIKONE_K_RUOKA=worker` until U3.5 removes its login window. The client (`src/stores/k-ruoka-site.ts`) passes `tests/k-ruoka-site.test.ts` against anonymised responses captured from the site (`tests/fixtures/k-ruoka/`). The cart write format (a JSON array of events to `PATCH /kr-api/basket/by-id/{basketId}`: `ADD-ITEM` with `item: {ean, allowSubstitutes, amountInfo}`, `SET-ITEM-AMOUNT` with `itemId` and `value: {amount, unit}`) was read from the site's own code, not yet sent. The client builds only those two events and adds only EANs returned by a search in the same session.

## S-kaupat

Use the Apache-2.0 `Vkuparin/s-kaupat-mcp` single-file release `s-kaupat-mcp.cjs` from `v1.3.0`, source revision `c2b0ada4383a86bca3b7725407783135a078b08c` (previously `v1.2.0`, `0cf3228449a0e47b359d77978b6dcd151bfdd737`; `v1.1.0`, `4667ff1b9c081a2b85d4fd53f655c84fb34f39ad`). 1.3.0 adds the host transport for the in-app store tab; Korikone does not enable it until U3.5.

- `s-kaupat-mcp.cjs` SHA-256: `17f973844c2216be3f51b7b272351025e5dd1dec0d209b1fce15fb8fd0fc032a`; `tools.json` SHA-256: `a45d418363b3439cee9ddc1919ab2437d377db3e0395883c7f931c72b92461c4`; both match the release's `SHA256SUMS`.
- `scripts/prepare-s-kaupat.mjs` downloads and verifies these files and the license into `vendor/s-kaupat/`. Runtime checks the file checksum, server version `1.3.0`, the required tool names and `schemaVersion` `1.0` on each result.
- The `.cjs` (about 5 MB) was chosen over the 110 MB standalone exe because Electron already contains Node.js; Korikone runs it with `ELECTRON_RUN_AS_NODE`.
- The server uses its own Edge or Chrome profile under Korikone's data folder and keeps the refresh token in Windows Credential Manager, shared with other apps using s-kaupat-mcp on the same PC.
- `SKAUPAT_ORDERING=false`, and the adapter allows only catalogue, login, shopping-list and site-handoff tools. No order, payment, list deletion or delivery-slot command is exposed.
- S-kaupat has no server-side cart; transfers go to the account shopping list "Korikone". Search results do not report stock, so the adapter uses `check_basket`. Reviews are bound to the server's `accountId` (added in 1.1.0), a stable one-way hash of the S-kaupat user ID.
- Live login, list transfer and handoff in Korikone remain acceptance checks. Details are in [S-kaupat integration](s-kaupat-mcp-plan.md).

## ChatGPT

The official DevKit examined at `0a36fefeb913055c8c7a1a29b63d82b96b2e841a` uses the Sign-in with ChatGPT DevKit Noncommercial License 1.0. Korikone does not copy or bundle it. Its independently authored implementation uses the documented local-app protocol: loopback authorization, PKCE, state and nonce checks, verified identity tokens, encrypted local credentials, serialized refresh, model discovery and completed-response streaming. Offline tests cover callback rejection, cancellation, incomplete output and draft validation. On 8 October 2026, the owner reported successful authorization and completion of the requested meal-draft test. Restart, automatic model selection and sign-out remain live acceptance checks.

## Release status

The Windows NSIS installer build succeeded. It is an unsigned development prototype. On 8 October 2026, the owner selected a real K-Ruoka store, signed in and reported that the app's login check succeeded. Live cart mutation, checkout continuity, clean-machine installation and household usability sessions remain unverified. The owner also reported one unexpected app exit after store selection; its cause is under investigation.

Live read-only catalogue smoke passed on 8 October 2026: the adapter found Ruoholahti and normalized 20 pasta search results from that branch. No account login or cart mutation was performed.

## PDF receipts

The 9 October 2026 feedback iteration adds `pdfjs-dist` 6.4.299 (Mozilla PDF.js, Apache-2.0), pinned in package.json and the lockfile. A dedicated Node worker extracts text from local PDFs with bounded file size, page count, output length and timeout. The app does not execute PDF document actions or fetch the receipt from a URL. The PDF.js package stays external to the main bundle so its worker and standard font assets remain available in the packaged dependency. Third-party notices include the library and its dependencies. API reference: https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html.

## Revised product and checkout behavior

Automatic product choice uses known-price, compatible-unit, available candidates. Explicit selections win; otherwise sufficient-pack cost and the user's soft brand preference decide. Unknown pack data still stays unresolved and dietary checks remain part of live transfer review.

K-Ruoka checkout now opens its URL in the default browser. S-kaupat retains the released worker's authenticated `open_site` flow and requires adding the account list to the cart on the site. It does not use the earlier same-profile Chrome handoff and does not copy cookies. The user may need to sign into the same retailer account in that browser. This supersedes the checkout-handoff description above; continuity requires a live acceptance check.
