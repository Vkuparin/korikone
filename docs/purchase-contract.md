# Purchase evidence contract (F6, v0.9.0)

Implemented schemas and APIs for receipt and order evidence. The plan and privacy rules are in [receipt-learning.md](receipt-learning.md); this file names what exists. Sections are added as cards land, and each heading names its card. Receipt parsing, accounting and the import UI are not implemented yet.

## Schemas and storage (F6.5)

`src/domain/purchases.ts`, `PURCHASE_VERSION` 1. Everything is strict Zod; unknown fields are rejected.

| Schema | Holds | Notes |
| --- | --- | --- |
| `purchaseSourceSchema` | One imported file, order record or the legacy text: `id`, `kind` (`receipt`, `order`, `legacy-text`), `chain` (`s-group`, `k-group`, `unknown`), `format`, `parser` `{ id, version }` or null, `importedAt`, `fingerprint`, `retention` (`sanitized` or `original`), `revision`, `pages`, `lines`, `unreadableLines` | A source is evidence. `revision` grows on reprocessing or correction |
| `purchaseEventSchema` | One actual purchase: `id`, `sourceIds` (1–4), `origin` (`receipt` or `order`), `status` (`completed`, `pending`, `cancelled`, `unknown`), `chain`, `store`, `purchasedAt`, `datePrecision` (`minute`, `day`, `unknown`), `lines`, `adjustments`, `printed`, `reconciliation` | Only `completed` is spending. A verified transfer is never an event |
| `evidenceLineSchema` | `id`, `role` (`product`, `deposit`, `non-food`, `other`, `unreadable`), sanitized `label`, `span`, `quantity`, `unitPrice` with `unitPriceBasis` (`pcs`, `kg`, `l`), `gross`, `net`, `provenance` (`source` or `user`) | Money is integer cents. Anything the source does not state is null |
| `purchaseQuantitySchema` | `{ amount, unit, provenance }` in whole `pcs`, `g` or `ml`, with provenance `source`, `user` or `unknown` | Wholly known or wholly unknown |
| `purchaseAdjustmentSchema` | Discounts, campaigns, loyalty, deposit returns, rounding: `kind`, `label`, `span`, `amount`, `allocation`, `lineIds`, `provenance` | `allocation` is `line` (at least one line), `group` (two or more lines, no per-line split), `receipt` or `unknown` (both without lines) |
| `printedAmountSchema` | An amount the source prints: `role` (`total`, `subtotal`, `food`, `non-food`, `discounts`, `deposits`, `tax`), `amount`, `span` | A source fact even when nothing reproduces it |
| `reconciliationSchema` | `status` (`balanced`, `unbalanced`, `incomplete`), `computedTotal`, `printedTotal`, `difference`, `reasons` | Set only by local accounting (F6.9). Reasons: `no-printed-total`, `unreadable-lines`, `missing-line-amount`, `missing-adjustment-amount`, `unallocated-adjustment`, `difference` |
| `semanticAnnotationSchema` | An interpretation of one line: `eventId`, `lineId`, `origin` (`rule`, `model`, `user`), `sourceRevision`, `name`, `category`, `qualifiers`, `scope` (`food`, `non-food`, `unknown`), `model` identity for `model`, `at` | Stored apart from facts; one per line and origin |
| `receiptConsentSchema` | `{ automatic: { providerId, scope, grantedAt } or null, asked }`, with `RECEIPT_DATA_SCOPE` 1 | Consent to send labels to one AI provider for one data scope |
| `purchaseLedgerSchema` | The document: `{ version, sources, events, annotations, consent }` | A source backs at most one event; the legacy source backs none |

`sourceSpanSchema` is `{ page, line, endLine }`: positions only. `sanitizeLabel(text)` keeps product words and replaces e-mail addresses, masked card numbers and any run of six or more digits with `…`, capped at 200 characters.

**Storage.** The ledger is one SQLite document, `purchases` (`development:purchases` in development mode), outside `AppState`, quotes and diagnostics. `PurchaseStore` in `src/application/purchases.ts` (as `service.purchases`) reads it (`ledger()`), writes it atomically with any originals (`write`), serializes changes (`serialize`) and deletes by scope (`delete`). A missing or damaged document reads as an empty ledger.

**Retention.** Sanitized evidence is the default. An optional original copy of a source is a separate document, `purchase-original:<sourceId>`, at most 50,000 characters, kept only when the shopper chooses it and marked by `retention: "original"`. Limits: 2,000 events, 500 lines and 200 adjustments per event.

**Deletion** (`deletePurchase`, `purchaseDeletionSchema` `{ eventId, scope }`): `original` removes only the retained copy; `annotations` removes the interpretations of that event's lines; `event` removes the event, its sources, its interpretations and its retained copy. Deleting an event forgets its fingerprint, so the same file can be imported again. The owner's own file outside the app is never touched.

**Legacy text.** `AppState.receiptText` stays as saved. `legacySource(text, fingerprint)` (and `service.purchases.legacy(text)`) presents it as one undated source, `id` `legacy-text`, with every line unreadable and no parser. The schema refuses any event built on it, so it yields no purchase, statistic or AI context until the shopper imports it explicitly (F6.2). Clearing it remains the existing save of an empty text.

**Backups.** `Service.exportBackup({ includeOriginals? })` adds `purchases` (`backupLedger`: sanitized records, consent removed) to the existing file, and `purchaseOriginals` only when asked. `importBackup` replaces the ledger when the file has `purchases`, validates before replacing anything, restores consent as not asked (`restoreLedger`), marks a source `original` only when its copy came with the file, and removes the replaced ledger's retained copies. A backup from before 0.9.0 leaves purchase records untouched and still carries `receiptText` as before; existing backup files are never rewritten.

**Shared dedupe rule** for every importer: `mergePurchase(ledger, source, event)` returns `{ ledger, outcome, eventId }` with outcome `added`, `updated` or `duplicate`. A source with a known fingerprint of the same kind is the same source: identical facts change nothing, different facts update that source and event in place with the next revision, keeping its ID, import time, retention and position. `putPurchase` is the lower-level replace-or-append and drops interpretations of removed lines or older revisions. F6.10 adds receipt fingerprints and atomic receipt import on top of these.

Fixtures: `tests/purchases.test.ts` (6) covers an old profile and legacy text, two events, unknown quantities/amounts/allocations and invalid shapes, the three deletion scopes, backup and restore with and without originals, an old backup, an invalid backup, diagnostics and label sanitizing. Builders for later cards are in `tests/helpers/purchase-fixtures.ts` (`memoryStorage`, `purchaseSource`, `purchaseEvent`, `purchaseLine`).

## Order import (F6.1)

**Audit.** The pinned shared library `s-kaupat-mcp` 1.3.0 registers two read-only order tools in every mode, both marked `readOnlyHint`: `get_orders` (the account's orders as on the site, up to 50, with `orderId`, `orderNumber`, `storeName`, `deliveryMethod`, `deliveryDate`, `deliveryTime`, `total` in euros, `state`, `payment`) and `get_order_items` (rows of one order: `productId`, `name`, `quantity` in pieces or kilograms, `unit` `KPL`/`KG`, the unit `price` it had, `allowSubstitutes`, `note`; fees and packaging left out). Both need the library's sign-in. `S_KAUPAT_TOOLS` in `src/stores/s-kaupat.ts` now lists these two and still lists no tool that reviews, places, pays or cancels an order; `SKAUPAT_ORDERING` stays `false`. `get_order` is not used because it can return a pickup-locker code.

**Adapter.** `StoreProvider.orderHistory?(limit)` returns `RetailerOrder[]` (`retailerOrderSchema` in `src/domain/order-evidence.ts`): `orderId`, `state`, `storeName`, `date`, `total` in cents, and `items` (`name`, `quantity`, `unit` `pcs`/`kg`, `unitPrice` in cents) or null. `SKaupatProvider.orderHistory` maps `done` to `completed`, `cancelled` to `cancelled`, `received`/`being_picked` to `pending` and anything else to `unknown`, reads rows only for finished orders, and keeps an order whose rows fail to read with `items: null`. Product IDs, notes, payment links, delivery times and contact data never leave the adapter. `capabilities.orderHistory` is true for S-kaupat and its development stand-ins and false for K-Ruoka.

**Evidence.** `orderPurchase(order, chain, identity, importedAt)` gives a source (`kind: "order"`, parser `retailer-order` v1) and an event. Pieces stay whole pieces and kilograms become grams; a fractional piece count or a missing unit is an unknown quantity. The unit price is kept with its basis. Line totals are not reported by the retailer, so `gross` and `net` are null and reconciliation is always `incomplete` (`missing-line-amount`, plus `no-printed-total` without a total). The printed total includes fees. The date is the delivery day with `day` precision, or unknown. The order ID is used only inside the fingerprint digest and is not stored.

**Import.** IPC `importOrders()` (`Service.importOrders`) needs a signed-in S-kaupat chain (`ordersUnavailable` otherwise), reads up to 50 orders and merges them through `mergePurchase` in one write. `snapshot.purchaseImport` is `{ source: "orders", added, updated, duplicate }`. A repeat import adds nothing; an order that changed state updates its own event. It makes no AI request, catalogue search or retailer write and does not touch the shopping list, quote or revision.

**K-Ruoka.** No completed-order read is established: the integrated K-Ruoka site client has cart and catalogue calls only, and no order-history endpoint has been audited or fixture-tested. `KRuokaProvider.capabilities.orderHistory` stays false and no API is assumed. K-Ruoka purchases enter through receipts.

Development mode: `DemoProvider` for `s-kaupat` and `demo-s` returns `demoOrders` (one finished with three rows, one pending, one cancelled, one finished with unknown facts). Fixtures: `tests/order-evidence.test.ts` (5: mapping and unknowns, adapter calls and privacy, the real pinned library accepting the read and refusing order tools, repeated and updated import, unavailable chains) and `tests/ui/order-import-api.spec.ts` (real IPC, fixture sign-in, backup, restart).

## Enrichment task, validation and consent (F6.11–F6.13)

Receipt enrichment asks an AI provider what kind of grocery an ambiguous label means. It is optional, separate from shopping, and never needed for local facts.

**Task (F6.11).** `receiptEnrichmentTask` (`receipt-enrichment` v1) is in `inferenceTasks`, so the ChatGPT adapter and the development alternative both advertise it over their text path. `src/ai/receipt-enrichment.ts` exports `enrichReceipt(session, batch)`, `receiptPrompt`, `receiptNativeOutput` (`receipt_enrichment_v1`), `receiptTaskLimits` and the development reply `receiptFixtureReply`. One request per action: `repairLimit` 0, no chunking, no retry, a batch object is never sent twice, 8,000 output characters, 60 seconds. This cap is separate from the shopping and edit caps.

**Batch and redaction.** `buildEnrichmentBatch(ledger, eventId)` in `src/domain/receipt-semantics.ts` returns `{ eventId, sourceRevision, request, rows, omitted }`. Only `product` lines without a rule or user interpretation of the current revision are sent, each as `{ rowId, label, quantity }`: the sanitized label cut to 80 characters and a quantity only when verified. At most 40 rows and 12,000 characters; the rest are counted in `omitted` and stay unresolved. The request also carries the category and qualifier vocabulary. It never contains the store, date, totals, prices, adjustments, deposits, non-food or unreadable lines, line IDs, source text or any identifier. `request` is null when nothing is ambiguous.

**Local rules.** `ruleAnnotations(event, sourceRevision, at)` gives `rule` annotations for product labels that the F15 name rules recognize. A label they do not recognize gets none.

**Consent (F6.11).** `enrichmentAllowed(saved, providerId, explicit?)`: an explicit answer (`enrichmentConsentSchema` `{ providerId, scope }`) covers one action and must name the session's provider and the current data scope; without one, only saved `consent.automatic` for exactly that provider and scope counts. A connected account alone is never consent, and a restored backup has none.

**Wiring (F6.12).** `runReceiptEnrichment({ ledger, eventId, providerId, consent?, session, now? })` in `src/application/receipt-enrichment.ts` checks consent and ambiguity before asking for a session, so without them no model or model catalogue is contacted. It refuses a session of another provider than consented or one whose model lacks the task, makes the single call with the selected model, and returns:

- `{ status: "enriched", eventId, sourceRevision, annotations, rejected, unresolved, omitted }`
- `{ status: "skipped", reason: "consent" | "nothing-ambiguous" }`
- `{ status: "unavailable" | "failed" | "cancelled" | "stale", reason }` with a countable code such as `notConnected`, `unsupportedTask`, `usageLimit`, `transport`, `incomplete`, `invalidOutput`, `cancelled`, `enrichmentStale`

It writes nothing; every outcome leaves the ledger as it was. Committing proposals is F6.14's step.

**Validation (F6.13).** `validateEnrichment(batch, result, ledger, model, at)` re-reads the ledger: a reprocessed source, a changed sent label or a deleted event is `enrichmentStale`. A result that is not exactly the result shape, including any quantity, amount, label or line ID field, is `enrichmentInvalid` as a whole. Otherwise each row stands alone and is dropped when its row ID was not sent or repeats, its category is outside the taxonomy, a qualifier is one the category does not carry or the printed label does not show, the name is not a short plain label (2–60 characters, no link, markup or long digit run), it says nothing, or it calls a row non-food while giving it a category. Accepted rows become `model` annotations with provider, model and task version. `applyEnrichment(ledger, annotations)` replaces only an earlier model proposal for the same line; rule and user interpretations are never overwritten, and no annotation becomes a saved preference.

Fixtures: `tests/receipt-enrichment.test.ts` (13) runs the task against both adapters: redaction and row cap, consent states, valid and malicious rows, stale results, one consented request, no contact without consent or ambiguity, limit/failure/malformed/cancel/disconnected with one request each and facts unchanged, a late result after a correction, and a provider without the task or other than the consented one.
