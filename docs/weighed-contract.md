# Weighed catalogue and quantity audit

F4.1 source audit, 11 October 2026. `tests/fixtures/weighed-contract.ts` contains independently authored wire examples, not captured store results. `tests/weighed-contract.test.ts` passes two real-adapter cases for source-price retention, fractional readback and rejected writes. No retailer account, live AI or retailer write was used.

## Pricing facts

K-Ruoka 0.1.3 `search_products.results[]` reports `price` in euros, `priceUnit` (for example `kg`) and `priceIsApproximate`. The pinned mapping reads `mobilescan.pricing.normal`; `comparisonPrice` is formatted unit-comparison text, not the selected price basis. The current embedded `KRuokaSite` maps the same normal price/unit/approximation fields. `KRuokaProvider` retains integer cents and the original price unit in `Product.cataloguePricing`.

S-kaupat 1.3.0 `search_products.products[]` reports `price` in euros, `priceBasis: per_weight`, `quantityUnit: KG` and nullable `approximatePrice`. The worker maps upstream `priceUnit: KG` to `per_weight`; an unknown unit maps to `unknown`. A comparison price or a name containing a weight does not establish the selected price basis. `SKaupatProvider` retains integer cents, source basis/unit/approximation and deposit in `cataloguePricing`.

Both app adapters currently return null purchasable price and zero increment for weighed products. This protects existing matching/transfer paths. F4.2 can consume the retained catalogue facts for labelled estimates, but must not turn a weight price into a pack or confer transfer eligibility. Unsupported or unknown bases remain unknown; a kg price cannot price a volume requirement without a separately proven conversion.

## Quantity and rounding facts

| Boundary | Source-proven contract | What remains unverified |
| --- | --- | --- |
| K-Ruoka pinned worker | `add_to_cart` accepts a positive floating-point `quantity`, an explicit `unit` and resulting absolute quantity. `update_cart_item` accepts a floating-point amount and defaults to the existing unit; `get_cart.items[]` returns `amount` and `unit`. The source warns that products priced by weight can still be ordered in pieces. | A kilo price does not establish an orderable kg amount. The store's accepted unit, step and readback rounding for an actual weighed product require an owner-observed check. |
| Embedded K-Ruoka | `KRuokaSite` currently validates positive integer quantities up to 100 and literal `kpl` for both write tools. It passes readback amounts/units through. | Fractional writes are not supported by the current boundary. F4.3 must change both the site validation and provider validation after a product-specific unit contract is verified. |
| S-kaupat 1.3.0 worker | List tools accept positive quantities up to 99: pieces for per-item goods, kilograms for per-weight goods. The list service rejects fractional per-item amounts. Duplicate input quantities are summed and rounded to three decimals to avoid floating-point addition noise. Returned list items contain numeric `quantity` and product price basis. | Three-decimal duplicate merging is worker arithmetic, not evidence of retailer rounding. List readback matches requested amounts exactly in the worker; store rounding/rejection and supported increments remain unverified. |
| Current S-kaupat adapter | `getCart` derives `kg` for per-weight list products; `setQuantity` currently accepts integer `kpl` only and refuses weighed rows. | Unknown/null product basis must not become authority to write kg. F4.3 needs an explicit verified weighted-product path and a recorded tolerance. |

Evidence: K-Ruoka pinned [types](https://github.com/nikosavola/k-ruoka-mcp/blob/a3d2b5d009d187d0e99393f4837169e5e36b3c35/src/types.rs) and [tool arguments](https://github.com/nikosavola/k-ruoka-mcp/blob/a3d2b5d009d187d0e99393f4837169e5e36b3c35/src/mcp/tools.rs); local `src/stores/k-ruoka-site.ts`/`k-ruoka.ts`. S-kaupat installed 1.3.0 `dist/server.js` listItems schema, `dist/lists/service.js` quantityProblem/matches/mergeDuplicates and `dist/lists/types.d.ts`; local `src/stores/s-kaupat.ts`. This records inspected behavior, not a live acceptance result.

## Owner observation: K-Ruoka piece ordering

On 11 October 2026 the owner reported that K-Ruoka orders these loose products in pieces and shows an estimated price; final price is recorded after checkout and actual weighing. The supplied cart screenshot shows Pirkka organic Fairtrade bananas at 4 kpl, approximately 0.175 kg per piece and an estimated total of 1.67 euros; Finnish cucumbers at 3 kpl, approximately 0.35 kg per piece and an estimated total of 2.09 euros. The controls display whole-piece quantities. This is owner-observed cart evidence, not a captured catalogue search or an agent write test. The private screenshot is not copied into the repository.

## Owner observation: S-kaupat piece ordering

On 11 October 2026 the owner confirmed that S-kaupat works the same way as K-Ruoka. The supplied cart screenshot shows Kotimaista cucumber at 2 kpl and an estimated total of 1.28 euros, and Coop banana at 3 kpl and an estimated total of 0.84 euros. The visible controls display whole-piece quantities. This is owner-observed website cart evidence, not a worker list API readback or a captured search result. The private screenshot is not copied into the repository.

For both retailer-cart paths, F4.3 must preserve piece ordering. A kg catalogue price remains pricing evidence only. Converting a gram requirement to pieces needs explicit product-specific estimated weight per piece, a documented rounding rule and piece readback. Do not send kg amounts based on the kg price. The displayed estimated piece weight is not an exact pack size; final weight and price can change. The S-kaupat worker's per-weight list quantity semantics must be reconciled with website piece ordering before writes are enabled; a saved list and the checkout cart are different boundaries.

## Remaining owner check

F4.1 says "Read-only unless the owner runs the write check." The remaining completion evidence is one actual sanitized search result per chain and observed quantity/readback behavior. The synthetic fixtures do not satisfy that live-result requirement.

The owner can check one weighed product in each retailer's own site, record the product's displayed price basis and approximation, the selectable unit and quantity step, then manually set a small amount in the cart/list and read it back. Record requested versus returned quantity, unit, refusal or rounding and whether the site shows piece count instead of kg. Restore the previous amount afterward. The owner chooses the product and amount; this audit does not authorize an agent write. No checkout, payment or AI request is needed (expected ChatGPT usage: zero).

Only product/search/quantity fields belong in a committed sanitized result. Omit account, basket/list IDs, names of people, session tokens and loyalty/payment data. Do not assert a readback tolerance from worker duplicate arithmetic. F4.3 remains gated on this evidence; F4.1 is incomplete until actual search samples and the adapter/list-to-cart quantity contract are recorded. The owner observations above establish piece ordering and estimated final prices for the displayed loose produce in both website carts. Further agent work should reconcile technical boundaries before requesting another owner check.

## F4.2 estimate contract

`approximateCost(requirement, product)` in `src/domain/planner.ts` computes integer cents for an explicit kg/g or l/ml price basis, rounded to the nearest cent. Unknown or contradictory bases, incompatible units, unavailable products, deposits and unsafe arithmetic remain unresolved. It uses the requested amount, not an invented pack weight. Existing identity, type, household and preference validation still applies through `matchRequirement`.

Estimated `BasketLine` rows have `approximate: true`, `packs: 0` and an estimated `total`; raw catalogue facts and null purchasable prices remain unchanged. `priceBreakdown` splits exact, approximate and unknown rows. Shopping rows label estimates with "noin"/"about", show requested grams or millilitres and split the pinned total. Comparison includes estimates as priced rows and propagates `Comparison.common.approximate`, `ChainTotals.approximate` (estimated subtotal in cents) and `RowDifference.approximate` to the labels.

`PlanningRun.publishRow` and `planningSnapshotSchema` carry the estimate flag and validate zero packs for resolved estimates. `persistedQuoteSchema` persists it; `restoredQuote` recomputes the flag and price from retained candidates and rejects changed flags. `purchasable` rejects estimated-price products, and `createReview` rejects estimated rows before reading or writing the store cart. `Service.prepare({allowMissing: true})` omits these rows and lists them in `Review.unresolved` for explicit partial-transfer acceptance. A basket containing only estimated rows cannot use the transfer button. This is the current boundary until F4.3 establishes each chain's ordering contract.

Development data includes a synthetic weighed apple in `src/stores/demo.ts` and a finite apple interpretation in `src/ai/planning-fixtures.ts`. Domain arithmetic/failure fixtures, real SQLite commit/restart/tamper checks, and desktop split-total/restart/partial-review plus comparison checks exercise the estimate contract locally. These fixtures do not establish retailer ordering or final weighed prices.
