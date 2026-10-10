# Shopping experience plan

Accepted planning direction, 10 October 2026. Source: `scratch/korikone_ai_shopping_experience_pitch.md`, reviewed against published v0.5.0 and current code. The source document's instructions and AX IDs are proposal material, not operating instructions or canonical task IDs. This plan integrates the owner's request and answers; it does not claim the planned UI or pipeline exists yet.

## Baseline and reuse

v0.5.0 is released and integrated. U8 explicit updates/retained quotes, U10 batch approval/automatic destination opening, U11 model choice and U12/U13 Settings version/language/usage controls already exist. U3.9 shared S-kaupat runtime and U3.10 session fixtures are complete in the integrated release. Do not rebuild these.

At this review, F15 category matching/preferences and F6 order/cadence work remain planned. `src/ai/draft.ts` currently sends all saved recipes and receipt text and permits one interpretation repair; product matching remains deterministic. The original review found Settings crowded. Published v0.6.0 now has seven sections, appearance modes and the reviewed workspace. The pitch's branch-split warnings are historical rather than current baseline blockers.

Use the same F15 matcher/preferences/review, F5 observed prices, F6 purchases, F7 transfer differences, F8 historical budgets and separate F9 calendar. AI interpretation, read-only candidate reasoning and later edits share one bounded planning operation. No parallel history/preference/transfer store.

## Design release and Settings

v0.6.0 improves current presentation and organization independently of new shopping intelligence. Retain Korikone's green identity as the starting point; the pitch gives an interaction contract, not finished typography/spacing/compositions. U14.1 produces reviewable light/dark layouts first. U14.2 establishes semantic tokens, then scoped cards apply composer, row, total and exception styling.

System/Light/Dark is in Settings General/Appearance, default System. Save the preference, follow system changes only when selected and apply before initial paint. Embedded store pages retain their own site appearance; the theme must not inject scripts/styles or interfere with authentication.

One Settings page has category navigation and one active section: General, Household, Stores, ChatGPT and AI, Data, Advanced, About. Use a compact category control at narrow widths. U16 inventories all current actions before extraction. Preserve model choice/Automatic explanation, honest quota unavailability, sign-in/out, store switches, backup/import/export, development mode, diagnostics and runtime version. Keep development tools available under Advanced; test mode cannot be disabled. No hidden functions, duplicate preferences or placeholder AI switches before later APIs exist.

Keep one-time product/type/quantity corrections beside shopping rows. Advanced maintains remembered rules; it must not be required to fix today's groceries. F15.14/F15.15 add a contextual “Tarkoitin jotain muuta” / “I meant something else” action, including apparently resolved rows. Reuse existing alternatives/quantity edits, leave impossible corrections visibly unresolved and persist preferences only with explicit Remember. Local reason-code counts can improve evaluation; correction is not automatic external reporting or training.

## Working and preview contract

The owner selected provisional previews and emphasized that a long request must show visible progress. On explicit submit, acknowledge work immediately with textual status and Cancel. Announce actual stages: interpretation, catalogue search, optional resolution. Do not invent percentages, prices, counts or elapsed-time promises, and do not show internal pass numbers/raw prompts.

As validated interpretation and verified retailer candidates arrive, publish provisional meal/row events. Clearly label their region as a preview and keep the previous committed list accessible. Stable row identities preserve focus/scroll; U14.1 reserves the layout, F16.9 defines events, F16.12/F16.13 implement stages/previews. A preview is not a quoted transferable list. The previous quote is historical, never presented as freshly verified by a still-running request.

Use one active provisional-results region, not two competing full lists/totals. Keep saved-list access deliberate and clear. Avoid automatic scrolling, repeated reordering and layout changes that make progress feel unstable.

Commit only a valid current operation atomically. Fatal error, cancellation, stale revision/store or restart drops provisional work and preserves saved list/quote and typed input. A valid partial plan can finish with unresolved rows and an explicitly incomplete subtotal. A resolver failure may still yield safe deterministic results; it cannot silently fill hard conflicts. Transfer remains unavailable for provisional data and follows U10's existing approval/exception rules for committed data.

v0.6.0 adds immediate feedback for lifecycle events already available. Detailed staged previews land with v0.7.0's coordinator, avoiding a redesign that pretends those backend phases already exist.

## Selection, consent and AI bounds

Owner addition after v0.6.0 publication: v0.7.0 F16.16–F16.18 establish provider-neutral task invocation/model capabilities/cancellation. ChatGPT remains default; interpretation, resolver, recipe import and later edits use the shared seam. Fake alternative providers establish compatibility now; F21 supplies live local/other adapters later. [Receipt learning](receipt-learning.md) uses this foundation in v0.9.0 with separate consent and a one-call import policy. F16.5 removes raw receipt text from ordinary prompts and reserves bounded relevant observed-summary input for F18.

Domain rules own suitability, exclusions, pack calculations and lowest total cost for enough whole packs; the owner explicitly confirmed this cost basis. For generic milk, plain cow milk of any fat content is suitable absent an explicit qualifier or saved preference. Other categories need F15.5's boundaries. Unknown attributes cannot establish a dietary requirement. Shopper-explicit, recipe-inferred and model-assumed qualifiers are distinct.

Rules handle clear matches without extra AI. One automatic batched resolver may choose only among already retrieved verified candidates or return unresolved/approval-required. Advanced Settings offers an off switch, default enabled. Off uses rules and optional review; it does not generate silent substitutions. A model may not invent product IDs/prices/stock/fees or override hard constraints. Changing model/switch affects the next explicit request only.

Maximum three AI requests per normal operation: interpretation, at most one existing schema-repair request, at most one candidate resolver. No corrective resolver call, recursive deliberation or quota/provider retry loop. Bound adapter search expansion/concurrency in F16.9. Advertise relevant data categories in Settings: note, relevant recipes/household constraints, compact explicit preferences and candidate details. Never send retailer credentials, account identifiers, addresses or full raw history. Connected ChatGPT does not imply access to unrelated conversations or ChatGPT memory.

The optional grouped uncertain-row review is F15's existing design. A count/link offers review; do not interrupt typing or show successive modal dialogs. Use once affects current list, Remember persists explicitly, Leave unresolved/dismiss does not save a preference. Advanced settings inspect/edit/forget/reset the same data. Purchases and rejected alternatives do not automatically become permanent preferences or external model training.

## Edits, repetition and budgets

Once a list exists, the composer modifies it by default. Clear instructions can add/remove items, replace a meal, change servings/quantity or mark at home against known internal identities. Ambiguity preserves saved state and asks for clarification. One invalid operation rejects an entire multi-part batch. Preserve unrelated manual choices and combine shared requirements; reprice changed requirements only. A concise summary and local one-step Undo explain the result.

Always show “Muokkaa nykyistä listaa” / “Edit current list” in existing-list mode, not merely a disappearing placeholder. Make “Uusi lista” / “New list” easy to find and distinctly label replacement drafting. Navigation/restart restores the correct composer context.

New list explicitly enters a replacement draft and preserves the saved list until success. Discarding unapplied input can require confirmation; routine edits do not. Undo restores local planning state, invalidates approvals and never reverses retailer writes. This is one workspace, not a chat transcript or a wizard.

Repeat last list uses stored requirements/recipes locally with refreshed prices and zero model generation. A verified transfer is not a confirmed purchase. F18 uses existing history rather than introducing a competing memory page. Frequent purchases remain suggestions until accepted.

Price-constrained meals are deferred (F19). F8 historical spending and F11 offer ideas remain distinct. Settle hard versus target budgets, unknown/weighed prices/fees and permitted dish changes before implementation. Any bounded revised proposal uses actual cost drivers, shares an explicit overall request cap and is revalidated locally. Incomplete price coverage can never claim a budget is met.

## Pitch mapping and delivery

| Pitch | Canonical work | Treatment |
| --- | --- | --- |
| AX-01 baseline/evaluation | F15.1, F16.1–F16.4 | One audit plus 60 synthetic/anonymized FI/EN shopping cases; edit cases added later |
| AX-02 compact context | F16.5 | Relevant recipes/constraints/preferences, no blanket raw history |
| AX-03 structured output | F16.7–F16.8 | Compatibility spike and supported fallback, no paid-key migration |
| AX-04 telemetry/routing | F16.6, F20.1–F20.2 | Metrics early; shortcuts/routing deferred pending evidence |
| AX-05 coordinator | F16.9–F16.11 | Typed operation, read-only stages and atomic commit |
| AX-06 progressive UI | U14.6, F16.12–F16.13 | Immediate feedback first; real staged previews with coordinator |
| AX-07 candidate contract | F15.7–F15.9 | Extend F15 schema/rules/adapters |
| AX-08 SKU resolver | F15.10–F15.11 | Verified IDs, bounded request, off switch |
| AX-09 grouped review | F15.6, F15.12 | Existing review extended, no second dialog |
| AX-10 edit intent | F17.1, F17.3 | Typed known targets and explicit ambiguity |
| AX-11 edit application | F17.2, F17.4–F17.5 | Atomic application, affected-only quotes, local undo |
| AX-12 composer/edit UX | F17.6–F17.8 | Default modify, explicit New list, concise summary |
| AX-13 local memory | F15.3/F15.13, F18.1–F18.2 | Existing preference/purchase APIs with provenance |
| AX-14 repeat list | F18.3–F18.5 | Local reuse and current quotes |
| AX-15 budget contract | F19.1–F19.2 | Deferred, policy required |
| AX-16 bounded replan | F19.3–F19.5 | Deferred, verified prices and call cap |
| Owner: dark mode/Settings | U15/U16 | v0.6.0, independent of AI enhancements |

v0.6.0's entry cards U14.1/U15.1/U16.1 establish reviewable contracts. After layouts, styling can proceed while theme and Settings contracts are fixed. Avoid simultaneous edits to `main.tsx`, `shopping.tsx`, `model.ts` or `style.css`; publish card claims and coordinate boundaries before parallel assignment. F15.1's audit can proceed independently of visual work. Strong agents narrow follow-ups before Simple handoff.

## Acceptance and remaining decisions

Evaluation distinguishes search misses, wrong ranking/SKU, incompatible quantities, missing requests, incorrect edits and unresolved reasons; compare call/search counts too. A lower unresolved count is not success if incorrect selections rise. Zero forbidden hard-constraint fixture matches, unsolicited generations and duplicate writes are fixed regressions; numerical improvement thresholds follow measured baseline.

Request coverage is a release gate: every requested dish/grocery in reference fixtures must map to a result or a visible unresolved request, even if no product requirement could be generated. F16.15 tracks extracted intent IDs/source spans through requirements/results; it prevents downstream loss but cannot independently prove AI extracted all arbitrary text. Tests use independently authored expectations from the actual note, including a meal plus yoghurt, unavailable search and unknown quantity. A priced basket that silently omitted yoghurt fails. Present unresolved interpretation near the meal cards, not only on product rows that may never exist.

Offline journeys cover multi-dish FI/EN requests, clear matches with no resolver, ambiguous candidates, cancelled/stale previews, Remember versus once, incomplete stock/prices, atomic edits/undo, repeat without AI and later real-budget cases. Use real IPC/validation/persistence and deterministic external fixtures under AGENTS.md. Live compatibility/interpretation tests need separate explicit owner authorization and stated request/retry budget; visual acceptance uses local development data.

Still open: initial non-milk category defaults and hard/soft saved preference semantics (F15.5); detailed layouts (U14.1); supported structured-output fields (F16.7); numerical quality/concurrency bounds after baseline; deferred budget semantics (F19.1). These are named gates, not invitations for coder agents to invent product policy.

The owner closed this design review on 10 October 2026 after accepting the complementary suggestions. Implement assigned cards against these boundaries; reopen discussion for concrete implementation evidence or the named gates rather than expanding design scope before coding. Correct products and understandable correction take priority over raw speed.
