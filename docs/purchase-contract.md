# Purchase evidence contract (F6, v0.9.0)

Implemented schemas and APIs for receipt and order evidence. The plan and privacy rules are in [receipt-learning.md](receipt-learning.md); this file names what exists. Sections are added as cards land, and each heading names its card. The receipt screens that use these APIs are the Simple cards F6.16, F6.21, F6.3, F18.2, F18.4, F8.1, F8.2 and U5.2.

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

## Receipt fixtures (F6.6)

`tests/fixtures/receipts/` holds 25 invented, sanitized receipts with the expected evidence beside each text. Nothing was copied, transcribed or derived from a real receipt, and no original file or personal data is in source control. The shops, addresses, products, dates and amounts are synthetic; layouts follow the S-group and K-group conventions in [receipt-learning.md](receipt-learning.md).

| Export | Use |
| --- | --- |
| `receiptFixtures: ReceiptFixture[]` (`index.ts`) | Every fixture: S-group (`s-group.ts`, 10), K-group (`k-group.ts`, 5), unsupported/partial/unbalanced/injected (`hostile.ts`, 7) and trips (`trips.ts`, 3) |
| `ReceiptFixture` | `id`, `covers`, `chain`, `format` (`txt` or `pdf`), `pages` (one string per printed line), `outcome` (`event` or `unsupported`), `source` (`chain`, `format`, `pages`, `lines`, `unreadableLines`), `event` (a `PurchaseEvent` validated with `purchaseEventSchema`, or null), optional `relation` and `hostile` |
| `fixtureText(fixture)` | The file text: lines joined, pages separated by a form feed |
| `receiptTextPDF(pages)` (`pdf.ts`) | A text-bearing PDF with one row per line, which the local reader returns line by line |
| `expectedSource(fixture, fingerprint?)` | The expected source with import-time fields completed; `fingerprint`, `importedAt` and `parser` belong to F6.10 and the parsers |

**Conventions of the expectations**

- A parser may choose its own event, line and adjustment IDs. Compare labels, spans, quantities, amounts, roles, allocation and reconciliation, not IDs.
- Spans are 1-based page and line positions in `pages`; a name row plus its count row is one span.
- A product row with no printed count is one piece with provenance `source`. A count or weight is printed after the price (S-group) or before it (K-group). Weights are whole grams, with the per-kilogram price and basis `kg`.
- `NORM.` rows are reference prices: the printed line price is what was paid, and the reference is neither added nor subtracted.
- `gross` is the printed line price. `net` is the amount after adjustments the source ties to that row alone (allocation `line`). Rows under a group offer have `net` null and one adjustment with allocation `group`; a loyalty or deposit-return row not tied to a product has allocation `receipt`.
- Roles `non-food` appear only where the receipt says so, by a section header. A household item without one stays `product`; no food/non-food breakdown is manufactured.
- A balanced expectation states its totals. For `incomplete` and `unbalanced` receipts the expectations are `status` and `reasons`; amounts that cannot be known are null and a missing price is never inferred from a printed total.
- An `unsupported` file yields no event, no spending and every line counted unreadable.
- Hostile text (`hostile`) is only a sanitized label: it changes no amount, and an address in it becomes `…`.
- `relation`: the PDF of `trip-original` is a duplicate of the text import (same pages, same event); `trip-distinct` has the same rows and total on another day and is its own purchase.

Fixtures: `tests/receipt-fixtures.test.ts` (10) checks schema validity, that every span contains its label, price and unit price, that counts and weights multiply to the printed amount, that each balanced receipt adds up from rows and adjustments written independently of any parser, that unknown facts stay null, the hostile, duplicate and distinct cases, that no six-digit run, link, card mask or address (other than the invented one on the injection row) is present, and that the local reader returns every row of every fixture from a generated PDF.

## Receipt parsers (F6.7, F6.8)

`src/receipts/parsers/` reads receipt text locally and deterministically. `parseReceipt(text)` in `index.ts` returns `{ outcome: "event", receipt, facts }` or `{ outcome: "unsupported", pages, lines }`. `facts` is a whole event without IDs, already reconciled; `receipt` (`ParsedReceipt`) adds chain, parser `{ id, version }`, pages, row count and `unreadableLines`.

- **Rows.** `receiptRows` splits pages on a form feed and rows on line breaks, drops empty rows and collapses spacing, so text and PDF input read the same. Indentation and columns are never relied on. Limits: 50,000 characters, 100 pages, 2,000 rows, 300 characters a row (`receiptLimits`); more is `receiptTooLarge`. The PDF worker now writes a form feed between pages.
- **Layout choice.** The shop name on the first row selects the parser: `sGroupStore` (S-market, Prisma, Sale, Alepa, Sokos Herkku, Food Market Herkku, ABC) or `kGroupStore` (K-Market, K-Supermarket, K-Citymarket, K-Ruoka, Citymarket). Any other file, or a shop name with no readable row, is `unsupported`: no event and nothing spent.
- **Dates.** The first `d.m.yyyy hh:mm` in the opening rows is converted from Finnish time to UTC by `helsinkiTime`, including the summer-time change on the last Sundays of March and October. A date without a time has `day` precision; no date is unknown.
- **S-group** (`s-group.ts`, parser `s-group` v1): name and line price on one row; a row after it with `N KPL x price` or `w,www KG x price EUR/KG` sets count or grams and the unit price; `NORM.` is a reference price that only extends the row's span; `KAMPANJA`, `TARJOUS` and `ALENNUS` reduce the row above (allocation `line`); `RYHMÄTARJOUS` is a group offer; `PANTTI` is a deposit row; a deposit return is receipt-level; `RUOKA` and `MUUT TUOTTEET` headers set product or non-food; `YHTEENSÄ`, `VÄLISUMMA`, `RUOKA YHT`, `MUUT YHT` and `PANTIT YHT` are printed amounts.
- **K-group** (`k-group.ts`, parser `k-group` v1): a one-piece product has name and price on one row; otherwise a name row is followed by `N KPL X price total` or `w,www KG X price /KG total`, also across a page break; `PANTTI` is a deposit row; `RYHMÄETU` is a group offer; `K-Plussa-etu` is receipt-level when it is the last row before the total and `unknown` between rows; `Yhteensä` closes the list.
- **Group offers.** An offer is allocated to rows only when it states a piece count and the product rows directly above it add up to exactly that count (`3 x 5 KPL`: three rows of five; `15 KPL`: rows summing to fifteen), with at least two rows. Otherwise its allocation is `unknown` and it has no lines. Rows under a group offer have `net` null.
- **Never read.** Everything after the total row: tax, payment, card, loyalty and reference rows. They reach no evidence, fingerprint or count.
- **Unknowns.** A name row with no price is a product with null amounts and unknown quantity. A row that is neither a name nor a known row is kept as an `unreadable` line with a sanitized label and counted. A second count row for one product is unreadable, not a correction.

Fixtures: `tests/receipt-parsers.test.ts` (32) parses all 25 F6.6 fixtures, each also with PDF-style collapsed spacing, and compares every fact; for receipts that do not balance it compares status and reasons, as the fixture convention says. It adds cases written for this card: four units with a reference price, row campaigns, non-food, rows after the total, unexplained and mismatched group offers, two cartons each of two milk variants, fifteen pouches across three variants, weights, a name and its weight on different pages, a truncated name, an unplaced Plussa benefit, unsupported and oversized files, date handling and the time conversion. One F6.6 expectation was corrected: `injection-in-label` is on 25 October 2026 at 11:11, after Finland returned to UTC+2, so its time is 09:11Z.

## Receipt accounting (F6.9)

`src/domain/receipt-accounting.ts`, integer cents throughout.

- `withNetPrices({ lines, adjustments })` sets `net` to the printed price plus the adjustments tied to that line alone. A line under a group adjustment, or under an adjustment shared with another line, or with a missing amount, has `net` null. A `net` the shopper corrected is kept.
- `receiptLedger(facts)` returns `{ goods, deposits, lineAdjustments, groupAdjustments, receiptAdjustments, paid }`. Every adjustment is in exactly one of the three and each part is null when any of its amounts is unknown.
- `reconcile(facts)` compares that sum with the printed total. Reasons `unreadable-lines`, `missing-line-amount` and `missing-adjustment-amount` leave no computed total; `no-printed-total` (also for two different printed totals) and `unallocated-adjustment` make the result `incomplete` while the sum is still shown; a known non-zero difference adds `difference` and, alone, means `unbalanced`. Nothing is filled in or corrected.
- `sectionDifferences(facts)` compares printed food, non-food and deposit subtotals with their rows, or null.

No AI output reaches any of these functions. Fixtures are in the parser test file: the ledger for group offers, deposits, sections and reference prices, a missing amount, conflicting totals, and corrected or shared amounts.

## Receipt import (F6.10, F6.2)

- **Fingerprint.** `receiptFingerprint(parsed)` in `src/application/purchases.ts` is a SHA-256 of the evidence that was read: chain, store, purchase time, and each line's role, label, quantity and printed price, each adjustment and each printed amount. The same trip as text or as PDF is one source; another day, time, row or amount is another. Rows after the total are never read, so no payment or loyalty identifier can be in it. A receipt with no date dedupes only against identical evidence.
- **Atomic import.** `PurchaseStore.importReceipt(text, format, { keepOriginal? })` parses, builds source and event (`receiptPurchase`, IDs `receipt-<digest>`), merges through `mergePurchase`, replaces that event's rule interpretations, and writes ledger and optional original in one `setMany`. It returns `ReceiptImport`: `{ outcome: "added" | "updated" | "duplicate" | "unsupported", eventId, lines, unreadableLines, reconciliation }`. A duplicate writes nothing, unless the shopper now chose to keep the original. An unsupported file writes nothing.
- **Interrupted writes.** `PurchaseStore.write` reads back after a failed write: durable means success, unchanged means the error, anything else is `commitUnknown`. No write is retried.
- **IPC.** `importPurchaseReceipt({ keepOriginal? })` opens the file dialog, reads with the existing reader (20 MB, 100 pages, 50,000 characters, 30 seconds; errors `receiptTooLarge`, `receiptNoText`, `receiptUnreadable` unchanged) and calls `Service.importReceiptText({ text, format, keepOriginal })`. `importLegacyReceipts()` is the explicit import of `receiptText`: the text is cut where a supported shop name starts a row, each part that parses becomes a purchase and leaves the saved text, and every other part stays there. `snapshot.purchaseImport` is `{ source: "receipt", …ReceiptImport }` or `{ source: "legacy", added, updated, duplicate, unsupported }`.
- The older `importReceipt` IPC, which appends text to `receiptText`, is unchanged until F6.16 moves the Data screen to `importPurchaseReceipt`.
- A parser change gives the same file another fingerprint only if the evidence itself changes; reprocessing an existing source from its retained original is not implemented.

Every import is local: no AI request (unless F6.14's consented step follows), no catalogue search, no retailer call, and no change to the list, quote or revision. Fixtures: `tests/receipt-import.test.ts` (7: whole commit, exact and cross-format duplicates, a distinct trip, identifiers absent from fingerprint, ledger, backup and diagnostics, unreadable/unbalanced/unsupported files, rollback and lost acknowledgement, restart, re-import after deletion, legacy import, and the real reader with both layouts and a two-page PDF) and `tests/ui/receipt-import-api.spec.ts`.

## Import coordinator (F6.14)

`ReceiptImportCoordinator` in `src/application/receipt-import.ts`, as `service.receipts`.

- `import(text, format, { keepOriginal?, ai? })` commits local facts first. Only for an added or updated purchase, with an AI provider available and saved automatic consent for exactly that provider and scope, it then runs one enrichment. A duplicate, an unsupported file or missing consent asks nothing.
- `enrich(eventId, ai, consent?)` is one action: `runReceiptEnrichment`, then a commit of the accepted proposals inside the ledger queue only if the event still exists at the revision they were made for. A correction, reprocessing or deletion made meanwhile wins, and the result is `stale`.
- Status in `snapshot.receiptEnrichment`: `{ eventId, status, reason, accepted, rejected, unresolved, omitted }` with status `enriched`, `skipped`, `unavailable`, `failed`, `cancelled` or `stale`. No status removes or changes a committed purchase.
- IPC: `enrichPurchase({ eventId, consent: { providerId, scope } })` for one receipt, and `setReceiptConsent({ automatic, providerId, scope })` for the durable choice. Main gives receipts a session capped at one request (`receiptTaskLimits.aiCalls`); `cancelAI` cancels it. A retry is a new explicit action.

Fixtures: `tests/receipt-coordinator.test.ts` (6): consent off, automatic consent, another provider's consent, duplicate, one-receipt action and retry, no provider, quota, failure, malformed output, cancellation, a correction and a deletion during the request, with facts, shopping state and preferences unchanged.

## Corrections and review (F6.15)

`src/domain/purchase-review.ts`.

- `correctPurchase(ledger, input)`: `purchaseCorrectionSchema` is `{ eventId, lineId, revision, field, … }` with `field` `quantity` (`amount`, `unit`), `gross` (`amount`), `net` (`amount`) or `role` (`product`, `deposit`, `non-food`, `other`). The corrected line gets provenance `user`, paid amounts and the reconciliation are recomputed, the source revision advances, and interpretations of that line made for the old facts are dropped. The printed label, span and printed totals cannot be edited.
- `interpretPurchase(ledger, input, at)`: `purchaseInterpretationSchema` `{ eventId, lineId, revision, name, category, qualifiers, scope }` saves the shopper's interpretation for this purchase as a `user` annotation; accepting a model proposal is the same call with its values. Qualifiers must belong to the category.
- A wrong `revision` is `purchaseStale`; an unknown event or line is `purchaseMissing`.
- `purchaseView(ledger)` is the screen projection, newest first: per purchase `eventId`, `revision`, `origin`, `status`, `chain`, `store`, `purchasedAt`, `datePrecision`, `importedAt`, `retention`, `unreadableLines`, `adjustments`, `printed`, `reconciliation`, `reviewCount`, and `lines` with their facts plus `interpretation` (the shopper's, else a rule's, else a model's), `proposal` (an unaccepted model proposal beside it) and `review` reasons: `unreadable`, `missing-amount`, `unknown-quantity`, `uninterpreted`, `model-proposal`.
- IPC: `listPurchases()` returns the snapshot plus `receipts: { purchases, legacy, consent, dataScope }`; `correctPurchase`, `interpretPurchase` and `deletePurchase({ eventId, scope })` return the snapshot. None saves a household preference; memory follows on its next read. The optional enrichment states for the UI are the `receiptEnrichment` statuses above.

Fixtures are in `tests/receipt-coordinator.test.ts`: an unbalanced receipt balanced by a correction with the source total untouched, stale and invalid requests, a missing price and quantity completed, a shopper interpretation, restart, scoped deletion, and a model proposal shown as a proposal until accepted.

## Memory, aliases and statistics (F18.1, F6.17, F6.18)

`src/domain/memory.ts`. Nothing here is stored: every call recomputes from `AppState` and the ledger, so a deleted event, interpretation or preference is gone from the next read, and an old profile or backup without a ledger simply has no purchases.

- `readMemory(state, ledger)` returns `{ remembered, purchases, transfers }`. `remembered` is `categoryPreferences` (F15). `purchases` holds one `PurchaseObservation` per product or non-food line of **completed** events: `eventId`, `lineId`, `origin`, `chain`, `purchasedAt`, `datePrecision`, `label`, `quantity`, `amount`, `promotion`, `scope`, and `identity` (`key`, `name`, `category`, `qualifiers`, `origin`) from the interpretation that counts, or null. `transfers` are `listHistory` entries as `TransferRecord`. Pending, cancelled and unknown-state orders, deposits, the legacy text and transfers never become observations.
- `purchaseAliases(memory)` (F6.17) returns `{ aliases, unresolved }`. An alias key is `category:<category>|<kind>=<value>…` or `name:<name>`, so milk types are separate aliases. Each alias has `origins` counts, `confirmed` (false when only a model interpreted it), its `labels` per chain with counts, `observations` and `conflictsWithRemembered`. Labels nobody interpreted are `unresolved`. An alias means the same kind of grocery; it never states that two chains sell the same product, and nothing is written back as a preference.
- `purchaseStatistics(memory, now)` (F6.18) gives per alias, from dated completed food purchases only: `visits`, `from`, `to`, `weeksOfLastEight`, `medianGapDays`, `chains`, `confirmed` and `typical`.
  - **Comparability.** Piece counts are comparable only for the same label at the same chain, because the pack size is part of the label. Weights and volumes compare across labels. A visit with any unknown quantity in a class is left out of that class.
  - **Typical quantity.** Stated only with at least three comparable visits (`statisticsRules.quantityVisits`): the median per visit, with `visits`, `min` and `max`. Visits under a campaign or group offer are left out while three ordinary ones exist, and a visit above three times the median is an outlier. Otherwise `typical` is null, which means unknown.
- `recurrenceSuggestions(memory, now, { dismissed?, existing? })` keeps F6.3's rules: at least four of the last eight Monday-based weeks, at most five, ninety days after a dismissal, never for something that is already a recurring item (matched by name against the label). Each suggestion is a statistic plus its most common `label`. It adds nothing to a list.
- `observedSummaries(memory, limit)` returns at most 20 values in the shape of `ObservedSummary` in `src/ai/context.ts`: confirmed category aliases with two or more purchases, leaving out every category that has a saved preference.
- Service and IPC: `Service.memory()`; `purchaseInsights()` returns the snapshot plus `insights: { aliases, unresolved, statistics, suggestions, observedSummaries, actualPurchases, transfers, linkReview, confirmedTransfers }`; `dismissSuggestion({ key })` saves the dismissal in the ledger's `dismissedSuggestions`.

Fixtures: `tests/memory.test.ts` (5): completed versus pending, cancelled and transferred; an explicit preference overriding an observation; an old profile; distinct milk types and chains; a model-only alias; context summaries; forgetting; two visits giving no cadence; four of eight weeks; an outlier, an undated and a future purchase; dismissal and existing items; unknown quantities, mixed pack sizes and three five-pouch variants under one offer; and the service reading fresh after deletion.

## Source linking and purchase confirmation (F6.19, U5.1)

`src/domain/purchase-links.ts`; the ledger gained `links`, `transferLinks` and `rejectedLinks`.

| Pair | Strong, linked automatically | Review candidate only |
| --- | --- | --- |
| Receipt and order | Same known chain, both completed, at most 36 hours apart, equal printed totals, at least three matching rows and at least 80 % of the smaller record's rows matching | Within three days and either equal totals or at least 50 % of rows matching |
| Verified transfer and purchase | Same chain, purchase from one day before to seven days after the transfer, at least three matching products and at least 80 % of the transferred products matching | At least 50 % matching in that window |

Rows match when a word of four or more letters in one label begins, or is begun by, such a word in the other. When one record has several strong counterparts, none is linked and all go to review, so similar trips are never merged by a guess. Half the products within three days is therefore at most a review candidate.

- `linkCandidates(ledger, transfers)` lists candidates not yet decided; `linkStrong` adds the strong ones as links `by: "rule"`; `decideLink(ledger, candidate, same)` records the shopper's answer either way (`by: "user"`, or a rejection that is not offered again). A purchase and a transfer each link once. Deleting an event removes its links.
- `actualPurchases(ledger)` is the only source of actual spending: completed events with linked records counted once, each with `eventIds`, `chain`, `purchasedAt`, `datePrecision`, `total`, `totalSource`, every record's own `totals`, `conflictingTotals`, and the printed `foodSubtotal` and `nonFoodSubtotal` or null. The receipt's printed total is authoritative over the order's. A transfer is never in it.
- `confirmedTransfers(ledger)` lists transfers with a linked completed purchase.

**U5.1 audit.** The store view (`src/main/store-view.ts`) only allows or asks about navigation; it captures no order-confirmation URL or session signal and never reads payment-domain pages. No URL pattern is established, so none is detected; if one is added it is a review signal at most. What is connected: after every order, receipt or legacy import and every link decision, `Service` runs the strong linking and lets a confirmed transfer count as purchased exactly once. It writes the same `ordered-<transferId>` record the manual button uses, now with provenance (`by: "evidence"` and the event ID, or `by: "manual"`), and advances `lastPurchased` only for recurring items the purchase actually contains. `snapshot.purchaseSignals` lists `{ transferId, eventId, strength: "confirmed" | "review" }`. A pending or cancelled order, a weak match and a transfer alone confirm nothing. IPC `decidePurchaseLink({ candidate, same })` records the shopper's answer.

Fixtures: `tests/purchase-links.test.ts` (5): the strong link counted once, reprocessing and deletion, nine weaker or unrelated cases, conflicting totals, rejection, ambiguous similar visits, transfer cases including the old heuristic, pending, cancelled and undated evidence, two transfers before one purchase, evidence confirming once across repeated imports, and a weak match waiting for the shopper.

## Repeat (F18.3)

IPC `repeatList({ historyId, revision })` (`Service.repeatList`, `src/domain/repeat.ts`) starts a new list from a verified transfer in `listHistory`: its meals with new IDs, recipes, extras, at-home and removed rows, quantities and note. Recipes saved since then win over the entry's copies; a meal whose recipe exists in neither is left out and named. Category preferences and product choices stay; request intents and row corrections are cleared, and the list in progress is archived as with any new list. Every row is then priced fresh at the selected store and state, quote and observed prices are written atomically. It makes no AI request and no retailer write.

`snapshot.repeat` (`RepeatResult`, for the revision it created only): `historyId`, `revision`, `transferredAt`, `rows`, `unresolvedRows`, `storeChanged`, `partialHistory`, `missingRecipes`, and, at the same store only, `changedPrices` (`name`, `before`, `now`) and `notSelected` (transferred products the fresh quote did not choose). A wrong revision is `draftStale`, an unknown entry `historyMissing`, and a failed catalogue read leaves the current list untouched. An unchanged repeat has the same batch key as the verified transfer, so the existing duplicate guard still applies; a changed one needs its own approval.

Fixtures: `tests/repeat.test.ts` (4) and the IPC check in `tests/ui/receipt-import-api.spec.ts`.
