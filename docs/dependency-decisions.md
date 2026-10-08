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

## S-kaupat

Use the Apache-2.0 `Vkuparin/s-kaupat-mcp` single-file release `s-kaupat-mcp.cjs` from `v1.1.0`, source revision `4667ff1b9c081a2b85d4fd53f655c84fb34f39ad`.

- `s-kaupat-mcp.cjs` SHA-256: `49093b6cfc48723c07a8270ee7c8d2e920f6ed86e6730121c1686537e7966ade`; `tools.json` SHA-256: `e5e221f56b30a3b90515797c514792b7852fff73af1e16ac4f62d457a6fd46da`; both match the release's `SHA256SUMS`.
- `scripts/prepare-s-kaupat.mjs` downloads and verifies these files and the license into `vendor/s-kaupat/`. Runtime checks the file checksum, server version `1.1.0`, the required tool names and `schemaVersion` `1.0` on each result.
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
