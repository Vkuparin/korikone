# Transfer contract (B2.16)

How the shopping list reaches a store basket. Implemented in `Service.transferDisplayed`, `prepare`, `execute` and `recover` (`src/application/service.ts`) and `createReview`, `transfer` and `resumeReview` (`src/application/transfer.ts`). Checkout, delivery or pickup time and payment always stay with the shopper in the store's own page.

## One click by default

`window.korikone.transferDisplayed({ revision, quotedAt, batchKey })` is the transfer button. `revision` and `quotedAt` come from the snapshot and `batchKey` is `snapshot.transferBatchKey`. The click authorizes exactly what the list shows:

- the selected store and the signed-in account,
- each priced row's product ID, pack and whole quantity,
- which rows are covered. Rows with no product are left out and recorded in `journal.review.unresolved`; they are never reported as sent.

With `state.reviewBeforeTransfer` false (the default, also for older profiles) the service then reads the store basket and each product once more and writes without another question. These do **not** stop the transfer and need no acknowledgement:

- items already in the store basket (quantities are absolute: `target.quantity = before + packs`),
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

## Optional review

`state.reviewBeforeTransfer: boolean` (default `false`) is saved with the profile. `window.korikone.setReviewBeforeTransfer({ enabled })` changes it; it is a preference only and changes neither the list revision nor the quote. Saving it through the ordinary `save` has the same effect. When true, every transfer click returns `acknowledgeReview` with `snapshot.review` holding `targets` (with `before`), `total`, `unresolved`, `unresolvedIntents` and `priceChanges`; the existing confirmation region shows it and `execute({ id, acknowledged: true })` sends it. The setting never bypasses the account, store, revision, exclusion or quantity checks.

## For the list UI (B2.9, B2.19)

- Before the click everything shown comes from the snapshot: `basket` (rows with a product are sent, the others are left out), totals and the budget.
- During the click the renderer's own pending state applies; `transferDisplayed` resolves once the journal is `verified` or `partial`, or with a `transferException`.
- After the click: `snapshot.journal.status`, `journal.review.targets` (`before` shows what the basket already held), `journal.review.unresolved`, `journal.review.priceChanges` and `journal.review.total`.

## Fixtures

`tests/one-click-transfer.test.ts` (development stand-ins for both chains): complete one-click success and same-list repeat, existing basket items, budget overrun and rows left out, changed price, changed pack, stale revision and batch, changed account, partial failure and recovery, and the opt-in review with its persistence. `tests/ui/one-click-transfer.spec.ts` clicks the real button in development mode. `tests/service.test.ts` keeps the review behaviour under the setting.
