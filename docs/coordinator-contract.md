# Read-only planning coordinator

F16.11 consumes the private ready result through `Service.commitPlanning({operationId})`. Atomic storage, restart validation, durable coverage and UI obligations are in [planning-persistence.md](planning-persistence.md).

F16.10 implements `coordinatePlanning(run, dependencies)` in `src/application/coordinator.ts`. It executes required-ledger interpretation, local requirements, bounded catalogue searches and optional resolution through one `PlanningRun`. Atomic commit/recovery remains F16.11; progress UI and composer migration remain F16.12.

## Entry and ownership

`planningRequestSchema` / `PlanningRequest` accepts only `{prompt, consent:true}`, with a trimmed nonempty note of at most 10,000 characters. `Service.planShopping(input, session, resolverEnabled = true)` starts the server-owned run. Its session callback must discover/select a model and return that run's `bindInference` session. `PlanningRun.inferenceSession()` verifies identity; another session cannot bypass operation caps. Main uses the existing saved model preference, provider discovery and cancellation path.

`app:planShopping` and preload `window.korikone.planShopping` return the normal Service snapshot. The renderer type requires `PlanningRequest`. Progress comes only from validated `app:planningChanged` events. The current composer still calls legacy `generate` and draft approval; F16.12 must explicitly switch it to this complete pipeline. The new endpoint requires consent and does not accept a renderer-supplied provider, resolver toggle, price or model override. F15.11 owns the persisted Advanced resolver switch.

The coordinator uses `interpretPlanning`, publishes its draft, then derives requirements from `run.validatedDraft()`. Its prospective AppState retains source revision, replaces the plan/note/extras and clears old quantities/removals/skips. It remains local. It does not install a quote, save AppState, read a retailer cart or write a retailer quantity. Cancellation, replacement and source changes abort bound work; late output cannot replace a newer result.

## Searches and coverage

Two workers process up to 100 active requirements from at most 500 inputs. Each `searchCandidates` actual read acquires `CandidateSearchOptions.beginRead` through `run.beginSearch(key)` and releases in `finally`, including synchronous provider errors, telemetry errors, cancellation and timeout. Existing deterministic aliases retain their three-query maximum and expand only after a miss. Stock readback performed inside a retailer adapter remains part of that adapter's search read. It does not imply a cart write.

The run allows 200 search reads and three per requirement. Exhaustion marks remaining rows and corresponding intents `bounded-out`; it never calls them empty search results. `coordinatorLimits.searchTimeoutMs` is 60,000 for the complete catalogue phase, separate from inference task timeouts. A cancelled/stale run remains terminal; a catalogue error fails as `search`, and the catalogue deadline fails as `timeout`. Both workers settle before ready or failure returns. Safe local rows and all identified requests receive validated progress while work proceeds.

## Optional resolution

Only unresolved domain lines enter `buildResolutionBatch`; clear rows, including previously accepted safe choices, skip it. One meaningful batch can use `resolveCandidates` on the same pinned session. Interpretation, at most one repair and at most one resolver share the three-call ceiling. Suggestions remain approval proposals; they do not change deterministic line selection or save an accepted choice.

Resolver output/provider failure records `unavailable` and a fixed `PlanningFailure`, while preserving safe deterministic rows and unresolved/review results. It never repairs a resolver response, switches provider/model or retries a native failure as text. Cancellation and source obsolescence remain terminal. `resolverEnabled:false` skips inference and keeps deterministic matching. F15.11 integrates the saved setting and suggestion presentation.

## Internal commit handoff

`PlanningResult` contains `operationId`, normalized `draft`, local prospective `state`, searched `lines`, all `requirements`, explicit `coverage`, complete `intents`, and `resolver:{status,failure,suggestions}`. Resolver status is `skipped`, `completed` or `unavailable`. Inputs omitted by budgets remain in requirements/coverage/intents even when no searched line exists.

Service privately retains the result. `Service.planningResult(operationId)` returns a clone only for the current ready operation; stale, failed, cancelled, replaced or committed IDs fail `planningStale`. The result is not a renderer-supplied commit payload. F16.11 must validate the current source again, preserve all unknown/bounded request coverage in persistence, advance revision/history, atomically save state plus quote and invalidate old approval. Startup has no coordinator result to resume because this card persists no provisional work.

Planning telemetry uses existing redacted numeric metrics: actual session calls/payload size, interpretation repairs, resolver attempts, actual searches and fixed unresolved reason counts. It stores no prompt, note, labels or account identifiers. Telemetry is the only coordinator-related storage write before commit.

## Verification

`tests/coordinator.test.ts` covers 18 focused cases through real draft/domain validation, Service and synthetic external retailer boundaries. They include both chains, mixed known/unknown requests, no resolver/one resolver, one interpretation repair with the maximum-three cap, invalid/unavailable resolver preserving a resolved milk row, empty/unknown-only requests, cancellation in discovery/interpretation/search/resolution, changed note/store, terminal search error, invalid interpretation, catalogue deadline, two concurrent workers with exactly 200 reads, complete frozen coverage and replacement with late output. Initial 16 cases had one S-kaupat assertion failure: its search legitimately performs read-only `check_basket`; that assertion was corrected. Failed/new/affected subsets passed, covering all 18 final cases.

`tests/ui/coordinator.spec.ts` passes two real Electron IPC cases, one per development inference adapter, with temporary profiles. They verify ready intent events, one discovery/generation path, saved plan/basket/review/journal preservation, blocked provisional transfer and cancellation. Catalogue/lifecycle regressions (`tests/candidates.test.ts`, `tests/planning.test.ts`): 59 passed. Type checking, renderer/main compilation, scoped formatting and diff checks passed. No live requests, account writes, package checks or release suite were run.
