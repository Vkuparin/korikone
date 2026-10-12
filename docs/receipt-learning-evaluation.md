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
