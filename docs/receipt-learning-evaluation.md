# Receipt learning evaluation (F6.20)

Feature fixture evidence was collected on claude/project-thread-ahxe8n and is now integrated and included in v0.9.0. [Release verification](release-0.9.0.md) records the one full flow and affected reruns. All checks use local fixtures: no live retailer account, real receipt or live AI request. Private receipts under ignored scratch/receipts were not opened.

## Independent fixture coverage

Expectations in `tests/fixtures/receipts/` were written from the printed layout and its arithmetic, never from parser output (see [purchase-contract.md](purchase-contract.md#receipt-fixtures-f66)). `tests/receipt-fixtures.test.ts` checks that each expectation is internally consistent; `tests/receipt-parsers.test.ts` and `tests/receipt-import.test.ts` compare parser results with it.

| Area                                           | Fixture IDs                                                          | Unknowns kept explicit                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Quantity after / before price                  | `s-quantity-after-price`, `k-quantity-before-price`                  | A row with no printed count is one piece; a pack size in a name is not a count               |
| NORM. and campaigns                            | `s-norm-campaign`, `s-basic-campaign`                                | NORM. is informational; a campaign tied to the row above it is allocated to that row         |
| Multi-page continuation                        | `s-multi-page`                                                       | Repeated header text on page two is not a row                                                |
| Weighted produce                               | `s-weighed-produce`, `k-weighed`                                     | Weights are whole grams with the per-kilogram price                                          |
| Multiple milk types                            | `s-multiple-milk`                                                    | A repeated row is a separate line, not a count of two                                        |
| Three groups of five pouches, group promotions | `s-five-groups`, `k-group-promotion`                                 | `net` is null for each row; one group adjustment with no per-row split                       |
| Deposits                                       | `s-deposits`, `k-deposit-no-section`                                 | A deposit return is a receipt-level adjustment                                               |
| Non-food and printed breakdowns                | `s-non-food-subtotals`, `s-printed-subtotal`                         | Non-food only where a section header says so; no breakdown is manufactured                   |
| Not a receipt                                  | `unknown-restaurant-bill`, `unknown-plain-note`                      | No event, no spending                                                                        |
| Partial and inconsistent                       | `partial-missing-total`, `partial-missing-price`, `unbalanced-total` | A missing price is never taken from a printed total; a difference is shown, not corrected    |
| Injection                                      | `injection-in-label`, `injection-row`                                | Instruction text is an inert sanitized label; an address in it becomes `…`                   |
| Duplicate and distinct trips                   | `trip-original` (text and PDF), `trip-distinct`                      | The same trip as a PDF is a duplicate; another day with the same rows is a separate purchase |

## Journeys and gates

| Gate                                              | Evidence                                                                                                                                                                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Import and migration; duplicates; money and units | `tests/receipt-import.test.ts`, `tests/ui/receipt-import-api.spec.ts`, `tests/ui/receipt-review.spec.ts`, `tests/ui/purchase-journey.spec.ts` (text and PDF of one receipt, repeat, unsupported and broken files)                                                  |
| Cross-source duplicates and linking               | `tests/purchase-links.test.ts`, `tests/ui/purchase-link-review.spec.ts` (a half match is only a review candidate; the answer is kept)                                                                                                                              |
| Consent and redaction                             | `tests/receipt-coordinator.test.ts`, `tests/receipt-enrichment.test.ts`, `tests/ui/receipt-review.spec.ts`, `tests/ui/purchase-journey.spec.ts` (off by default; another provider's consent does not apply; at most one request per action; sanitized labels only) |
| Deletion and backup                               | `tests/purchases.test.ts`, `tests/ui/receipt-review.spec.ts`, `tests/ui/purchase-journey.spec.ts` (sanitized records in the backup, no consent, no original unless chosen)                                                                                         |
| Stale, cancelled and failed AI                    | `tests/receipt-coordinator.test.ts`; `tests/ui/receipt-review.spec.ts` for a usage limit and retry with facts intact                                                                                                                                               |
| Observation and preference separation             | `tests/memory.test.ts`, `tests/memory-context.test.ts`, `tests/ui/purchase-journey.spec.ts` (`categoryPreferences` unchanged by imports and suggestions; observations reach the model only for a request for the usual)                                            |
| Suggestions, spending and repeat                  | `tests/purchase-histories.test.ts`, `tests/ui/purchase-suggestions.spec.ts`, `tests/spending.test.ts`, `tests/ui/spending-history.spec.ts`, `tests/ui/repeat-list.spec.ts`                                                                                         |

## Development histories (F6.4)

`DemoProvider` for `s-kaupat` and `demo-s` returns `demoOrders` (four orders) by default. The development scenario `history` (`Service.scenario("history")`, IPC `scenario("history")`) adds `demoWeeklyOrders(now)`: six completed weekly orders counted back from today, one cancelled and one with unreadable rows. Milk (two pieces) recurs every week; bananas (weighed) are read by no rule and stay unresolved; coffee appears in two weeks only and gives no cadence. Receipt histories are the fixtures above, imported through `importPurchaseReceipt` with a stubbed file dialog.

Finding recorded while building this: order import wrote no rule interpretations, so milk and coffee in an order history never became an alias. `PurchaseStore.importOrders` now adds the same local rule annotations as receipt import for added or updated orders.

## Not covered by fixtures

- Live ChatGPT interpretation quality of receipt labels and of "the usual" requests. A live check would be one request per receipt and one per planning request, at most two with a repair.
- Receipts and orders from real shops, scanned PDFs (OCR is F13) and K-Ruoka order history (no read is established).
- Phone and window-size ergonomics beyond the 800 px width the focused UI checks use.

## Readable-name goldens and metrics (F27.7)

`tests/fixtures/receipts/names.ts` holds 24 invented abbreviated-label cases in the style of Finnish shop receipts. Each expectation was written from the printed label alone, before the validator was run against it: the fullest name the label proves (`display`, or null), its tier, acceptable generic names, the scope, and `inventions`, plausible answers that add something the label does not print. No expectation comes from a model's answer or confidence, from the resolver under test or from an owner receipt.

Review record: the runner was first run after the cases were written. It found one fault in the validator (an expansion was accepted for a word that did not start with its printed token, so `ARLA LTON MAITOJUOMA 1L` supported "kevytmaitojuoma"), which was fixed in the validator. No expectation was changed to fit the code. The cases were authored and reviewed by one agent; a second reader has not checked them.

Areas: brand and pack abbreviations, a yoghurt with no printed flavour and one with a printed flavour, milk qualifiers (printed, abbreviated ambiguously, and from the abbreviation table), private-label and abbreviated bread, the same label twice on one receipt, weighed produce, a mince pack without its fat percentage, eggs, a multipack, a deposit row, a campaign row, two non-food products, a label too terse to read, and two labels carrying an instruction.

### Metrics

Computed over bought lines (roles `product` and `non-food`) with `tierCounts` in `tests/receipt-name-goldens.test.ts`, from `DisplayName.tier`:

- **exact**: every word shown is printed, apart from case and spacing.
- **expanded**: at least one printed abbreviation is spelled out, under the F27.6 evidence rule.
- **generic**: a grocery name with no brand or pack.
- **raw-only**: the sanitized printed label is shown.
- **false specificity**: the number of `inventions` accepted as a display name, over the inventions tried. The gate is zero, and separately zero on the cases marked `ambiguous`.

A model's self-reported confidence is never an input to any of these.

### Baseline, 13 October 2026

| Measure | Result |
| --- | --- |
| What the 24 labels support (expected tiers) | 14 exact, 3 expanded, 3 generic, 4 raw-only |
| Expected names accepted by `groundedDisplayName` with the expected tier | 17 of 17 |
| Inventions accepted (false specificity) | 0 of 56; 0 on the 9 ambiguous cases |
| Shown today for the 22 bought lines, local rules only | 0 exact, 0 expanded, 0 generic, 22 raw-only |
| Of those 22, lines where a rule knows the category | 11 |
| Bought labels that become an exact name by ordinary capitalisation alone, with no model | 22 of 22 |

Read with care: this is a fixture baseline of the contract, not a measure of real receipts or of any model. The last row says a local resolver (F27.8) can reach an exact name for every one of these labels without a request; a model is needed only for the three expansions and for generic names.

Known limits recorded for F27.8 to F27.10:

- A generic `name` proposed by a model is still accepted without printed evidence, as before F27.6 (a short plain label is enough). For the two instruction-bearing labels and `TK 2KPL` the goldens expect no generic name; whatever a model proposes there stays model-only and tentative, and is not a display name.
- Expansions are limited to `expansionWords` and `printedAbbreviations` in `src/domain/receipt-names.ts`. An abbreviation that fits two listed words (`KEVYTM`, `RUISL`) is deliberately not expanded. Extending either list needs a new golden case.
- `M10` on the egg label stays as printed; turning it into a count would restate a quantity.

Contracts consumed by F27.8 and F27.9: `nameGoldens` with its `NameGolden` type, `tierCounts`, `groundedDisplayName` and the three assertions of `tests/receipt-name-goldens.test.ts` (expected names accepted, zero inventions accepted, baseline tier counts). A resolver or task under test reports its own tier counts beside this baseline and must keep false specificity at zero.

## Local resolver baseline (F27.8)

Same 22 bought lines of the goldens, shown through `displayName` with no model and no consent. Before F27.8: exact 0, expanded 0, generic 0, raw 22. With `localDisplayName`: exact 14, expanded 3, generic 0, raw 5 (`tests/receipt-name-goldens.test.ts`). All 17 golden names are produced and none differs from its expectation apart from case; the five raw lines are the two ambiguous abbreviations, the unknown short code, the injected instruction and the injected product line. Inventions accepted: 0 of 56. The three golden `generic` cases need a category from a rule or a model, which is not claimed here. No live-quality claim.

## Integration audit and release evidence (F27.12)

13 October 2026, on `claude/project-thread-q9ucii` after F27.1 to F27.11. This section audits the joined contracts and reuses the focused checks each card recorded; it is not a new full matrix and not a release-readiness claim. No owner receipt, live account or provider call was used.

### Gates and where each is shown

| Gate | Evidence |
| ---- | -------- |
| No routine row action or modal | `tests/ui/receipt-integration.spec.ts`: no dialog after a drop, cards collapsed, `issueCount` 0 for rows that only lack a readable name. `tests/ui/receipt-names.spec.ts`: no review list (F27.2) |
| One action gives durable local history | Integration spec: one real drop of seven files saves four purchases, readable before any request and present after restart. Picker: `tests/ui/receipt-intake-api.spec.ts`, `receipt-import-surface.spec.ts` |
| Every product has a grounded name or its printed label | Integration spec over all bought rows; `tests/receipt-name-goldens.test.ts` |
| No invented specificity | Goldens: 0 of 56 inventions accepted by `groundedDisplayName`, 0 produced by `localDisplayName`; 9 ambiguity cases |
| No unauthorized model request | Integration spec: 0 requests after the drop, exactly 1 after Just this import for four purchases, 0 on the next import. `tests/receipt-intake.test.ts`, `receipt-name-wiring.test.ts` for both adapters |
| No duplicate exact import, distinct trips kept apart | Integration spec: the same trip as text and as PDF is one purchase; the same rows on another day are a second one; a deleted purchase can be imported again |
| No retailer read or write from import | Integration spec: store writes 0, catalogue requests unchanged, state, basket, context and journal equal before and after |
| Scoped failures | A broken PDF and a readable PDF that is no receipt fail alone in the batch (integration spec). Busy shopping, scoped cancel, deadline and a source changed meanwhile: `tests/receipt-intake.test.ts`, `tests/ui/receipt-intake-api.spec.ts` |
| Stale correction refused, correction is not a preference | Integration spec: a correction with another revision fails, the current one names one row as `user`, preferences unchanged |
| Backup, deletion and retention copy | Integration spec: the backup holds the purchases and the correction and no original or address; deletion removes one purchase; the details say that neither the source text nor the PDF is kept |
| Memory and planning context | `tests/memory-names.test.ts` (F27.10), `tests/ui/receipt-readable-views.spec.ts` (F27.11) |

### Measurements

- **Name specificity, goldens (22 bought lines).** Before F27.8: raw 22. Now, with no model: exact 14, expanded 3, generic 0, raw 5. The labels themselves support at most exact 14, expanded 3, generic 3, raw 4 of 24. False specificity: 0 of 56.
- **Name specificity, integration batch (12 bought lines of four synthetic receipts, one read by OCR).** Local: exact 9, expanded 1, raw 2. After the one development-model request: the same. The two raw lines are an ambiguous abbreviation (`PIRKKA KEVYTM 1L`) and an unknown label; the development model's proposals for them were not accepted as grounded names. This says nothing about a live model's quality.
- **Requests and writes for one import of seven files.** Before F27 a receipt was imported one file at a time and each enrichment was its own request. Now: one action; model requests 0 without consent and 1 with it, whatever the number of receipts; retailer reads 0; retailer writes 0.
- **First visible feedback.** In the integration run on the development machine, hidden window: first progress event 6 ms after the drop, all seven files settled after about 0.8 s including one OCR page. Recorded, not gated: the times depend on the machine and the files.

### Not covered

- A PDF that mixes text pages and scanned pages and is also a valid shop receipt. The mixed fixture `ocr-mixed.pdf` proves page order and OCR page numbers at the reader (`tests/receipts.test.ts`) and fails alone in a batch because it is not a receipt. A parsable mixed receipt needs a new synthetic fixture.
- Restoring a backup into another profile after a multi-file import; restore is covered for the ledger in the existing backup suites, not repeated here.
- Anything live: real receipts, real OCR quality on photographs, a live model's names.

### Optional owner checks

- **Visual, development mode, no AI allowance used:** drop two or three synthetic receipts from `tests/fixtures/receipts/` on History, read the summary, open one card in Settings, Data.
- **Live, only if wanted:** import one of your own receipts with ChatGPT connected and answer Just this import. That is 1 ChatGPT request. A later request for "the usual" is 1 to 2 more and sends readable names of usual purchases, as F27.10 records.
