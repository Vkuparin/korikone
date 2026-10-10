# Category and qualifier provenance

F15.7, 10 October 2026. `src/domain/categories.ts` defines the runtime contract. This card records request metadata; category suitability, preferences and retailer attributes remain F15.2/F15.3/F15.8. Non-milk defaults still require F15.5.

`ingredientSchema` in `src/domain/model.ts` has optional `classification`. Recipes, extras, staples, history and backups inherit it through the existing ingredient schema. Absence stays absence in old profiles. `Requirement` carries the same field. No migration guesses what an old ingredient meant.

`classificationSchema` has `category`, `provenance`, optional `evidence`, and `qualifiers` (at most eight). Categories are milk, bread, eggs, mince, onion, rice, cream and coffee. Each qualifier has `kind`, `value`, `provenance` and optional `evidence`. A category allows only its applicable kinds, with one value per kind.

| Kind    | Values                                 | Categories  |
| ------- | -------------------------------------- | ----------- |
| fat     | skimmed, semi-skimmed, whole           | milk        |
| lactose | free, low                              | milk, cream |
| meat    | beef, pork, beef-pork, chicken, turkey | mince       |
| grain   | rye, wheat, wholegrain                 | bread       |
| onion   | yellow, red, shallot, spring           | onion       |
| rice    | white, brown, jasmine, basmati         | rice        |
| cream   | cooking, whipping                      | cream       |
| coffee  | ground, beans, instant                 | coffee      |

These describe requested distinctions. They do not assert that a product meets them or define which default the owner wants. Allergen certification is outside this name-based contract.

Provenance values are `explicit-note`, `recipe-inferred`, `model-assumed`, `remembered` and `observed`. Category provenance and qualifier provenance are separate: a generic requested category does not make a model-added meat or lactose choice explicit.

An explicit claim requires `sourceEvidenceSchema`: `start`, `end` and `quote`. Offsets use JavaScript UTF-16 indexing into the submitted note, not bytes or Unicode code points. The quote is at most 500 characters; `end - start` must equal its length. `validateDraft(raw, state, source = state.note)` checks the actual source slice. Main dispatch supplies the submitted prompt rather than the previously saved note. Other provenance must omit these note spans.

`validateAIClassification` rejects model claims of remembered rules or retailer observations, invalid source slices, unsupported qualifier phrases and negated quoted spans. Recipe ingredients cannot claim explicit-note provenance merely because their dish appeared in the note. The supported phrase checks are conservative local guards, not a proof that an arbitrary note was fully understood. F16.15 must bind extracted intentions and spans to requested rows and measure omissions against independent expectations. Unsupported language needs review rather than a fabricated constraint.

If output omits classification, `inferredClassification(name, provenance)` supplies recognized hints as model-assumed for direct groceries or recipe-inferred for recipe ingredients. Thus “Naudan jauheliha” inferred from a generic request records an assumed beef qualifier. The prompt now tells the model to keep generic groceries generic. Hints never become explicit constraints. Category recognition alone does not authorize a candidate; protected garlic, seasoning and ready-meal rules still belong to suitability checks.

`classificationKey` excludes evidence offsets but includes category and qualifier values/provenance. `validateDraft` reuses ingredient identities only for matching names, units and classification keys; conflicting metadata gets a distinct ID. `requirements` preserves the field and rejects incompatible classifications sharing a manually supplied ID instead of dropping one. Existing unannotated aggregation stays unchanged.

## Dependent contracts

- F15.8 landed `retailerEvidence`, `candidateQueries` and `searchCandidates` in `src/stores/candidates.ts`, with `Product.evidence` / `Product.cataloguePricing` schemas in `src/domain/product-evidence.ts`. Attributes use retailer-name evidence, not request provenance or model claims. Missing remains unknown. Exact source fields, bounds and fixtures are in [candidate contract](candidate-contract.md).
- F15.2 consumes `Requirement.classification` in `src/domain/matching.ts`. Explicit qualifiers constrain selection only after source validation. Model assumptions remain distinguishable and cannot silently override the request. Current name relevance is still used until that card lands.
- F15.3 stores explicit Remember rules separately from ingredients; `remembered` describes their application, not consent. No memory is written by F15.7. F15.5 supplies hard/soft policy.
- F16.1 measures generic and explicit requests independently with the fixtures in `tests/categories.test.ts` as examples. An assumed beef qualifier is not evidence that the note requested beef.
- F16.5 includes these typed distinctions in compact context and keeps note evidence scoped to the operation. Never relabel stored assumptions as explicit claims.
- F16.15 adds intent IDs and validated coverage links through this source boundary. It must not claim that matching quotes establish complete interpretation.

Focused fixtures cover generic/model-specific/explicit mince, generic/assumed/explicit lactose-free milk, invalid source/provenance/value combinations, recipe inference, legacy profiles, and service save/restart/backup. The released audit remains historical in `matching-baseline.md`; its provenance regression now expects this fix. No live account requests are required.
