# Transfer contract (B2.16)

How the shopping list reaches a store basket. Implemented in `Service.transferDisplayed`, `prepare`, `execute` and `recover` (`src/application/service.ts`) and `createReview`, `transfer` and `resumeReview` (`src/application/transfer.ts`). Checkout, delivery or pickup time and payment always stay with the shopper in the store's own page.

## One click by default

`window.korikone.transferDisplayed({ revision, quotedAt, batchKey })` is the transfer button. `revision` and `quotedAt` come from the snapshot and `batchKey` is `snapshot.transferBatchKey`. The click authorizes exactly what the list shows:

- the selected store and the signed-in account,
- each priced row's product ID, pack and whole quantity,
- which rows are covered. Rows with no product are left out and recorded in `journal.review.unresolved`; they are never reported as sent.

With `state.reviewBeforeTransfer` false (the default, also for older profiles) the service then reads the store basket and each product once more and writes without another question. These do **not** stop the transfer and need no acknowledgement:

- items already in the store basket (quantities are absolute: `target.quantity = before + packs`; an earlier transfer of the same list counts as sent, see [below](#sending-a-changed-list-again-b52)),
- a total above the household budget,
- rows or requests left out because they have no product.

## What still stops it

Nothing is written and the snapshot says why.

| Result | Meaning | What the UI offers |
| --- | --- | --- |
| rejects `draftStale` | The revision, quote time or batch is not the one shown, or the list changed while the store was being read | Reload the list |
| rejects `busy` | Another transfer or a planning commit is running; a second click cannot double the quantities | Wait |
| rejects `accountChanged`, `contextChanged`, `loginRequired`, `unitMismatch`, `excessiveQuantity`, `cartChanged`, `quoteExpired` | The account, store or basket is not the one the list was priced for, or a quantity is not safe to write | The existing error text for that code |
| `transferException: "priceChanged"` | A product is unavailable, or its pack, unit, type or ordering facts differ from what was shown | "Get products and prices" (`buildBasket`) |
| `transferException: "unresolved"` | No row has a product | The list itself |
| `transferException: "recoverFirst"` | An earlier transfer ended partly written (`journal.status === "partial"`) | `recover()`, then `execute` for what is missing |
| `transferException: "acknowledgeReview"` | Only when `reviewBeforeTransfer` is true: the review is in `snapshot.review` | Confirm with `execute({ id, acknowledged })` |

A partial or uncertain write keeps its journal. The next click returns `recoverFirst` and never proposes a second routine approval.

## Changed prices

When only the price or deposit of a shown product changed, the same product and quantity are sent and the change is reconciled:

- `review.priceChanges` (and, after sending, `journal.review.priceChanges`) lists `{ productId, name, before, after }` with row totals in cents.
- The list rows, the total, `journal.review.total` and the saved quote carry the store's current prices. `snapshot.transferBatchKey` equals `journal.batchKey`, so repeating the same list writes nothing.
- A product that needs a piece count or estimate recomputed, a missing price, or an unsafe total is not reconciled: it stops with `priceChanged`.

A review asked for directly with `prepare()` keeps the stricter rule and refuses a changed price; only the transfer button reconciles.

## Repeating the same list

After a verified transfer of the same batch, another click reads the basket, checks the account and writes nothing.

## Sending a changed list again (B5.2)

A transfer of the same list after an edit, a price update or a recurring row sends only what earlier transfers of this list did not. `createReview` takes the last verified journal's `review.listSent` when that journal is for the same provider and store, its account matches the basket, and no New list has started since (`journal.listClosed`). Per product, `listSent` holds `sent`, Korikone's part, and `before`, what the basket held besides it.

- Korikone's part counts only while the basket still holds it: `min(sent, current - before)`. After a checkout or an emptied basket nothing counts and the row is sent in full; a basket reduced by hand counts only what is left.
- A row sends `packs - counted`, at least zero. A fully counted row is not written; it is listed in `review.alreadySent` (`{ productId, name, quantity }`), which the transfer result shows as "Jo siirretty aiemmin tästä listasta". Its price is scaled to the packs actually sent.
- Nothing is taken out of the basket: a row the shopper reduced or removed keeps what was sent.
- `resetList`, `newWeek`, `reuseWeek` and `approveDraft` (New list paths) set `journal.listClosed`; Clear list does not, because it can be undone.
- A click that finds every row already sent writes nothing, ends `verified` and changes no `listHistory` entry. Otherwise the new entry's `transferred` is the whole list as sent (written now plus counted, `reviewLines` in `src/domain/changes.ts`) and replaces the entry of the earlier transfer it continues (`review.continues`), so "Muutokset edelliseen" still compares whole lists.
- A recovered partial transfer carries the original review's `listSent`.
- Journals saved before B5.2 have no `listSent`, so the first transfer after upgrading sends in full.

## Optional review

`state.reviewBeforeTransfer: boolean` (default `false`) is saved with the profile. `window.korikone.setReviewBeforeTransfer({ enabled })` changes it; it is a preference only and changes neither the list revision nor the quote. Saving it through the ordinary `save` has the same effect. When true, every transfer click returns `acknowledgeReview` with `snapshot.review` holding `targets` (with `before`), `total`, `unresolved`, `unresolvedIntents` and `priceChanges`; the existing confirmation region shows it and `execute({ id, acknowledged: true })` sends it. The setting never bypasses the account, store, revision, exclusion or quantity checks.

## For the list UI (B2.9, B2.19)

- Before the click everything shown comes from the snapshot: `basket` (rows with a product are sent, the others are left out), totals and the budget.
- During the click the renderer's own pending state applies; `transferDisplayed` resolves once the journal is `verified` or `partial`, or with a `transferException`.
- After the click: `snapshot.journal.status`, `journal.review.targets` (`before` shows what the basket already held), `journal.review.unresolved`, `journal.review.priceChanges` and `journal.review.total`.

## Store calls and latency (B2.10)

Measured with `tests/transfer-latency.test.ts`: a five-row list, a development stand-in for each chain whose every store call is counted and, in one case, delayed by 20 ms.

| One-click transfer of 5 rows | Product reads | Basket reads | Writes | Calls | Time at 20 ms per call |
| --- | --- | --- | --- | --- | --- |
| Before | 10 | 18 | 5 | 33 | 1035 ms |
| After | 5 | 12 | 5 | 22 | 694 ms |

The time column is one run on the development PC on 13 October 2026 with timer granularity included; it shows that elapsed time follows the number of sequential calls and is not a claim about a real store.

What was removed, and why it is safe:

- **The second product read.** `transfer` read every product again immediately after `createReview` had read it in the same click. `transfer(..., reviewJustRead)` now skips that only when `transferDisplayed` continues straight from its own review, and only while the review is younger than `FRESH_REVIEW_MS` (30 s). A review the shopper looked at first (`execute` from the confirmation, or a recovery) is always read again, so a price, pack or piece-weight change during the pause still stops before any write. The IPC `execute` cannot set the flag.
- **The basket read before each write and after the last one.** The basket is read once before the first write and read back after every write; each read-back is the verified whole-basket reading that precedes the next write. An external change is still caught by the next read-back, the write after it does not run, and the journal stays `partial` with `uncertain` set.

Unchanged: one write at a time in list order, absolute quantities, the account and store checks, the journal written before and after each write, read-back verification, `recoverFirst`, the same-list repeat guard and cancellation between writes.

Per write, each real adapter also reads the basket itself before writing (`setQuantity` in `src/stores/s-kaupat.ts` and `src/stores/k-ruoka.ts`). For S-kaupat a basket read is two tool calls (`login_status`, `get_shopping_lists`), so an N-row transfer makes about 7N + 6 basket-side tool calls before this change and 5N + 4 after it, besides the product reads (2N before, N after).

Not done, because it needs a verified store contract first: sending all rows in one `add_to_shopping_list` call, and letting the adapter reuse the caller's basket reading instead of its own. Both would need live acceptance with the owner's account. Proposed bounded check when wanted: one transfer of three products to an empty S-kaupat list and one to K-Ruoka, comparing the journal with the store page; no AI request.

## Fixtures

`tests/one-click-transfer.test.ts` (development stand-ins for both chains): complete one-click success and same-list repeat, existing basket items, budget overrun and rows left out, changed price, changed pack, stale revision and batch, changed account, partial failure and recovery, and the opt-in review with its persistence. `tests/ui/one-click-transfer.spec.ts` clicks the real button in development mode. `tests/service.test.ts` keeps the review behaviour under the setting.

## Non-food rows (F22.7)

A non-food row is never sent unless the provider declares `capabilities.merchandise.cartWrite`; none does. A row with a product is listed in `review.manual` and `snapshot.merchandise.manual` for the shopper to add on the store's own page, apart from `review.unresolved`. A list with nothing else to send stops with `manualOnly`. `unsupportedWrite` is the refusal at the write boundary. Details: [retail expansion](retail-expansion.md#non-food-rows-and-the-store-basket-f227).
