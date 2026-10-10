# Offline shopping evaluation

F16.1, 10 October 2026. Run `npm test -- tests/ai-shopping.test.ts`. This harness measures controlled fixture responses, not live model accuracy. It uses no ChatGPT allowance, retailer account or private receipt.

`tests/fixtures/ai-shopping/schema.ts` exports `shoppingCaseSchema`, `expectedRequestSchema`, `ShoppingCase`, `ExpectedRequest`, `EvaluationResult` and `UnresolvedReason`. Expectations are authored from the note before model replies. Never create expected categories, omissions or quantities by reading the model response. The released F15.1 corpus remains the initial reference in `matching-baseline.ts`; `cases.ts` imports it rather than maintaining a second audit.

Each case declares a stable ID, source note, independent grocery/dish expectations, one or two canned interpretation responses and a synthetic catalogue keyed by search phrase (or `*`). Grocery expectations give acceptable name aliases, category, quantity/unit and admissible/forbidden product IDs. A category of `null` explicitly expects no classification in the eight-category matcher taxonomy (for example, potatoes or yoghurt); an invented category still fails. Grocery category, amount and unit expectations remain required. Dish expectations give acceptable recipe names. Request IDs and grocery aliases cannot overlap. Admissible and forbidden IDs cannot conflict. Unknown category/default policy is stated separately; audit reference choices are not owner-approved non-milk defaults.

`evaluateShoppingCase(case, chain)` in `runner.ts` invokes a test-only provider through the actual pinned `InferenceSession` and `interpretShopping` in `src/ai/output.ts`. This is the same task output selection, bounded repair and domain validation used by main. It approves the resulting draft through the real `Service.approveDraft`, persists it with the normal state schema and builds the basket through the real retailer adapter and matcher. `environment.ts` supplies deterministic tool responses and records calls; it observes normalized adapter results without changing their contents. The F15.1 tests share this external boundary. No IPC handler is replaced. Electron/Settings/task-adapter compatibility checks remain their assigned cards.

One fixture interpretation may use one existing schema repair, capped at two calls here. Incomplete inference output is terminal. Search errors and malformed response schemas stay separate from empty search. Unexpected application exceptions fail the test instead of becoming evaluation failures. The full planning coordinator later owns the maximum-three operation cap, including the optional resolver.

## Measurements

`EvaluationResult` records missing request IDs, wrong categories, wrong quantities, request IDs with unsuitable SKU selections, safe priced rows, unresolved reasons, AI requests, search calls and retailer writes. Coverage is checked against independent expected aliases and actual persisted requirements/meals. A failed catalogue read does not make a materialized grocery an interpretation omission. An internally valid response that omitted eggs still fails the independent eggs expectation.

Unresolved reasons distinguish empty search, search error, normalization, stock, pack, price, unit, suitability and ranking; failed interpretations use invalid-output/incomplete, and absent requests use missing-request. Reasons inspect the observed normalized adapter output, including candidates removed by the matcher. They are evaluator diagnostics; application row-reason UI is F15.12. They do not claim to identify every possible preference/exclusion conflict before those modules land.

Quantity means the requested domain amount and unit, not excess whole-pack contents. SKU expectations exercise whole-pack cost ranking separately. Exact alias matching keeps the reference independent of model-added category labels; aliases for newly supported foods must be reviewed from the source note. This is a deterministic fixture measure and cannot prove complete understanding of arbitrary text.

`evaluationSummary(results)` aggregates these fields. `evaluationGate(results, minimumCases = 60)` requires enough distinct cases, both chains for each case, zero unsuitable selections, zero omissions/category/quantity errors, zero retailer writes, at most three AI requests per execution and no unsupported required capability. Passing unit tests that reproduce a failing baseline do not pass this gate. A gate failure is data, never rewritten as an expected safe result.

## Reproduced reference

The released source baseline is v0.6.0/main `5494654`, as recorded in `matching-baseline.md`. Current F15.7 provenance work changes metadata, not matching decisions. Sixteen reference cases on each chain yield:

| Metric                                                          | Both chains            |
| --------------------------------------------------------------- | ---------------------- |
| Executions / requested groceries                                | 32 / 32                |
| Safe priced rows                                                | 8                      |
| Unsuitable selections                                           | 2                      |
| Unresolved rows                                                 | 22                     |
| Missing requests / wrong categories / wrong quantities          | 0 / 0 / 0              |
| Interpretation requests / searches / retailer writes            | 32 / 32 / 0            |
| Suitability / empty search / stock / pack / price / unit misses | 10 / 2 / 2 / 2 / 4 / 2 |

The gate fails: only 16 distinct cases, two forbidden plant-drink selections and required weighed pricing unsupported. F15.2 must eliminate forbidden fixture selections before improved coverage can count as acceptable. Numerical improvement targets follow this baseline and the expanded owner-approved corpus; this card does not invent a live accuracy target.

Additional harness checks detect omitted eggs, wrong milk quantity, a wrong category label, a missing dish, invalid output/one repair, incomplete output/no repair, malformed normalization and search errors on both chains. Their small synthetic examples validate measurement behavior and do not count as the promised 60 independent shopping cases.

## Capability and dependent handoff

The current runner explicitly reports required weighed pricing, provisional previews, AI edits, resolver, visible unsearchable requests, cancellation, stale runs, store changes and preferences as unsupported. F16.5 supports compact context through bounded `contextSetup` and records `contextCharacters` / `maxContextCharacters`; see [compact context](ai-context.md). `editCorrectness` is `unsupported`; no edit is credited as passed. Add a capability adapter with its real validation/service path and focused tests before removing that marker. Unsupported required capabilities fail the gate.

- F16.2 adds 20 independently authored multi-dish cases in `tests/fixtures/ai-shopping/multidish.ts`, exporting `multiDishCases: ShoppingCase[]`, and runs them through `evaluateShoppingCase` on both chains. Reference expectations include every requested dish and grocery, including ready/breakfast/snack requests. Keep canned responses separate from expectations.
- F16.3 adds 20 cases in `context.ts`, exporting `contextCases: ShoppingCase[]`. Extend the schema/runner with bounded household/preference/compact-context setup only after F15/F16.5 contracts land. Unsupported policy/context behavior stays explicitly required and unsupported.
- F16.4 adds 20 cases in `failures.ts`, exporting `failureCases: ShoppingCase[]`. Reuse `boundaryFailure`, completion and catalogue controls. Add real lifecycle/controller setup for cancellation/stale/store-change after F16.9/F16.10; never fake success by only changing fixture expected values.
- F16.5 uses these independent coverage and quantity expectations for compact-context payload tests; it must define bounded state setup in this same runner rather than a second evaluation harness.
- F16.6 records only bounded aggregate outcome/reason/count fields locally, with no notes, product names, canned replies or account details in diagnostics. The evaluator itself persists no corpus/report in the application profile.
- F16.13 runs the completed 60-case matrix once through this runner and records source/commit/check evidence. Passing fixture tests and passing release gate are distinct. F17.7 later adds edit cases through the same schema and runner.

F16.17/F16.18 verify actual app task adapters separately; the test-only scripted provider here is not evidence of migrated main dispatch or alternative-provider production compatibility.

## F16.2 clear shopping corpus

`multidish.ts` exports 20 distinct FI/EN shopping notes and separate canned task outputs. Independent expectations cover clear groceries, morphology, litre/kilogram conversion, ready pizza, breakfast and snack groups, cooked dishes, two meals sharing onion under different model IDs, and a combined cooked/ready/breakfast/snack request. Dish expectations check every requested group; grocery expectations check additive quantities and allowed product identities through both real adapters and the Service. These controlled recipes state their ingredient amounts in the note, so the fixture does not invent recipe-quality expectations.

Run `npm test -- tests/ai-shopping-multidish.test.ts`. Forty both-chain executions require complete safe pricing, no category/quantity/coverage error, one interpretation, no resolver and zero retailer writes. Negative checks independently remove yoghurt from an otherwise priced meal and add an invented category to yoghurt. Neither is credited as successful coverage. This corpus does not claim live interpretation accuracy or the completed 60-case release gate; ambiguity/failures, preferences and planning lifecycle remain their assigned cards.
## F16.3 exclusion and ambiguity corpus

`context.ts` exports 20 independently specified FI/EN cases for generic/default boundaries, explicit milk fat/lactose, rye, meat and coffee-form requests, compound names, whole-pack cost, incompatible units, named exclusions and unknown dietary evidence. Source-backed qualifiers carry exact note spans and pass the real task validator. The runner measures both chains through real persisted household context, adapters and Service. `dietary-evidence` remains an explicitly unsupported required capability: a product name or absent ingredient metadata cannot certify lactose/gluten safety. No remembered-preference behavior is credited before F15.3 lands.

Run `npm test -- tests/ai-shopping-context.test.ts`. The two checks validate 40 executions and the forbidden-SKU measurement independently of unresolved counts. The initial pre-matcher baseline recorded 28 safe priced rows, 10 forbidden selections and 2 incompatible-unit unresolved rows; coverage/category/quantity errors and retailer writes were zero, with 40 interpretation requests and searches. Maximum compact context was 229 characters. The gate fails on forbidden selections and unsupported dietary evidence. Passing measurement tests do not mean the matching release gate passed. F15.2/F15.8 must improve actual candidate handling; preserve independent admissible/forbidden expectations when measuring their changes.
## F16.4 failure corpus and 60-case baseline

`failures.ts` exports 20 cases covering unavailable stock, empty/error search, malformed retailer responses, unknown prices/packs, weighed products, incomplete/invalid interpretation and required lifecycle/preview/unknown-quantity behavior. Required cancellation, stale-run, store-change and preview cases currently perform ordinary task/service evaluation and explicitly fail the unsupported-capability gate; they do not claim to execute those missing coordinator paths. Integrate real operation controls after F16.9–F16.11 land. Unknown requested amount is represented by `expected.amount: null`; an invented numeric amount fails quantity coverage rather than becoming an expected default.

`npm test -- tests/ai-shopping-failures.test.ts --silent=false` passed two measurement checks. The combined 60 distinct cases ran on both chains: 120 executions, 216 requested groceries/dishes, 138 safe priced rows, 32 unresolved results, 10 forbidden selections, 4 missing requests and 2 wrong quantities. There were no category errors or retailer writes; 122 interpretation requests and 176 searches were recorded, with maximum context size 541 characters. Gate failures are forbidden-selection, missing-request, wrong-quantity and unsupported-required-capability. The missing requests include terminal incomplete/invalid interpretations; no saved result is fabricated to hide them.

Unsupported requirements are dietary-evidence, weighed-pricing, cancellation, stale-run, store-change, preview, unknown-quantity and visible-unsearchable-request. A passing fixture test establishes these measurements, not v0.7.0 acceptance. F16.13/F16.14 must exercise the completed coordinator and visible intent mapping through this same corpus, preserve independently authored expectations and record the improved report. Edit behavior remains explicitly unsupported for F17.7. No live provider or retailer account was used.