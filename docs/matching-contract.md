# Shared category matching

F15.2 implements the owner-accepted [category policy](category-policy.md) with finite retailer facts. The shared matcher runs for both chains and development providers. It makes no AI requests and writes no retailer data. Portable preference persistence remains F15.3; resolver requests remain F15.9/F15.10.

## Public API

`src/domain/matching.ts` exports:

- `categoryPreferenceSchema` / `CategoryPreference`: strict `{category, qualifiers:[{kind,value}], strength:"required"|"preferred"}`. At least one unique, category-applicable qualifier is required. Eggs currently have none. This is the rule schema for F15.3; it contains no IDs, text, spans or inferred memory.
- `matchingPolicy(requirement, options)` / `MatchingPolicy`: category, required constraints with their source, preferred qualifiers, conflict/unsupported flags and `defaulted`. Explicit-note and recipe-inferred qualifiers constrain selection. Model assumptions do not. An unannotated legacy name retains recognized specificity without being relabelled as explicit-note.
- `candidateSuitability(requirement, product, options)` / `CandidateDecision`: `eligible`, `approval-required` or `rejected`, with a fixed reason code. An unknown or conflicting required qualifier is rejected. Missing default type evidence, generic cream, poultry mince, red onions and other permitted coffee forms need approval when no request/rule supplies their type.
- `purchasable(requirement, product)`: known available stock, compatible quantity unit, positive finite pack/increment, valid nonnegative integer-cent price/deposit and bounded whole-pack cost.
- `selectableCandidate(requirement, product, options)`: purchasable and eligible, or approval-required with an explicitly accepted product ID. Rejected products cannot be accepted.
- `matchRequirement(requirement, products, options)`: at most 60 distinct candidates. Filter hard conflicts, apply explicit accepted choices or suitable brand preference, then rank by total cost for enough whole packs, surplus and stable ID. Returns the existing `BasketLine` with an optional typed `matching` summary.
- `matchingSummarySchema` / `MatchingSummary`, `matchingReasonSchema` / `MatchingReason`: category, `resolved`/`approval-required`/`unresolved`, reason, `defaulted` and bounded candidate decisions. Fixed reasons cover identity/evidence/category/family, qualifier conflicts or unknowns, household exclusions, unsupported dietary certainty, preference misses, default review and stock/price/pack/unit/name failures.

`MatchingOptions` accepts one applicable `preference`, existing `productPreference`, normalized `exclusions`, store-specific `accepted` IDs, `context` and optional `sourceNote`. A provided note rechecks explicit UTF-16 evidence through `validateAIClassification`; application ingestion already validates task output. The matcher never changes the supplied rule, requirement, product evidence or application state.

Required remembered fields fill unspecified fields. A validated explicit current-note qualifier overrides the corresponding remembered field for this operation. Conflicting recipe/legacy specificity and a Required saved field stay unresolved. Preferred misses need approval. Household exclusions stay mandatory. Supported lactose exclusion requires a positive lactose-free label; the finite facts cannot certify arbitrary allergen exclusions. Literal household exclusions also filter names.

## Evidence and application paths

`src/domain/food-names.ts` exports `foodNameFacts` without request provenance. `retailerEvidence` in `src/stores/candidates.ts` wraps it with the exact retailer quote and validates the existing F15.8 schema. Known look-alikes and prepared foods cannot enter a generic category. Condensed milk and seasoned rice are excluded. Unknown fields stay unknown; arbitrary labels do not certify diets. Foods outside the initial categories retain the conservative `planner.relevant` check; that global filter is unchanged.

`Service.price` uses `selectableCandidate` as `searchCandidates.isHit`, retaining the F15.8 maximum-three reads and F16.6 actual search counters. `Service.accept` reassesses the actual quoted candidate before saving a one-time SKU choice. Hard-rejected candidates are absent from row alternatives. Shopping/confirmation cheaper suggestions use the same eligibility and whole-pack cost, including deposits and increments. Detailed reason wording, grouped review and Remember controls remain their assigned Simple cards.

`BasketLine.matching` is persisted through `src/application/quotes.ts`. `pricingKey` binds matching version 1 and requirement classification, invalidating pre-contract quotes and changed constraints. AppState and backups still contain no quote objects. Restored rows retain summaries without catalogue calls.

`createReview`, `transfer` and `resumeReview` in `src/application/transfer.ts` perform bounded alias reads for the quoted ID. They retain existing price/unit/pack/stock checks and compare category, family and qualifier facts. A changed type fails with `priceChanged` before a write even if price and ID are unchanged. Optional final `MatchingOptions` lets callers supply current household exclusions; Service does so. Transport cancellation is reported as `cancelled`.

## Fixtures and dependent work

`tests/matching.test.ts` independently covers all eight defaults, forbidden cheap look-alikes, approval alternatives, explicit/recipe/assumed provenance, Required/Preferred precedence, exclusions, missing facts, unsafe arithmetic, brands, cost and changed-type transfer. Both real retailer adapters feed real Service approval and quote restart through `tests/fixtures/ai-shopping/environment.ts`. `tests/ui/candidate-search.spec.ts` exercises real IPC: alias miss, unspecified onion type, hidden garlic, explicit choice and restart with zero AI requests. `tests/ui/matching-helpers.ts` explicitly approves the observed generic onion label in transfer fixtures; it does not claim the label proves yellow onion.

F15.3 should add an empty-by-default, unique-category array of at most eight `CategoryPreference` rules, supply the applicable rule in Service matching/acceptance and quote bindings, and define explicit Remember/Edit/Forget/Reset APIs before UI handoff. F15.9 should consume bounded decisions and filter rejected candidates before constructing resolver requests; a resolver cannot change hard constraints or manufacture missing facts. F15.12 should render these summary/reason codes and separate one-time SKU acceptance from the eventual explicit memory API. F16.9 should use the same pure matcher and `selectableCandidate` while retaining operation-owned search and inference bounds.

The immutable released baseline remains in `docs/matching-baseline.md`. Current execution against those same labels yields 14 safe, zero forbidden and 18 unresolved rows across both chains, with 50 search reads. Unknown coffee forms now remain unresolved. The synthetic clear corpus now names ground coffee, dry rice, yellow onions and beef mince explicitly in catalogue responses; its independent note/quantity/admissible-ID expectations are unchanged. The 60-case release gate still fails on missing assigned capabilities and a deliberately unknown quantity. This card does not establish release readiness.
