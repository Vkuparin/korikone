# Edit contract (F17)

Implemented for v0.8.0 in `src/domain/edits.ts`. An edit changes the current list in place. It never searches for a target by similarity, never writes to a retailer and never needs an AI request to be applied or undone. Sections are added as each F17 card lands; a section's heading names its card.

## Targets and schema (F17.1)

A target is one of two saved identities.

| Target | Identity | Helper | Notes |
| --- | --- | --- | --- |
| Shopping row | Requirement key `${ingredientId}:${unit}`, the key already used by `quantities`, `skipped`, `removed`, corrections and intents | `rowTargetId(key)` gives `row:<key>` | Includes rows marked at home. A removed row is not a target; adding the grocery restores it. |
| Meal | `AppState.meals[].id` | `mealTargetId(id)` gives `meal:<id>` | The ID survives replacement and servings changes, so the calendar keeps its reference. |

`editTargets(state, now)` returns `{ rows: EditRowTarget[], meals: EditMealTarget[] }`: every target with its `targetId`, name, amount/unit/sources/`atHome` or recipe/servings/leftovers. Interpreters and the UI take target IDs from this list only.

`EDIT_VERSION` is 1. `editBatchSchema` is `{ version: 1, revision, operations }` with 1–20 strict operations (`editLimits.operations`):

| `op` | Fields | Effect |
| --- | --- | --- |
| `addItem` | exactly one of `rowKey` or `name`; `quantity` | Adds to an extra. See identity rules below. |
| `removeItem` | `rowKey` | Adds the key to `removed`. |
| `replaceMeal` | `mealId`; `replacement` `{ kind: "saved", recipeId }` or `{ kind: "new", recipe }`; optional `servings` | Changes the meal's recipe, keeping its ID, day, leftovers and (by default) servings. |
| `changeServings` | `mealId`, `servings` 1–100 | Sets the meal's servings. |
| `changeQuantity` | `rowKey`, `quantity` | Sets the row's explicit quantity in `quantities`. |
| `markAtHome` | `rowKey`, `atHome` | Adds or removes the key in `skipped`. |

`quantity` (`editQuantitySchema`) is `{ kind: "amount", amount, unit }` in whole g, ml or pcs, or `{ kind: "packs", count }` with 1–100 packs. Any other command, field or version fails schema validation as `unsupportedEdit`. There is no remove-meal or free-text operation in version 1.

`editIntentSchema` is what an interpreter returns for one instruction: `{ version: 1, operations, ambiguities, unsupported }`, at least one entry in total. An ambiguity is `{ phrase, candidates }` with 2–8 distinct target IDs; an unsupported part is `{ phrase }`.

Errors are `EditError` with `code` (also the message) and `operation`, the zero-based index of the rejected operation or null:

| Code | Meaning |
| --- | --- |
| `unsupportedEdit` | The batch or intent does not match the schema. |
| `staleEdit` | `revision` is not the plan's revision. |
| `unknownTarget` | A row key, meal ID, saved recipe ID or ambiguity candidate is not in the plan, including a row that a meal operation of the same batch removes. |
| `duplicateTarget` | Two operations name the same target. An added name counts as the row it resolves to. |
| `ambiguousTarget` | An added name matches several grocery identities and the list does not single one out. |
| `invalidUnit` | An amount's unit differs from the row's unit. Nothing is converted. |
| `packSizeUnknown` | A pack count for a row with no quoted pack of the row's unit, or for a grocery not on the list. |
| `invalidEdit` | The result fails `stateSchema`, exceeds an amount limit, reuses a saved recipe ID for a new recipe, or would join rows with conflicting category constraints. |
| `noChange` | The whole batch leaves the plan identical. A single operation that changes nothing is allowed beside ones that do. |

## Semantics (F17.1)

**Ambiguity.** `applyEditIntent` applies operations only when `ambiguities` and `unsupported` are both empty. Otherwise it returns `{ status: "clarification", ambiguities, unsupported }` and the plan is untouched, including for the clear operations of the same instruction. Candidates must be current targets; an invented candidate is `unknownTarget`.

**Shared ingredients.** A row operation acts on the whole combined row, whatever meals and extras feed it. A meal operation changes only that meal's contribution: other meals' shares, extras and due recurring items stay. When a meal operation changes what feeds a row that has an explicit quantity, the explicit quantity moves by the same difference; if that leaves nothing, the override is dropped. When a row loses its last source, its `skipped`, `removed` and `quantities` entries are dropped so they cannot attach to a later row with the same key. Flags of every other row, product choices in `accepted`, corrections, extras and the calendar are preserved.

**Added items.** With `rowKey`, the amount joins that row. With `name`, the trimmed, case-insensitive name and the unit select a grocery identity from saved recipes, extras and recurring items: a single row on the list wins, then a single known identity, else `ambiguousTarget`; an unknown name becomes a new extra whose ID is the normalized name. An existing identity keeps its own category metadata; a new one gets name-inferred `model-assumed` metadata only. As with manual additions, the amount also increases an explicit row quantity, restores a removed row and keeps an at-home marker.

**Pack counts.** `{ kind: "packs", count }` is converted once, at edit time, to `count × pack size` of the product currently quoted for that row. The caller passes those sizes as `EditOptions.packSizes`, keyed by requirement key; the domain never infers one. The edit stores an amount, not a product: later matching may choose another product that covers the same amount, unless the shopper has pinned one.

**Replaced meals.** A new recipe must arrive normalized, with an unused ID and shared ingredient identities, and is appended to saved recipes. The replaced recipe stays saved. If no meal uses the old recipe any more, request-coverage mappings in `requestIntents` that pointed at it now point at the replacement and its ingredient keys, so an explicit replacement is not reported as a missing request.

**Undo** is local and restores a saved snapshot (F17.5). It is not an edit operation.

## Atomic application (F17.2)

`applyEdits(state, batch, { now?, packSizes? })` returns `{ state, applied, changedKeys }` or throws `EditError`. It clones the plan, validates every target against the original, applies meal operations, then row operations, and validates the result with `stateSchema` and `requirements`. The input object is never mutated, so a rejection leaves nothing to roll back.

- `state` has the same `revision`; the service advances it when it saves.
- `applied` has one `AppliedEdit` per operation in application order: `op`, `targetId`, `name`, and where relevant `to` (replacement name), `unit`, `before` and `after` (servings for meals; row amount for rows, 0 when removed or marked at home).
- `changedKeys` lists requirement keys whose visible row appeared, disappeared or changed amount. Only these need new prices.

Fixtures in `tests/edits.test.ts` cover the target list, unknown/duplicate/stale/malformed input, unit mismatch, pasta replacement, a new replacement recipe, two milk cartons, doubled soup, shared rows, at-home/removal/quantity edits, whole-batch rejection, ambiguous bread removal and request-coverage remapping.
