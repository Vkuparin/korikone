# Released matching baseline

F15.1 audit, 10 October 2026. Released application source: v0.6.0/main `5494654`. Audit branch `codex/v0.7.0-strong`; provider-neutral interface work in `9a034bd` is not integrated into app dispatch and does not change this matcher. No retailer session, account or owner receipt was used.

The fixture corpus is `tests/fixtures/matching-baseline.ts`; `tests/matching-baseline.test.ts` runs each case through the actual `KRuokaProvider` or `SKaupatProvider`, then the real `Service.save/buildBasket` and domain matcher. Tool responses are synthetic local functions. Additional adapter cases distinguish malformed normalization from failed searches. A pure draft case records lost qualifier provenance. Focused result: 37 tests passed; typecheck and changed-file formatting passed.

Passing baseline tests mean the recorded outcomes were reproduced. They are not evidence that the unsafe result is acceptable, that generic requests are correctly resolved, or that the F16 60-case release gate passed. Later matcher work updates these test expectations against independently authored admissible choices; this document preserves the released baseline.

## Results per chain

Each chain runs the same 16 shopping cases: four safe priced results, one forbidden priced result and eleven unresolved results. Across both chains: eight safe, two forbidden and twenty-two unresolved. Five unresolved cases per chain are name-boundary misses with a plausible candidate returned; the other six are empty search, unavailable stock, unknown pack, unknown price, incompatible unit and weighed-price exclusion. These are fixture counts, not estimates of retailer/AI quality.

| Request      | Returned synthetic example               | Released outcome                          | Boundary                                                                                    |
| ------------ | ---------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| Maito        | Kevytmaito 1 l                           | Unresolved                                | Generic word is inside a compound; confirmed plain-cow-milk policy admits it                |
| Leipä        | Ruisleipä 500 g                          | Unresolved                                | Compound name; rye/default policy still needs F15.5                                         |
| Kananmuna    | Kananmunat M10 630 g                     | Selected, correct 10-piece pack           | Existing inflection/count handling works                                                    |
| Jauheliha    | Beef, pork/beef and chicken mince        | Cheapest blend selected, chicken excluded | Existing variant exclusion; non-milk defaults remain F15.5 policy                           |
| Sipuli       | Keltasipuli 500 g                        | Unresolved                                | Prefix compound; initial onion boundary still needs F15.5                                   |
| Riisi        | Jasmiiniriisi 1 kg                       | Unresolved                                | Prefix compound; rice defaults still need F15.5                                             |
| Kerma        | Ruokakerma 2 dl                          | Unresolved                                | Prefix compound; cooking/whipping policy still needs F15.5                                  |
| Kahvi        | Plain coffee and instant-coffee compound | Plain coffee selected                     | Existing word relevance excludes instant compound                                           |
| Maito        | Maito and cheaper “Manteli maito”        | Almond example selected, forbidden        | Name-only matching accepts a separated plant descriptor; violates settled cow-milk boundary |
| Riisi        | No products                              | Unresolved                                | Search miss, not ranking miss                                                               |
| Kananmuna    | Known pack, unavailable                  | Unresolved                                | Stock failure                                                                               |
| Jauheliha    | Price known, pack label absent           | Unresolved                                | Pack size 0; existing F4.4 confirmation can repair it                                       |
| Kahvi        | Pack known, price absent                 | Unresolved                                | Price failure                                                                               |
| Maito (ml)   | Product pack in g                        | Unresolved                                | Incompatible units                                                                          |
| Sipuli       | Kilo price / approximate flags           | Unresolved/unpriced                       | F4 currently unsupported; do not count as a category fix                                    |
| Kahvi, 400 g | 500 g at €2 or 1 kg at €3                | €2 whole pack selected                    | Existing whole-pack cost beats lower unit price; preserve this                              |

The almond product wording is independently authored to exercise a separated descriptor. It is not a claim that a specific real store uses this name. The admissible IDs in non-milk examples are audit reference expectations, not owner-approved category defaults. F15.5 fixes those defaults before dependent behavior ships.

## Mechanisms and failure separation

`Service.price` in `src/application/service.ts` searches each requirement's full name once. For live provider IDs it filters available/known-price/compatible-unit/known-pack candidates through `relevant`; demo IDs skip name relevance. The audit deliberately registers real adapter IDs while keeping external calls mocked, so it exercises the live suitability path offline. Do not infer real-chain behavior from demo-ID-only fixtures.

`relevant` in `src/domain/planner.ts` requires a wanted word to begin a product word with a short inflection allowance. It protects against garlic/seasoning/ready-meal look-alikes and some poultry/plant variants. It also misses milk, bread, onion, rice and cream compounds. Globally loosening this rule would re-admit those protected look-alikes; use category boundaries with evidence instead.

`match` uses accepted/automatic IDs, stock, known price, positive pack/increment and exclusion terms, then whole-pack cost including deposits, surplus and stable ID tie-breaks. `requirements` merges equal IDs/units and retains source labels. `validateDraft` assigns shared ingredient IDs by normalized name/unit; it does not carry category, qualifiers or source provenance. Today's prompt asks for a meat type even for a generic note. A model-added “Naudan jauheliha” becomes an ordinary ingredient name with no recorded distinction from an explicit user request.

K-Ruoka's `search_products` schema uses `ean`, `name`, `price`, `priceUnit`, `priceIsApproximate`, `isAvailable`. `packFromName` parses one size label or an egg count class. Per-item/non-approximate prices become integer cents; weighed/unknown basis stays unpriced. Unknown metadata is not certified false or safe.

S-kaupat's pinned 1.3.0 schema uses `id`, `name`, `price`, `depositPrice`, `approximatePrice`, `priceBasis`, `packSize`, `quantityUnit`. Search has no stock; `check_basket` maps `ok` to true, unavailable/not-in-store/not-found to false and missing/other status to null. The adapter supports per-item/KPL/non-approximate prices. Neither adapter currently supplies normalized dietary/type attributes. A product name is not allergen certification.

Malformed numeric metadata fails adapter validation; a rejected search remains an error, not an empty array. These failures must stay distinct in F16 metrics. Unknown pack, stock, price and incompatible units must not be conflated with a safe but ambiguous ranking.

## Exact module handoff

- F15.7 creates `src/domain/categories.ts`: validated category IDs, qualifier evidence and provenance (`explicit-note`, `recipe-inferred`, `model-assumed`, `remembered`, `observed`). Extend ingredient/requirement/draft schemas in `src/domain/model.ts` / `src/ai/draft.ts` with backward-compatible defaults. Generic text and model assumptions never become explicit constraints merely through normalized names. Require source evidence for explicit claims; F16.15 later supplies validated intent/span mapping.
- F15.8 creates `src/stores/candidates.ts`: shared normalization/evidence helpers consumed by `KRuokaProvider.searchProducts` and `SKaupatProvider.searchProducts`. `Product` gains optional evidenced attributes without converting absent fields into false. Bound synonym expansion to misses with counted adapter requests. Preserve verified IDs, price/stock/units and current protected compound tests. Document supported upstream fields in `integrations.md`; do not invent attributes from model output.
- F15.2 creates `src/domain/matching.ts`: pure category suitability/reasons/ranking used by `Service.price` and existing planner quantity/cost helpers. Category rules replace category-specific name decisions, not the global safety filter. Preserve exclusions, explicit/remembered distinction, whole-pack cost and stable ordering. F15.5 owns unsettled non-milk defaults and hard/soft preference policy.
- F16.1 creates one evaluation schema/runner in `tests/fixtures/ai-shopping/` and `tests/ai-shopping.test.ts`, recorded in `docs/ai-evaluation.md`. Reuse this corpus as the initial released reference, then add independently authored note/category/quantity/forbidden/visible-unresolved expectations. Measure search vs ranking/normalization/stock/pack/price separately, plus request/search counts. Unsupported staged previews, edits and resolver remain unsupported, never passed. This audit is not a second evaluation system.

Keep fixture names and reason categories stable when the baseline expands. F15.2/F15.7/F15.8 must replace the actual application path with the settled contracts and update dependent cards after landing; these named new paths are assignments, not claims that the modules already exist.

## Current matcher comparison

F15.2 preserves this released audit and its original fixture labels. Current independently checked selections across both chains are 14 safe, zero forbidden and 18 unresolved, using 50 reads. Compound milk, bread, yellow onion and rice now resolve, and plain cow milk wins over the cheaper almond drink. Generic coffee labels lack a verified form and remain unresolved; generic cream still needs review. Current expectations are separate in `tests/matching-baseline.test.ts` and `tests/ai-shopping.test.ts`. See [matching-contract.md](matching-contract.md); these counts do not imply a passing release gate.
