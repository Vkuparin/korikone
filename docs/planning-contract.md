# Planning lifecycle and ownership

F16.11 implements atomic commit and durable coverage in [planning-persistence.md](planning-persistence.md). `PlanningLifecycle.currentReady` checks ownership; `PlanningRun.beginCommit` locks cancellation/replacement until `committed` or `commitFailed`. Service owns the storage transaction.

F16.9 implements `src/application/planning.ts`. This is the operation/event contract and the existing interpretation dispatch migration. F16.15 adds required `PlanningSnapshot.intents` and draft-to-result mapping; its fields, quantity rules and normalized artifact ownership are in [intent-contract.md](intent-contract.md). F16.10 supplies execution across interpretation, requirements, searches and resolution; F16.11 supplies atomic state/quote persistence. The composer submits `planShopping` followed by UUID-bound `commitPlanning`; saved state and quote remain visible until atomic commit.

F16.10 implements that execution in `src/application/coordinator.ts` and the real `planShopping` IPC entry. Exact read-slot ownership, deadline, failure behavior, complete frozen result and commit/UI handoff are in [coordinator-contract.md](coordinator-contract.md). The composer displays validated phases and exposes UUID-bound Cancel before commit.

## Ownership

`PlanningLifecycle` belongs to Service and reads its current AppState. `start(note)` creates a server UUID and an immutable source snapshot. A replacement start obsoletes and aborts the previous run. `snapshot`, `invalidateFor(state)`, `invalidate`, `cancel` and operation-bound `control` manage current ownership. A cancellation naming an old UUID raises `planningStale` and cannot cancel a newer run.

`PlanningRun` pins the source revision, submitted note, store/fulfillment, saved model preference and relevant interpretation/matching inputs. The submitted note remains separate from the saved note until commit. Note, store, model, recipe, household, preference, accepted-choice, pack or quantity changes obsolete the run. Appearance and calendar-only changes preserve it. Source checks run before every publication and phase change; late output cannot revive an obsolete/cancelled operation. Main also invalidates a changed saved source before its queued mutation, so a running request does not delay cancellation.

`bindInference(provider, model)` creates one operation-owned `InferenceSession`, with a maximum of three calls and pinned capabilities/identity. It can run once in discovery. Interpretation and one repair share the cap with at most one resolver attempt. Catalogue discovery is separate. `sourceState()` and `validatedDraft()` return clones; internal saved snapshots never become inference payloads. Task builders still use the compact-context contract.

`InferenceTaskBounds` adds a fifth optional argument to `InferenceSession.invoke`; task output/timeout bounds can only narrow the session bounds. `TaskOutput.bounds` forwards it through `invokeTaskOutput`. The resolver exports `resolutionTaskBounds`: 8,000 output characters and 60 seconds, clamped to any smaller session limits. The operation session retains 100,000 output characters and a 180-second invocation timeout. These are invocation timeouts; the coordinator must own any overall search deadline. No transport/auth data enters this module.

## Events and previews

`planningSnapshotSchema` / `PlanningSnapshot` are strict, validated snapshots with operation UUID, increasing sequence, source, selected provider/model identity, phase, provisional meal/row summaries, coverage, numeric counters, fixed failure and committed revision. `transferEligible` is always literal false: event data never authorizes a retailer write. Phase values are `discovering`, `interpreting`, `interpreted`, `searching`, `resolving`, `ready`, `committing`, `committed`, `failed`, `cancelled` and `obsolete`.

`publishDraft` reuses real domain draft validation, including recipe references and source evidence. It publishes meal summaries without recipe cooking instructions. `setRequirements` validates quantities/units and unique requirement keys. `publishRow` requires the original bound requirement and reruns `matchRequirement` against supplied catalogue candidates. It recomputes chosen product, packs and total; an incoming line's claimed choice/cost is ignored. A resolver recommendation remains optional approval under the separate resolution contract.

Events contain bounded requirement name/amount/unit, category/provenance, fixed matching status/reason, selected product ID/name and domain cost. They omit raw retailer candidate arrays, arbitrary labels, receipts, cooking instructions and provider error bodies. Returned events are immutable clones. Provider text/usage deltas are not planning events. Actual call counters update the sequence when observed; publication failures cannot allow a transfer.

The schema requires consistent terminal/commit fields, unique coverage/row keys and valid resolved/unresolved row shapes. Terminal failure, cancellation and obsolescence clear previews/coverage. Callback delivery errors cannot change ownership. Events are at most 200,000 UTF-16 characters; invalid/oversized payloads fail validation rather than being truncated or treated as completed coverage.

## Search and partial coverage

`planningLimits` allows 500 input requirements, 100 active rows, 200 total external search reads, three reads per requirement, two simultaneous reads and 60 candidates per requirement through the shared matcher. `beginSearch(key)` acquires/counts one actual external read immediately before dispatch and returns an idempotent release function. The coordinator must release in `finally`, schedule at most two reads and use existing bounded aliases. It must not call `beginSearch` once per requirement while hiding additional alias reads.

Every supplied requirement gets coverage: `pending`, `searched` or `bounded-out`. Inputs beyond the active-row cap remain in coverage. `boundOutRequirement(key)` records an unsearched pending row when the overall read budget is exhausted; it never reports an empty catalogue result. `resolving` and `ready` refuse pending coverage or outstanding read slots. Ready can contain honest unresolved/approval-required rows. F16.15 adds request-intent coverage for requests that interpretation cannot represent; this requirement coverage alone cannot certify interpretation completeness.

## Commit and IPC

`beginCommit(nextState)` requires ready/current ownership and a validated next revision, unchanged store/model and the submitted note. It stages the exact expected saved state. `committed()` succeeds only when current state equals it; a mismatching write obsoletes the run. These methods perform no storage writes and do not establish atomicity. F16.11 must coordinate the state and quote write before publishing committed status. A committed event still cannot replace normal quote/review validation.

`Service.snapshot().planning` exposes the latest snapshot or null. `Service.assertNoProvisionalTransfer` blocks `prepare`, `transferDisplayed` and `execute` while a nonterminal planning operation exists, including before the main IPC queue. Provisional rows are separate from `Service.basket`, AppState, review and journal. Existing saved quotes remain visible while work runs. Cancellation restores eligibility through normal quote validation; it does not install previews as quotes.

Preload exposes `onPlanningChange(callback)` with an unsubscribe function, receiving `app:planningChanged`, plus `cancelPlanning` and `invalidatePlanning`. `planningControlSchema` / `PlanningControl` require the current operation UUID; optional invalidation reasons are `note-changed`, `store-changed` and `source-changed`. Main accepts these only from the existing trusted main renderer frame and handles them outside the queue. `PlanningIPC` names the typed control/subscription contract. The composer uses the operation UUID to invalidate an edited in-flight note, including an edit before the discovery event arrives.

Current main generation publishes discovery/interpretation/validated-draft phases and uses its operation source snapshot. Source obsolescence returns `draftStale`; explicit cancellation keeps `aiCancelled`. The complete pipeline and its visual progress controls remain their assigned cards.

## Verification and dependent work

`tests/planning.test.ts` covers 15 deterministic cases: validated events, invalid references/deltas, source changes, appearance/calendar preservation, replacement ownership, concurrency/read caps, bounded coverage, staged commit identity, terminal failure, smaller task limits and both real retailer adapters with Service. Provisional products cannot become saved quotes or reach review/transfer. `tests/ui/planning.spec.ts` exercises both development inference adapters through real Electron IPC, event sequencing, stale cancellation, note invalidation and zero retailer writes. The existing composer obsolescence test also passes. Related Service/quote fixtures (36) and shared provider/output/resolver fixtures (42) pass. No live accounts or release suites are used.

F16.10 must consume this run, its shared session, phase methods, read slots and complete coverage; it must not instantiate another resolver session or dispatch raw IPC progress. F16.11 owns the staged-state/quote atomic write. F16.12 consumes validated snapshots and operation-bound controls, keeping provisional rows visually separate from transfer approval. F16.15 extends typed events with independently checked request intents and unresolved mappings. F16.18 should extend both-adapter coverage across that completed pipeline, rather than treating lifecycle-only fixtures as pipeline acceptance.

## Default proposals from vague notes (B2.13)

A vague note should still give a list the shopper can inspect and send. Three things changed; nothing is saved as a preference and no product is accepted on the shopper's behalf.

**Sides.** A dish named alone is planned as a simple complete meal. The planner puts an ordinary side into that dish's own recipe ingredients and reports it in the planning reply as `sides: [{ mealIndex, name }]` (`shoppingPlanningWireSchema` in `src/ai/output.ts`, `draftSchema.sides` in `src/ai/draft.ts`). `validateDraft` stores the name on the new recipe as `Recipe.assumedSide` (`recipeSchema`, optional, 1 to 100 characters). A side is never a separate meal and has no request intent. The reply is refused with `DraftError` reason `assumed-side` (one repair, as for any draft error) when a side names no meal, repeats on one meal, names a dish the note asks for itself (`namesSameFood` against the other intents' labels and recipe names), or the note declines a side (`noSideRequested`: ilman lisuketta, ei lisuketta, pelkkä, sellaisenaan, without a side, no side, on its own, just the). A side for a saved recipe is ignored: the shopper's own recipe is used as it is.

**Assumed amounts.** A grocery named without an amount gets one ordinary purchase. Its request intent carries `quantity: { amount, unit, provenance: "assumed" }` (`intentQuantitySchema` in `src/domain/intents.ts`) and targets an item of exactly that amount. `assumed` is refused when the quoted words state a number (`intent-quantity`) and when the grocery is not on the list. `unknown-quantity` stays valid for a request the planner cannot size.

**Generic names.** The planning prompt asks for plain generic ingredient names with no brand, variety or qualifier the shopper did not write. Selection is unchanged: the existing matcher, bounded query expansion and optional resolver decide, so explicit conflicts, exclusions, unavailable products and unknown pack facts behave as before. Resolver recommendations still need the shopper's approval; they are not applied automatically.

**Published for the UI (B2.14).** `snapshot.proposal` is derived from the saved list:

- `sides: [{ mealId, recipeId, dish, side }]` for current meals whose recipe has `assumedSide`.
- `quantities: [{ requirementKey, label, amount, unit }]` for request intents with an assumed amount whose row is still on the list. `label` is the shopper's own words.

The side's ingredients are ordinary recipe rows, so removing or changing them uses the existing row edits. The assumed amount is an ordinary row amount and changes with `changeQuantity`.

Two matcher corrections found by these fixtures: a three-letter ingredient word allows one ending letter only, so "Voi" no longer matches "voida" inside another product name; and possessive apostrophes are ignored, so "Lover's" equals "Lovers".

Development fixtures: `mealFixtures` in `src/ai/meal-fixtures.ts` gains Uunimakkara and Poronkäristys with an optional mashed-potato `side`, and Perunamuusi as its own dish. `planningFixtureReply` adds the side unless the note names it or declines one, and gives known groceries one ordinary purchase when the note has no amount. Coffee is deliberately left without one and stays the scripted `unknown-quantity` example. The demo store sells the new ingredients.

Tests: `tests/vague-proposals.test.ts` runs interpretation to committed quote on both real adapters with synthetic catalogues: "Uunimakkaraa" alone, "Uunimakkaraa, perunamuusia, poronkäristystä", plain groceries, a declined side, an excluded product, a saved required milk type, an empty store, the resolver switch, cancellation and the draft refusals. One interpretation call per note, at most three reads per row, no retailer write. `tests/ui/vague-proposal.spec.ts` drives the real composer in development mode and checks the proposal after a restart.
