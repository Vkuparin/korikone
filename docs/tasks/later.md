# Later stage: release not assigned

Canonical task list. Read [the roadmap](../roadmap.md) and [AGENTS.md](../../AGENTS.md), then load only the assigned card and its dependencies. Existing IDs and status evidence are preserved.

## F19. Real-price-constrained meal planning

Deferred from the immediate redesign and matching releases. This is different from F8's historical spending chart or F11's offer ideas. No implicit autonomous meal changes or invented prices. Assign a release after F19.1 settles policy and matching/edit foundations are measured.

| ID | Task and Done when | Agent | Depends on | Status |
| --- | --- | --- | --- | --- |
| F19.1 | Settle hard versus target budget, unknown/weighed prices, store fees, leftover/pack overlap and permissible meal changes with owner. Record typed within/over/unknown result and review/undo policy in design/UX. Done when “five dinners for five under EUR65” has explicit meaning and total AI request budget includes repairs/resolution/replanning. Existing maximum-three operation cap remains unless owner changes it. | Strong, with owner | F17.4, F16.14 | Needs decision: budget semantics and allowed changes |
| F19.2 | Implement pure real-quote budget evaluator in proposed domain cost module using F4/F5 price representations and shared requirements. No model price claims. Done when unit fixtures cover enough packs, overlap, fees, estimated weights, missing prices and overage; incomplete coverage never reports within budget. | Strong | F19.1, F4.3, F5.1 | Planned |
| F19.3 | Add at most one revised AI meal proposal using verified cost drivers/suitable alternatives; run through ordinary validation/matching/evaluator. No recursive optimizer or expanded permission to transfer. Stop if operation request budget exhausted. Done when mocked service fixtures cover initially affordable/no replan, successful revision, still over budget, unavailable replacement, quota/cancel and hard constraints preserved. | Strong | F19.2, F15.10, F17.4 | Planned |
| F19.4 | Present quoted budget coverage, shortfall/unknowns, concise meal changes and local undo in shopping/i18n. Done when focused UI fixtures show honest totals and required choice when policy requires it; no hidden meal substitution and U10 approval unchanged. | Simple | F19.3 | Planned |
| F19.5 | Add offline price-constrained scenarios to F16 evaluation and update design/UX/testing/acceptance. Done when measured outcomes distinguish budget success/overage/unknown, call bounds hold and no forbidden matches or extra retailer authority appear. | Simple | F19.4 | Planned |

## F20. Optional deterministic shortcuts and model routing

Telemetry itself is F16.6. Only pursue shortcuts/routing after quality measurements establish value; preserve U11's account catalogue, manual model choice and small-model Automatic intent.

| ID | Task and Done when | Agent | Depends on | Status |
| --- | --- | --- | --- | --- |
| F20.1 | Evaluate bounded deterministic handling for explicit unambiguous structured edits using F17 engine and F16 metrics. Ambiguous words fall back to validated interpretation, never guessed mutations. Done when offline comparisons establish equal intent/quantity correctness and fewer calls; document supported grammar and choose adoption from evidence. | Strong | F17.8, F16.6 | Planned |
| F20.2 | Evaluate task-aware routing only within Automatic and actual connected-account model catalogue, preserving explicit manual selection. Scope AI models/protocol/coordinator. Done when mocked fixtures cover absent/unavailable model, quota/error, no silent paid-provider switch, call caps and measured benefit; do not assume a model is available or cheaper from its name alone. | Strong | F16.6, F16.7 | Planned |

## L1. Swedish language support

Accepted for later work, separately from U12's selector refresh. Translate the whole supported flow, not just the menu; preserve Finnish retailer search/category identities while showing Swedish text. Assign a release after the core matching and current usability work is settled.

| ID   | Task, and done when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Agent  | Depends on | Status  |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | ------- |
| L1.1 | Audit hardcoded Finnish/English branches in `src/ui/`, AI prompts and language validation; extend localization and persistence to `sv`, with older profiles/backups unchanged. Add complete Swedish UI strings, errors, quantities, dates, clipboard exports and AI output-language instructions while keeping retailer matching independent of display language. Done when focused tests cover Swedish planning, transfers/recovery, Settings, backup/restart and exports with local AI/retailer fixtures; record translation review and remaining owner checks | Strong | U12.2      | Planned |
| L1.2 | Enable Svenska in the language menu only when L1.1 is complete. Done when a Swedish-language reviewer verifies wording and a development-mode desktop check switches Finnish/English/Swedish without losing unsaved input, with keyboard access and no clipped text                                                                                                                                                                                                                                                                                              | Simple | L1.1       | Planned |
