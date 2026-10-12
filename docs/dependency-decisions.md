# Prototype dependency decisions

## v0.5.0 shared S-kaupat library

The default S-kaupat connection uses the Apache-2.0 npm library from upstream release v1.3.0, source revision `c2b0ada4383a86bca3b7725407783135a078b08c`. The release tarball SHA-256 is `0fa73e9952aa0c944d753da677a5a5c4aef34aa1bb0cfd4a33f605fe4cca6d77`. The dependency URL and npm integrity are pinned, and `prepare-s-kaupat.mjs` checks the tarball alongside the standalone worker.

`SKaupatLibrary` calls the released `loadConfig` and `createRuntime`, connects an MCP client through `InMemoryTransport`, and validates the server version, required tools and result schemas. The shared runtime supplies requests, host authentication, renewal and error handling. Korikone retains product normalization, planning and transfer review. Ordering is disabled, and the adapter exposes only its fixed allowed tools.

The private loopback host accepts five fixed operations with a random key. Store requests and session reads stay in the tab. Korikone stores no refresh token. Shutdown closes the MCP client and runtime. The build keeps `s-kaupat-mcp` as a production dependency so the packaged app includes the same released library. `KORIKONE_S_KAUPAT=browser` retains the pinned standalone fallback.

Fixture tests exercise the library's reviewed transfer and the same host-session contract against both library and worker. Adapter and service tests cover expiry, uncertain writes and recovery. Earlier live observations are recorded below; final acceptance of the integrated candidate is pending.

## K-Ruoka

Owner direction, 11 October 2026: add required K-Ruoka functionality to the existing local embedded client. Upstream MCP source is a reference for request behavior; Korikone keeps its current session transport and normalized retailer boundary. F11.4 audits offer requests and F11.5 implements supported local reads. Keep the fallback worker pinned; no maintained MCP fork or separate Rust/browser release flow is planned. Keep client code separable from shopping policy/UI, and consider extracting a shared package only when a second consumer needs it. Both local API maintenance and upstream protocol changes remain part of the retailer boundary's ownership.

The default in v0.5.0 is the embedded site client described below. The pinned binary and its separate browser profile remain available only through `KORIKONE_K_RUOKA=worker`. The worker evidence in this section is retained for that fallback.

Use the Apache-2.0 `nikosavola/k-ruoka-mcp` Windows binary from release `v0.1.3`. Its annotated tag object is `558a22e526057f35c7804081a77c19659cc3e671`, which resolves to source commit `a3d2b5d009d187d0e99393f4837169e5e36b3c35` (GitHub tag/ref metadata verified on 11 October 2026). This is the same pinned release reviewed by F5.2, not a different dependency.

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
- The owner checked one cart write from the view on 9 October 2026, and the client became the default. The worker stays pinned behind `KORIKONE_K_RUOKA=worker` as an explicit fallback. The client (`src/stores/k-ruoka-site.ts`) passes `tests/k-ruoka-site.test.ts` against anonymised responses captured from the site (`tests/fixtures/k-ruoka/`). The cart write format (a JSON array of events to `PATCH /kr-api/basket/by-id/{basketId}`: `ADD-ITEM` with `item: {ean, allowSubstitutes, amountInfo}`, `SET-ITEM-AMOUNT` with `itemId` and `value: {amount, unit}`) was read from the site's own code and exercised in the earlier owner check. The client builds only those two events and adds only EANs returned by a search in the same session.

## S-kaupat

Use the Apache-2.0 `Vkuparin/s-kaupat-mcp` single-file release `s-kaupat-mcp.cjs` from `v1.3.0`, source revision `c2b0ada4383a86bca3b7725407783135a078b08c` (previously `v1.2.0`, `0cf3228449a0e47b359d77978b6dcd151bfdd737`; `v1.1.0`, `4667ff1b9c081a2b85d4fd53f655c84fb34f39ad`). 1.3.0 adds the host transport for the in-app store tab; Korikone enables it since U3.5: `src/main/s-kaupat-host.ts` answers the five operations on 127.0.0.1 with a random key per launch, from the Kauppa tab's session (`KORIKONE_S_KAUPAT=browser` keeps the old window).

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

## v0.10.0 Finnish receipt OCR proposal (F13.1)

Benchmark completed in 510dc88 on 12 October 2026; the owner accepted local OCR with the proposed limits and review notice on 12 October 2026. F13.2 adds the approved pinned runtime dependencies and local Finnish assets. All benchmark inputs are independently authored synthetic receipts, not the owner's receipts. The investigation candidate and intermediate assets remain under ignored scratch/ocr-spike; three synthetic PDF fixtures are published for runtime tests. No ChatGPT, cloud OCR, retailer account or receipt upload was used.

Candidate: tesseract.js 7.0.0 and tesseract.js-core 7.0.0, with Finnish tessdata_fast at source revision 87416418657359cb625c412a48b6e1d6d41c29bd. The 7865732-byte fin.traineddata asset has SHA-256 61a04cd62b507c3d9ae0e1cda399e6715ebf49dea9df47897c8acdcd3bd3e13c. [Tesseract.js 7.0.0 license](https://github.com/naptha/tesseract.js/blob/v7.0.0/LICENSE.md), the installed core package’s LICENSE and [the exact language repository license](https://github.com/tesseract-ocr/tessdata_fast/blob/87416418657359cb625c412a48b6e1d6d41c29bd/LICENSE) state Apache-2.0. The measured transitives use MIT, Apache-2.0 or BSD-2-Clause; exact versions/licenses are in [the benchmark record](benchmarks/ocr-0.10.0.json). Adoption must add their notices and the language license. Windows Consolas was used to render synthetic scan pixels only; no font binary is proposed for redistribution.

### Accuracy and runtime

Two invented eight-line Finnish receipts (K and S layouts), each rendered as clean 300 dpi, low-resolution 150 dpi, 1.5-degree skew at 200 dpi and faded/blurred 200 dpi, produce eight image-only PDFs. PDF.js verifies no text layer and renders at 300 dpi; Tesseract uses Finnish LSTM-only with page segmentation mode 6. The OCR worker runs with HTTP and fetch disabled, local language path and no disk cache. The eight rendered pages were visually inspected.

| Scan             | Character errors / normalized characters | Exact critical rows / 5 | Price tokens / 5 | Parser reconciliation                |
| ---------------- | ---------------------------------------- | ----------------------- | ---------------- | ------------------------------------ |
| K clean          | 0 / 162                                  | 5                       | 5                | Balanced, 667 cents                  |
| K low resolution | 2 / 162                                  | 4                       | 5                | Balanced, 667 cents                  |
| K skew           | 1 / 162                                  | 4                       | 5                | Balanced, 667 cents                  |
| K faded          | 0 / 162                                  | 5                       | 5                | Balanced, 667 cents                  |
| S clean          | 1 / 164                                  | 5                       | 5                | Balanced, 837 cents                  |
| S low resolution | 1 / 164                                  | 5                       | 5                | Balanced, 837 cents                  |
| S skew           | 6 / 164                                  | 4                       | 4                | Incomplete; unreadable product price |
| S faded          | 0 / 164                                  | 5                       | 5                | Balanced, 837 cents                  |

Aggregate: 11 edits in 1304 characters, a 0.84% character error rate after NFC, case-folding and whitespace normalization; 37/40 exact critical rows (92.5%); 39/40 price tokens (97.5%). Reference totals and product counts were written independently, then verified by two passing tests/ocr-benchmark.test.ts cases through the real parseReceipt implementation. Seven scans preserve all three product prices and balance correctly. The skewed S scan reads the pasta price as non-price text; the real parser keeps that row unreadable with null money and incomplete reconciliation instead of inventing 179 cents. All eight retain the printed total. Balanced arithmetic does not establish that labels, dates or quantities are correct.

On this Windows x64 machine with Node v26.10.0, cold OCR initialization took 128 ms. PDF render took 15–99 ms and OCR took 111–167 ms per short page in the recorded network-disabled run; cold initialization plus render and OCR was 254–394 ms. These are small synthetic-page measurements, not long/photo receipt or packaged Electron performance claims. No weighed-quantity, multi-page, handwriting or severe thermal damage accuracy is established by this sample.

### Size

The candidate’s full dependency trees plus Finnish language data/license add 59549048 raw bytes (56.79 MiB); the existing PDF.js canvas renderer is already installed and is not counted again. An isolated solid LZMA payload archive measured 8837663 bytes (8.43 MiB); gzip level 9 measured 22596063 bytes (21.55 MiB). This suggests about 9 MB of compressed installer payload and about 60 MB installed, using all core variants. It supersedes the earlier unmeasured 20–40 MB estimate. It is not a before/after full NSIS installer measurement: framing, ASAR layout, compression context and lockfile resolution can change the final delta. Runtime integration should record the actual package delta at release preparation, without rerunning the release suite merely for the benchmark. No core variants were removed to obtain these numbers.

### Proposed adoption and F13.2 contract

Recommend adopting local Finnish OCR for image-only PDF pages, retaining the existing receipt parser’s unreadable/uncertain rows, reconciliation and correction flow. Show that OCR was used and ask the shopper to check recognized quantities and prices; an internally balanced sum is not proof of recognition accuracy. OCR itself uses zero ChatGPT requests. Existing optional receipt enrichment remains a separate consent and provider-neutral operation.

If accepted, F13.2 adds pinned production dependencies and checksum-verified bundled Finnish assets with explicit local paths, no runtime downloads/cache and no cloud fallback. Keep OCR in src/receipts/worker.ts and preserve src/receipts/read.ts limits: 20 MiB input, 100 PDF pages, 50000 output characters and 30 seconds for the entire worker. Apply a bounded raster size before allocating a canvas, process pages serially and terminate OCR resources on all exits. Keep text-bearing pages on the existing extraction path; mixed PDFs retain page separators and use OCR only on image-only pages. Errors cannot silently become empty success.

F13.2 must exercise the actual receipt worker and application parser/import/persistence paths with a synthetic scanned success, an unreadable/uncertain scan, mixed/text pages, oversized raster/output, missing or corrupt local assets, and a real too-slow worker timeout. Carry OCR-use metadata to the receipt import result/source and visible receipt review without changing monetary facts or sharing scans. Add focused tests/receipts.test.ts and development IPC coverage; retain the provider-neutral receipt-enrichment contract. The fixture authoring script is scripts/ocr-fixtures.py, raw source expectations are tests/fixtures/receipts/ocr-benchmark.json and the isolated candidate runner is scripts/ocr-spike.mjs.

Reproduction: install tesseract.js@7.0.0 with --ignore-scripts under scratch/ocr-spike, fetch the checksum-pinned Finnish asset/license from the source revision above into its lang directory, generate scans with scripts/ocr-fixtures.py using Pillow/reportlab, then run KORIKONE_DEVELOPMENT=1 node scripts/ocr-spike.mjs. The optional LZMA estimate uses the existing electron-builder 7za binary to archive only candidate node_modules and lang, never private receipt directories. OCR packages, scans and intermediate outputs stay ignored; only independently authored expectations, scripts and synthetic benchmark facts are published.
