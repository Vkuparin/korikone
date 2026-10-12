# Current-row corrections

F15.14 implements the service and IPC contract. F15.15's `RowCorrection` supplies inline correction controls on Shopping rows; ordinary alternative review remains in F15.12's `RowDetails`.

`src/domain/corrections.ts` exports `correctRowSchema`, `CorrectRow`, `correctionReasonSchema`, `correctionHoldsSchema`, `correctionKey` and `clearRowCorrections`. Main/preload expose `correctRow`; `Service.correctRow(input)` returns the ordinary snapshot through the existing IPC reply envelope.

Every input binds the displayed `revision` and `requirementKey` (`id:unit`). A quantity correction is `{revision, requirementKey, reason:"wrong-quantity", amount}`; amount is a positive integer up to 10,000,000 in the row's existing unit. Type and alternative corrections use `{revision, requirementKey, reason:"wrong-product-type"|"unsuitable-alternative", replacementProductId, remember?}`. The replacement is an existing retained candidate ID, or null to leave the row unresolved. No free-text reason or unit change is accepted. `remember` is the existing strict `CategoryPreference` rule, including explicit Required/Preferred strength, and requires a replacement ID.

## Validation and persistence

Corrections require a current retained quote, an unchanged list revision and no pending planning/transfer operation. Stale or missing rows and unknown candidate IDs are rejected without changing state. Replacement validation uses the shared matcher, household constraints, current-note qualifiers and portable rules. A known unavailable or unsuitable retained replacement leaves the row on an explicit hold; it never chooses another candidate automatically. A rejected candidate already pruned from the retained list is treated as an unknown replacement. A null replacement can explicitly hold that row instead.

`AppState.correctionHolds` contains bounded, unique context/row keys; `correctionChoices` records keys of one-time accepted correction choices. Both default empty for old profiles and backups. Generic save cannot change these arrays; the existing explicit backup import may restore them. These are local current-list bookkeeping, not portable remembered rules or diagnostic data.

`MatchingOptions.holds` makes an affected match unresolved with reason `owner-correction`, null product/total and zero packs. Service pricing and `restoredQuote` use the same hold array; `pricingKey` binds nonempty holds and correction choices. Explicit `accept` or Remember can release a held row through the existing evidence validation. A new list, approved draft or fresh coordinator operation clears holds and one-time correction choices, including a fresh operation with the same note. Explicit category memory remains. Ordinary note replacement also clears correction bookkeeping. Opening a view or restarting does not clear it.

The corrected row is rematched from retained candidates without new catalogue reads or inference. Unrelated rows keep their retained facts and choices, and the quote's original observation time is retained. An explicit Remember action reuses `rememberedCategoryChange`, the same evidence checks as `rememberCategoryPreference`; it may also rematch other rows in the affected category. Rows in other categories remain unchanged. One-time, quantity and unresolved corrections do not create rules.

State and recomputed quote persist together through `Storage.setMany`. Successful persistence increments the list revision, invalidates the old approval/comparison and binds the new quote. A failed write that leaves old storage intact leaves the old state and quote intact. A lost reply with confirmed new readback is treated as saved. An unreadable or mixed outcome yields `commitUnknown` and blocks transfer until restart. Correction never invokes retailer writes, checkout, AI or external reporting.

## Local counts and UI handoff

F16.6's `operationMetricSchema` accepts kind `correction` and an optional bounded `corrections` reason-count map. Valid attempts record only the three fixed reason codes and counters/outcome/latency. The map has the existing integer count bounds; arbitrary reason strings and extra text fail schema validation. No notes, names, row/store/product IDs, candidate facts or remembered qualifiers enter diagnostic metrics.

F15.15 should show the entry on resolved and unresolved rows, retain the displayed revision/key, then choose one of the three reasons. Quantity uses the existing row unit. Replacement uses the existing retained alternatives; a missing suitable replacement can submit null and show the unresolved result. Remember requires an explicit rule/strength choice and explanation, then supplies `remember` in the same correction action. Cancel/dismiss invokes no action. Handle `draftStale` by reloading instead of resubmitting; handle `commitUnknown` through the existing restart-required safety message. No new wizard or AI request is needed. F15.12 can continue using the existing Use once/Remember methods for ordinary alternative review.

Focused evidence: `tests/corrections.test.ts` covers both real retailer adapters at deterministic synthetic boundaries, each reason, missing/stale/malformed inputs, unavailable/refused replacements, local redaction, one-time versus remembered choices, restart and atomic-write outcomes. `tests/ui/corrections.spec.ts` exercises real IPC, approval invalidation, SQLite restart, visible unresolved state and new-list clearing in a temporary development profile. `tests/coordinator.test.ts` verifies fresh same-note planning does not retain correction choices or holds. No live account or AI allowance is used.

## Inline controls (F15.15)

“Tarkoitin jotain muuta” / “I meant something else” is available beside resolved and unresolved quoted rows without opening Advanced. It opens one inline form and captures the row, retained candidates and displayed revision. The user explicitly chooses Wrong product type, Wrong quantity or Unsuitable alternative. Quantity accepts a positive whole amount in the existing row unit. Replacement lists only retained candidates and includes an explicit no-suitable-product option that submits null. An unsuitable replacement leaves a hold through the service; the UI never chooses another product automatically.

Remember is unchecked by default. It appears only for an evidence-supported, selectable portable rule and shows the exact attributes plus Required/Preferred meaning when checked. Save submits the memory choice with the same correction; a quantity or unresolved correction creates no rule. Cancel or Escape invokes no action and restores the opener's focus. Stale submissions reload current rows while keeping the error; the draft is disabled until cancelled and reopened. Successful saves restore focus after the busy state ends.

`tests/ui/row-corrections.spec.ts` exercises the real form and `correctRow` IPC in Finnish and English: resolved-row entry, keyboard/cancel, each reason, invalid quantities, explicit unresolved replacement, once versus remembered type, approval invalidation, unchanged unrelated rows/quote time, stale rejection and SQLite restart. Fixture counters verify no additional catalogue or AI requests from correction actions and no retailer writes. Narrow form geometry and captures cover readable controls without horizontal overflow.

## Use once from the retained quote (B2.8)

`accept({ ingredientId, productId })` is the "Use once" choice in a row's details. The product must be one of the candidates read for that row at the current store and must still pass `selectableCandidate` with the current exclusions and preferences; otherwise it fails with `unresolved` and nothing changes.

Audit, on a ten-row development list with 20 ms per store search (`tests/use-once.test.ts`, development PC, 13 October 2026):

| One choice | Store searches | AI requests | Store writes | Time |
| --- | --- | --- | --- | --- |
| Before | 13 | 0 | 0 | 404 ms |
| After | 0 | 0 | 0 | under 260 ms asserted; no store wait remains |

The cause was that saving the choice changed the pricing key, and `refreshAfterChange` then priced the whole list again. With a quote on screen the choice now changes only its own row: the row is matched again from its own retained candidates with the chosen product accepted, every other row keeps its line and reading time, the result is verified with `restoredQuote`, and the list and quote are saved together. The list revision goes up by one, a prepared review and a comparison are dropped, and no preference is saved: remembering stays a separate, explicit action.

Unchanged: the price shown is the one read with the quote, and current prices are still checked before anything is sent to the store. Without a quote, or with a storage that cannot write the list and quote together, the earlier path is used. `busy`, `planningPending`, `storageFailed` and `draftStale` (a row that is no longer on the list, or a row that fails verification) leave the list as it was.

The existing desktop test `tests/ui/details.spec.ts` chooses an alternative with the keyboard and checks that the panel closes, focus returns to the row, the choice is saved and the catalogue, AI and store-write counters did not move.
