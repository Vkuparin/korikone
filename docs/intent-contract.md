# Request intents and planning results

F16.15 defines identified request coverage in `src/domain/intents.ts`. It does not prove that a model understood every request in an arbitrary note. Independent note expectations remain necessary, as shown in `tests/intents.test.ts`.

## Interpretation

`shoppingPlanTask` in `src/ai/tasks.ts` is `shopping-plan` v1. Both existing adapters advertise it through `inferenceTasks`. `interpretPlanning(session, note, state)` in `src/ai/output.ts` uses the pinned session, compact context, real draft validation and at most one repair. It requires a ledger; it never falls back to the legacy ledger-optional `interpretShopping`. Native output uses `shoppingPlanningWireSchema` / `shoppingPlanningNativeOutput`, schema name `shopping_plan_v1`. Every wire field is required. Meaningful intent nulls survive normalization in both native and text paths. Provider, incomplete, cancellation and unsupported-capability errors retain the shared terminal behavior.

`validatePlanningDraft` in `src/ai/draft.ts` requires nonempty `intents`. An unresolved-only draft can have no recipes, meals or items. Legacy `validateDraft` accepts drafts without a ledger for existing composer/import compatibility, but validates a ledger whenever one is supplied. The complete composer migration remains F16.10.

`requestIntentSchema` / `RequestIntent` fields are `id`, `kind` (`meal` or `grocery`), `label`, `evidence: {start,end,quote}`, `provenance: explicit-note`, `quantity`, nullable `mealIndex` / `itemIndex`, and nullable `unresolvedReason`. Evidence uses exact UTF-16 note offsets and cannot split a surrogate pair. Labels equal their quotes, spans do not overlap, and model IDs are unique. Validation replaces temporary IDs with stable `intent-start-end` IDs.

Each represented meal or direct item has exactly one intent targeting its zero-based position. A meal has null quantity and item index. A grocery has quantity `{amount,unit,provenance}`, with canonical `g`, `ml` or `pcs`, and a null meal index. Target indexes survive recipe ID normalization because validation projects them onto the normalized draft. Every new recipe has a meal reference. Invalid, duplicate or extra targets fail validation.

Literal supported numeric units prove direct grocery quantities. `noteQuantity` converts kg/l into g/ml; `noteUnspecifiedCount` preserves a literal number when no supported unit is given. Neither helper infers a package weight. Unknown quantity retains null amount/unit with unknown provenance; a known count with unknown unit retains its amount and explicit-note provenance. Fractional canonical quantities stay in the ledger with `unsupported-quantity`, rather than being rounded into an ingredient. Other unresolved codes are `unsupported-request`, `ambiguous-request` and `excluded-request`. Unresolved requests have no meal/item target and cannot fabricate a purchasable item.

The initial bounds are 100 intents and 100 requirement keys per intent. Unsupported larger output fails validation; it is not silently truncated.

## Mapping and previews

`projectIntentMappings(intents, normalizedDraft, savedRecipes)` returns strict `IntentMapping` values: `intent`, nullable `recipeId` and `requirementKeys`. Keys are `ingredientId:unit`. Shared recipe ingredients may map to multiple intents, while domain `requirements` performs aggregation once. Leftover meals have no shopping requirements. Unresolved interpretation intents have no recipe or requirement keys.

`pendingIntentResults` initializes previews. `mapIntentResults(mappings, requirements, lines, {complete?,boundedOut?})` returns `IntentResult` with status `pending`, `resolved`, `approval-required` or `unresolved`, and nullable fixed `reason`. Empty catalogue results become `empty-search`; other unmatched results become `no-match`. Missing requirements/results and budget omissions become `missing-requirement`, `missing-result` or `bounded-out`. Duplicate mappings/rows and altered requirement quantity/name/classification fail. This mapper consumes domain-owned matched lines; it does not validate retailer facts or authorize a transfer itself.

`PlanningSnapshot.intents` is required. `PlanningRun.publishDraft`, `setRequirements`, `publishRow`, `boundOutRequirement` and `ready` maintain it. Terminal failure/cancel/obsolete events clear it together with previews. Original unresolved requests remain present through ready even with zero requirement keys. Provisional intent results never write AppState, quotes, review, journal or a retailer basket.

The coordinator must derive requirements from `run.validatedDraft()` after `publishDraft`, rather than the earlier task artifact. Revalidation can normalize conflicting ingredient IDs again. It must use that same owned artifact for the prospective plan, mapping and eventual commit. `Service.price(context, localState)` is an existing read-only pricing seam exposed for fixture coverage; the coordinator must additionally bind every actual search to the run's read slots, signal and operation bounds.

## Fixtures and dependent work

`tests/intents.test.ts` has nine independent-note cases covering mixed requests, shared ingredients, normalized IDs, invalid references/evidence, unknown-only drafts, missing/empty/bounded results, omitted interpretation requests and immutable planning previews. `tests/ai-intents.test.ts` has eight cases covering native/text equivalence, required nested schemas, repair caps, invented quantities, and real Service/catalogue paths through both development inference adapters and both retailer adapters. `src/ai/planning-fixtures.ts` supplies finite synthetic replies without fallback meals or default grocery quantities. No live account requests or retailer writes are needed.

F16.10 calls `interpretPlanning` and preserves all intent mappings across searches and optional resolution. F16.11 defines atomic persistence and recovery, including how unresolved request coverage survives a committed partial plan. No persisted intent field or backup migration is introduced by this card. F16.12 renders the validated intent results, including requests without rows; F16.13 tests their cancellation/partial/failure behavior. F16.18 verifies the completed pipeline across both adapters. These fixtures establish the ledger contract, not completed pipeline or release acceptance.
