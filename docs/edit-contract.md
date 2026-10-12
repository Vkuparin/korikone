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

## Edit interpretation (F17.3)

`src/ai/edit.ts` adds the `shopping-edit` v1 task (`shoppingEditTask` in `src/ai/tasks.ts`, part of `inferenceTasks`, so the ChatGPT adapter and the development alternative both advertise it over their existing text path). Task code owns the prompt, schema, validation and repair; nothing in it imports ChatGPT, authentication or transport.

- `editRequestSchema`: `{ instruction, focusTargetId? }`. The instruction is trimmed, 1–2000 characters. `focusTargetId` is the **target-context field** for F17.9: the `row:<key>` or `meal:<id>` the shopper opened the composer from. It is a hint for words such as "this", never a restriction, and a focus that is no longer on the list is dropped.
- `buildEditContext(request, state, now)` returns `{ context, known }`. The context holds language, household servings and exclusions, `focus`, rows (`target`, name, amount, unit, sources, `atHome`), meals (`target`, name, `recipeId`, servings, leftovers), saved recipes by ID/name/servings (those on the list plus up to 12 the instruction names) and the instruction. It contains no note, receipt, store, product, price, account or cooking text. Over 200 rows, 100 meals, 12 extra recipes or 24,000 characters is `contextTooLarge`.
- `interpretEdit(session, request, state, now)` returns a validated `EditIntent`. `validateEditIntent` accepts only targets from `known`, each at most once, of the kind its operation needs, and only the fields that operation uses. A new replacement recipe goes through the recipe-import validator (`validateRecipe`), so IDs are remapped and ingredient identities shared. An invented, altered or repeated target, a stray field such as a product ID or price, an unsupported command or malformed JSON is `invalidDraft`.
- Native output name `shopping_edit_v1` (`editWireSchema`, every field required and nullable); text output may omit unused fields. Both validate to the same intent.

**Operation cap.** One edit makes at most two AI requests: the interpretation and one repair after `invalidDraft` (`editTaskLimits.aiCalls`). It makes no resolver request. Usage limit, provider failure, incomplete output, an unsupported task and cancellation are terminal with one request. Task bounds are 20,000 output characters and 60 seconds. Catalogue reads are bounded by the existing three queries per changed requirement.

In development mode `FixtureAI` answers this task with `editFixtureReply` (`src/ai/edit-fixtures.ts`), a finite rule-based interpreter of the supplied edit data. Supported phrasings, split on commas, full stops, `ja`/`and`/`sekä`:

| Instruction part | Result |
| --- | --- |
| `lisää 1 l maitoa`, `add 500 g coffee`, `lisää 2 tölkkiä maitoa` | `addItem` on the named row, or by name when no row matches; pack words (`tölkki`, `purkki`, `pakkaus`, `paketti`, `pussi`, carton/pack/package/bag/jar) give a pack count |
| `poista paahtoleipä`, `remove this` | `removeItem` |
| `vaihda pasta nakkikeittoon`, `replace pasta with sausage soup`, `vaihda keitto lasagneen` | `replaceMeal` with a saved recipe when one matches, else a fixture recipe |
| `tuplaa keitto`, `double the soup`, `pasta 8 hengelle`, `soup 6 people` | `changeServings` |
| `kaksi maitotölkkiä`, `2 kg perunaa` | `changeQuantity` |
| `porkkana löytyy kotoa`, `we already have potatoes`, `porkkanaa ei löydy kotoa` | `markAtHome` true or false |

A part naming several rows or meals returns an ambiguity unless the focus is one of them; `tämä`/`se`/`this`/`it` mean the focus. Anything else, including a missing quantity, is `unsupported`. The existing scenarios `invalidOnce`, `invalidDraft`, `usageLimit`, `incompleteDraft`, `aiFailed`, `delayedSuccess` and `pendingSuccess` apply to edits unchanged.

Fixtures: `tests/ai-edit.test.ts` runs each case against both adapters: Finnish and English multi-part edits, ambiguity and focus, invented/altered/misused targets and retailer facts (one repair, then failure at two requests), usage limit, incomplete output, provider failure, cancellation, an unsupported task, context privacy and text/native parity.

## Applying an edit (F17.4)

IPC `editList({ revision, instruction, focusTargetId?, consent: true })` calls `Service.editList` (`src/application/service.ts`; request schema `editListRequestSchema` in `src/application/edits.ts`). It uses the saved model choice through the same session selection as recipe import, and `cancelAI` cancels it.

1. A wrong revision, a list with no targets (`nothingToEdit`), a running planning operation (`planningPending`) or a pending transfer (`busy`) is rejected before any AI request.
2. The instruction is interpreted against a snapshot. If the list revision changed meanwhile, the result is discarded as `draftStale`.
3. `applyEditIntent` runs with pack sizes taken from the current quote: only rows whose selected product has an exact, positive pack of the row's unit. A clarification is returned in the snapshot and nothing else changes.
4. Only requirement keys in `changedKeys` are read from the catalogue again. Every other row keeps its quoted line, candidates and reading time, and the whole quote is then re-verified against the edited plan (`restoredQuote`). If a retained row no longer verifies, every row is read again. Removed and at-home rows need no read.
5. State, quote, undo snapshot and observed prices are written in one `setMany`. A failed write leaves all four as they were; a lost acknowledgement is detected by reading back and is not retried.

**Timestamps.** `quotedAt` stays at the earlier time whenever any row is retained, because the quote is only as fresh as its oldest row. Rows read during the edit carry their own `observedAt`. A quote in which every row was read gets the new time.

**Approval.** Success advances the revision by one and clears the prepared review, comparison and transfer exception, so an approval given for the earlier batch fails as `draftStale`. An edit never calls a retailer cart. The shopper's product choices, corrections and category memory are untouched.

Snapshot fields: `edit` and `editUndoAvailable`. `edit` is `null` or an `EditStatus` for the current revision only:

- `{ status: "applied" | "undone", revision, applied, delta }`
- `{ status: "clarification", revision, ambiguities: [{ phrase, candidates: [{ targetId, name, detail }] }], unsupported: string[] }`, where `detail` is `"<amount> <unit>"` for a row and the servings for a meal.

Errors reach the renderer as codes: the `EditError` codes above, `draftStale`, `nothingToEdit`, `planningPending`, `busy`, `contextTooLarge`, `invalidDraft`, and the existing AI codes (`usageLimit`, `incompleteDraft`, `aiCancelled`, `notConnected`, `modelUnavailable`, `aiFailed`). Metrics record kind `edit` with AI, repair and search counts.

## Undo (F17.5)

A successful edit saves one document, `edit-undo` (`development:edit-undo` in development mode; `editUndoSchema`), outside `AppState`, backups and diagnostics: the revision the edit produced, the plan fields an edit can change (`recipes`, `meals`, `extras`, `skipped`, `removed`, `quantities`, `requestIntents`), the earlier quote, the applied operations and the delta.

`undoEdit({ revision })` is available only while the list is still at that revision (`editUndoAvailable`). It restores those fields as a new revision, clears the review and comparison, and deletes the snapshot. The earlier quote returns with its original time if it still verifies against the restored plan; otherwise the list is shown unpriced until the shopper refreshes prices. Undo makes no AI, catalogue or retailer call and reverses nothing already transferred: a verified transfer record stays, and the restored list is a different batch that needs its own approval.

- A second edit replaces the snapshot, so undo goes back one edit only.
- A failed, cancelled or clarified edit leaves the earlier snapshot in place.
- A new list, a reused week, a planning commit, a store change, a product choice or any other list change advances the revision and ends the undo. Language, appearance, model and calendar changes do not.
- After a restart the snapshot is offered again if the revision still matches, with its `applied` and `delta` restored into `snapshot.edit`.
- Otherwise `undoEdit` fails with `undoUnavailable`, or `draftStale` for a wrong revision.

## Edit delta (F17.10)

`src/domain/edit-delta.ts` exports `editDelta(before, after, now)`, `currentEditDelta(delta, revision)`, `editDeltaSchema` and the `EditDelta`, `EditDeltaRow`, `EditPrice` and `EditSide` types. A side is `{ state, basket, quoted }`: a plan with the basket quoted for exactly that plan, or `quoted: false`. The function reads only those inputs. It compares one edit or undo step; it is not F7's comparison with the last verified transfer (`src/domain/changes.ts`).

| Field | Meaning |
| --- | --- |
| `fromRevision`, `toRevision` | The step described. `currentEditDelta` returns null for any other revision, so a delta is never shown beside a later plan. |
| `meals[]` | `mealId`, `change` (`replaced` or `servings`), `name`, `to` (replacement name or null), `servingsBefore`, `servingsAfter`. |
| `rows[]` | One entry per shopping row whose bought amount changed: `key`, `name`, `unit`, `change` (`added`, `removed`, `quantity`, `atHome`, `notAtHome`), `before`, `after` (amount, or null when not bought on that side), `priceBefore`, `priceAfter`, `productChanged`. |
| `retained[]` | `key` and `name` of rows bought on both sides with the same amount. |
| `price` | `status`, `difference` and `unknownRows`. |

A shared ingredient is one row with its combined amounts; the delta never splits it into per-meal product events. `EditPrice.kind` is `known` (exact pack arithmetic), `estimated` (a weighed or per-piece estimate), `unknown` (the quote has the row without a usable product or price), `stale` (that side has no quote for its plan) or `none` (not bought on that side, counted as 0). `total`, `productId` and `packs` are null unless known or estimated.

`price.status` is `exact` when every changed row is known or none on both sides, `estimated` when some are estimates, `incomplete` when any changed row is unknown or stale, and `incomparable` when the two sides are different stores or fulfilment. `difference` (after minus before over the changed rows, in cents) is a number only for `exact` and `estimated`. Retained rows are excluded because their quoted lines are identical on both sides. `productChanged` marks a row priced on both sides with different products, where the difference is not like for like.

Fixtures in `tests/edit-delta.test.ts`: shared ingredients with an unpriced added row, at-home/removal/restore/add with an exact difference, a quantity change that needs no more packs (exact zero), estimates and a changed product, an unquoted side and another store, undo as the reversed comparison, and revision binding. `tests/service-edits.test.ts` and `tests/ui/edit-api.spec.ts` cover the delta on a real partial requote, a failed and stale edit, restart and undo.

## B1 local operations

Added in the v0.9.0 bugfix round. None of them makes an AI, catalogue or retailer call.

Operations in `src/domain/edits.ts`:

- `addMeal { recipe: { kind: "saved", recipeId } | { kind: "new", recipe }, servings? }` adds a dish. A dish already on the list is not added twice, and a new recipe with a saved recipe's name resolves to the saved one.
- `setItem { name, quantity }` sets a stated amount: an existing row gets that quantity, otherwise the item is added. An unchanged amount is a no-op and is not reported.
- `removeMeal { mealId }` removes the dish, its week-plan references and its request mapping. The recipe stays saved.

A plain enumeration such as "lihamakaronilaatikko, kaksi litraa kevytmaitoa" on a current list becomes `addMeal` / `changeQuantity` / `setItem`; "lisää" keeps meaning `addItem`. An empty list can be edited.

Service operations (`src/application/service.ts`), all revision-bound, written atomically with one undo snapshot, and all voiding a prepared approval:

- `editLocally({ revision, operations })` accepts only `removeItem`, `removeMeal`, `changeServings`, `changeQuantity` and `markAtHome`. Unchanged rows keep their quoted line; changed rows are matched again from the products already read; a row with nothing read stays unpriced (`matching.reason = "bounded-out"`).
- `clearList({ revision })` empties meals, extras, note, assumptions, row choices and the week plan and sets `recurringPaused`. Recipes, history, purchases, settings, preferences and recurring definitions stay. Recurring items add nothing while `recurringPaused` is true; `updatePrices` (the explicit price update) and every new list clear the flag.
- `previewHouseholdSize({ servings })` and `setHouseholdSize({ revision, servings })`. Meals planned for the old household size follow the new one; meals with another number of servings, row quantities set by the shopper, extras and recipes are kept.
- `undoEdit` restores all of these. The undo document's optional `also` holds the fields outside the plan that the change touched (`note`, `assumptions`, `recurringPaused`, `calendar`, `household.servings`). `snapshot.edit.status` is `applied`, `cleared`, `resized` or `undone`.

Related: `snapshot.pricingState` is `empty`, `unpriced`, `quoted` or `failed`. Choosing or connecting a store on a list that was never priced does not search; a priced list follows its store. `setReceiptText({ text, base })` saves the receipt text only when `base` is still the saved text, otherwise it throws `receiptTextStale`.

Errors: `draftStale`, `busy`, `storageFailed`, `unknownTarget`, `undoUnavailable`. Fixtures: `tests/local-edits.test.ts`, `tests/clear-list.test.ts`, `tests/household-size.test.ts`, `tests/edit-enumeration.test.ts`, `tests/first-search.test.ts`, `tests/receipt-text.test.ts`, `tests/ui/clear-resize-api.spec.ts`, `tests/ui/local-removal.spec.ts`.

## Row specification (B2.3)

`specifyItem { rowKey, name }` says what an existing row should be: a product, brand or type name. It is the edit a bare name means when a row is selected (`focusTargetId` is a `row:` target and the instruction has no verb and no amount). It never creates a recipe, a meal or a new grocery.

- State: `AppState.specifications` maps a requirement key to the shopper's wording (1 to 200 characters, default `{}`). It is part of the edit undo snapshot and of the pricing key, and is cleared by every new list and by Clear list. Recipes, extras and recurring definitions keep their own names.
- `requirements(state)` returns the row with `name` set to the wording and `specifiedFrom` set to the row's own name. Amount, unit, ID and sources are unchanged. The classification inferred for the old name is dropped; the category is read again from the new wording.
- Naming the row's own name removes the wording. Naming what the row already is changes nothing and is not reported.
- The edited row is always searched again, inside the existing three-query limit (`changedKeys` includes it even though its amount did not change). Other rows keep their quoted lines. `editLocally` refuses the operation because it needs a catalogue read.
- Matching (`src/domain/matching.ts`, `src/domain/planner.ts`): a product carrying every word of the wording is preferred over other eligible products. A product carrying every word the shopper added but not the generic noun (`matchesSpecifiedQualifiers`) is `approval-required` with reason `name`: it is offered as an alternative and never chosen silently. Household exclusions, unit, stock and pack checks apply unchanged, so an excluded brand leaves the row unresolved instead of falling back to another brand.
- Interpreter (`src/ai/edit.ts`): wire shape `{"op":"specifyItem","target":"row:…","name":"…"}`. A missing, blank or non-row target is invalid output and follows the existing one-repair rule. One AI request per instruction, as for any edit. The development fixture puts the row's grocery after a single unknown word, so "Knorr" on a Lihaliemikuutio row becomes "Knorr Lihaliemikuutio".
- Result: `snapshot.edit.applied` holds `{ op: "specifyItem", targetId, name: <previous row name>, to: <wording>, unit }`.

Fixtures: `tests/row-specification.test.ts` (both real adapters on synthetic catalogues: the three playtest inputs, brand only, excluded brand, invalid output, cancellation, stale revision, restart, undo) and the real-IPC case in `tests/ui/edit-api.spec.ts`.
