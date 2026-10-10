# Committing a shopping plan

F16.11 implements `Service.commitPlanning({operationId})` and real main/preload `commitPlanning` IPC. The UUID must name the current ready operation. The renderer cannot supply replacement state, lines or prices. Service validates its private coordinator result, complete requirements and quote, then advances the saved revision once. Cancelled, stale, incomplete and forged requests fail before storage changes.

## Atomic storage and recovery

`Database.setMany` sends one worker request. The SQLite worker validates and serializes the entire batch before `BEGIN IMMEDIATE`, writes unique document keys and commits once. Errors roll back. Planning requires this capability and never falls back to sequential writes. Development storage forwards the entire batch under the `development:` namespace.

The transaction contains `state`, `last-quote` and observed price history. The quote includes the operation UUID and binds the new state through `pricingKey`. Only after persistence succeeds does Service install state/basket/quote, clear the previous review and publish `committed`. A commit lock prevents cancellation or replacement while storage is pending; queued appearance edits preserve the new plan. Ready previews disappear on restart.

If acknowledgement fails, Service reads back the three documents once. An exact new triple confirms success without another write. An exact old triple confirms rollback and preserves the previous plan/review. Unreadable or mixed results raise `commitUnknown` and block state changes, planning and transfer until restart. The interface asks the owner to restart and check the saved plan. Commit and recovery perform no retailer writes.

Startup validates state and quote together. Quote restoration recomputes selected products, packs and costs from retained candidates and current matching rules. Altered choices or totals reject the quote. Bounded-out rows require no candidates/product, zero packs and null total, retaining their explicit reason. Retained explanations for rejected, pruned candidates grant no selection authority.

## Durable request coverage

`AppState.requestIntents` stores up to 100 `IntentMapping` values and defaults empty for old profiles. `validStoredIntents` checks exact source spans, stable IDs, nonoverlapping quotes and literal quantity evidence. Backups preserve the ledger and reject invalid evidence. Ordinary `saveState` cannot replace it independently. `Service.validateSaveInput` clears it when the note changes, before state validation; quantity edits preserve the original evidence.

`Service.snapshot().committedIntents` derives results from the ledger, requirements and saved quote. `planningIncomplete` remains true while any result needs resolution or approval. Explicit owner removal or at-home choices settle their requirement keys through `mapIntentResults`'s `settledKeys`, without erasing separate unknown requests. Requirements beyond search bounds persist with explicit unresolved rows. Unknown quantities never become invented purchasable items.

Shopping displays requests without rows and labels known prices as a subtotal. Strict preparation rejects unresolved requests. Partial preparation retains them in `Review.unresolvedIntents`, requires confirmation and carries labels through journal recovery. The transfer button opens that review rather than silently writing a partial basket. Diagnostics exclude request text.

## Dependent implementation

F16.12 migrates the composer to `planShopping({prompt,consent:true})`, validated events and `commitPlanning({operationId})` for the still-current ready operation. Handle commit locking and `commitUnknown`; show intent results without requirement rows. The composer still uses its earlier generation/approval path.

F15.11 adds the saved resolver switch/proposal presentation while preserving request coverage. F16.13 extends progress/cancellation UI checks. F16.18 extends both-adapter pipeline acceptance using real atomic storage. Reuse `tests/planning-persistence.test.ts` and `tests/ui/planning-commit.spec.ts` without replacing IPC handlers.

## Verification

All 14 persistence cases were covered by the initial run and focused new/affected reruns: rollback, lost/unreadable acknowledgements, restart, backups, stale/cancelled/forged commits, commit ownership, old profiles, note/quantity edits, owner omissions, quote tampering, development isolation, price history, redaction and 200 requirements with explicit bounded coverage. Fixtures performed zero retailer writes.

Affected lifecycle/service/development/preferences/quote checks initially passed 72 of 73 cases; the quote restoration failure was fixed and its focused rerun passed. Intent/coordinator checks passed 27 cases; earlier quote/intent checks passed 10. Two real Electron IPC cases passed through both development inference adapters, including commit/reload/restart, subtotal and partial review with zero writes. The initial missing development atomic-storage capability was fixed before those passing runs. Type checking, renderer/main compilation, scoped formatting and diff checks passed. No live account, package or full release checks ran.
