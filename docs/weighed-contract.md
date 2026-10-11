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

## Remaining owner check

F4.1 says "Read-only unless the owner runs the write check." The remaining completion evidence is one actual sanitized search result per chain and observed quantity/readback behavior. The synthetic fixtures do not satisfy that live-result requirement.

The owner can check one weighed product in each retailer's own site, record the product's displayed price basis and approximation, the selectable unit and quantity step, then manually set a small amount in the cart/list and read it back. Record requested versus returned quantity, unit, refusal or rounding and whether the site shows piece count instead of kg. Restore the previous amount afterward. The owner chooses the product and amount; this audit does not authorize an agent write. No checkout, payment or AI request is needed (expected ChatGPT usage: zero).

Only product/search/quantity fields belong in a committed sanitized result. Omit account, basket/list IDs, names of people, session tokens and loyalty/payment data. Do not assert a readback tolerance from worker duplicate arithmetic. F4.3 remains gated on this evidence; F4.1 is incomplete until the actual search samples and rounding contract are recorded.
