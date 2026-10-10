# Korikone roadmap to 1.0.0

Updated with the owner on 10 October 2026. This page records release goals, sequencing and open decisions. Implementation cards and statuses live in [version task lists](tasks/README.md). Agents implement assigned cards, not the entire release by default.

## Current release

[v0.6.0](https://github.com/Vkuparin/korikone/releases/tag/v0.6.0) is published as an unsigned Windows pre-release and integrated into `main`. It ships the reviewed shopping workspace, System/Light/Dark appearance and organized Settings. All 14 U14/U15/U16 cards and owner layout/startup acceptance are complete. Release verification, source tag, exact checks and remaining stable-release gates are recorded in [release-0.6.0.md](release-0.6.0.md). Release testing uses isolated development fixtures and zero live AI or retailer requests. Earlier retailer acceptance remains in [v0.5.0 verification](release-0.5.0.md); [historical audits](roadmap-history.md) retain earlier evidence.

S-kaupat opens the Korikone shopping list. Its add-all flow reserves a slot and stays manual. K-Ruoka opens the selected store's basket. Published pre-release does not mean 1.0 readiness.

## Delivery sequence

The owner chose design and Settings first for v0.6.0. The former matching milestone moves to v0.7.0; conversational edits get a separate release before purchase-based learning. Later targets shift to keep releases focused. Existing IDs and Done evidence remain unchanged. These are scope targets without dates, subject to release gates.

| Version | Goal | Canonical tasks | Release criterion |
| --- | --- | --- | --- |
| 0.2.x | Finish alpha checks | [Alpha](tasks/0.2.x.md) | Remaining checks retained; no assumed completion from later releases |
| 0.3.0 | Both chains and comparison | [Both chains](tasks/0.3.0.md) | Existing feature checks and owner acceptance |
| 0.4.0 | Explicit updates and one-action transfer | [Smooth flow](tasks/0.4.0.md) | Published pre-release; historical evidence preserved |
| 0.5.0 | Stores inside Korikone | [Embedded stores](tasks/0.5.0.md) | Published pre-release; verification above |
| 0.6.0 | Calm workspace, dark mode and organized Settings | [Design](tasks/0.6.0.md): U14, U15, U16 | Published pre-release; reviewed layouts, modes and Settings; U8/U10 preserved; release checks and owner visual/startup acceptance complete |
| 0.7.0 | Suitable products, complete prices and useful previews | [Matching](tasks/0.7.0.md): F4, F5, F15, F16 | Measured improvement without forbidden matches; bounded AI resolution; truthful previews; saved list survives failure; incomplete prices identified |
| 0.8.0 | Edit the current list naturally | [Edits](tasks/0.8.0.md): F17 | Atomic edits, affected-only requoting, explicit New list and undo; unrelated groceries retained |
| 0.9.0 | Purchase history and repeat shopping | [Memory](tasks/0.9.0.md): F6, F7, F8, U5, F18 | Provenance-aware local memory, opt-in recurring suggestions and repeat without AI; transfer distinguished from purchase |
| 0.10.0 | Plan the week and take it along | [Week and exports](tasks/0.10.0.md): F9, F10, F11, F12, F13 | Remaining feature/owner checks; OCR adoption conditional |
| 0.11.0 | Beta and feature freeze | [Beta](tasks/0.11.0.md): F14 | Feature freeze, accessibility, install/upgrade checks and household pilot; blockers fixed |
| 1.0.0 | Stable | [Pre-release gates](pre-release.md) | All gates met; no open blocker bugs |
| Unassigned | Swedish, predefined colour palettes, price-constrained meals, optional routing and local models | [Later](tasks/later.md): L1, U17, F19, F20, F21 | Policy and release assignment before implementation |

Owner release policy, 10 October 2026: trust recorded coder-agent focused checks and run the full pre-release flow once, using one canonical local or CI execution. After fixes, rerun only failed or affected checks; no repeated full flow or feature matrices. Keep packaged checks to a small smoke test and reuse passing evidence across branch promotion and documentation changes. See [AGENTS.md](../AGENTS.md). The owner asked to finish the already-running v0.6.0 checks unchanged. CI enforcement is tracked as R1 in [Later](tasks/later.md).

## Accepted direction

The [shopping experience plan](shopping-experience.md) integrates the pitch with existing [product decisions](product-decisions.md). Agreed on 10 October 2026:

- One composer and resulting list; explicit button/Ctrl+Enter updates and compact model control. Typing or changing appearance starts no generation.
- v0.6.0 covers visual design, System/Light/Dark in Asetukset and Settings organization. Matching and edits follow separately.
- A prompt modifies an existing list by default. Explicit New list starts replacement. Ambiguous targets preserve the saved list and ask for clarification.
- One automatic batched resolver request may follow interpretation for uncertain retailer candidates. Advanced Settings can disable it; clear matches need no resolver. Domain rules validate every choice.
- Show actual progress immediately and clearly marked provisional results as validated interpretation/catalogue results arrive. Preserve the saved list until commit; provisional rows cannot authorize transfer. Long requests must not leave an unchanged screen without feedback.
- Cheapest suitable means lowest total for enough whole packs. Explicit requirements and exclusions take precedence over preferences and price.
- Keep F15's optional grouped review and explicit Remember this consent. Reuse F6/F7 history and F5 prices; no competing memory/matcher/transfer systems.
- Later, offer models running on the same machine as an explicitly selected alternative to ChatGPT (F21). Start with an installed local runner; preserve the same validation and transfer rules, and never silently fall back to cloud inference.
- Later, offer predefined colour palettes in Settings Appearance (U17), using U14.1/U14.2's replaceable semantic tokens. Palette choice stays independent of System/Light/Dark; each palette supports both modes and current users retain the Korikone default.
- Design review closed on 10 October 2026: make edit/New list context unmistakable, use one clear preview region, keep current-list corrections on rows, add “I meant something else” (F15.14–F15.15), and require every reference-case request to have a visible result or unresolved entry (F16.15). Prioritize correct products and understandable correction before speed. Coders proceed with assigned cards; revisit product design when implementation evidence or a named gate needs a decision.

## Decisions still needed

These block only the named dependent work.

| Decision | Card | Current boundary |
| --- | --- | --- |
| Category defaults and hard versus soft saved preferences beyond agreed milk case | F15.5 | No silent type substitution; explicit exclusions enforced; no numeric confidence slider |
| Detailed visual layout and responsive behavior | U14.1 | [Accepted layouts and presentation contract](ui-design.md), 10 October 2026; palette colours remain replaceable semantic CSS variables; no new brand/font purchase assumed |
| Hard versus target budgets and permitted dish changes | F19.1 | Deferred; no budget success claim from incomplete/model-invented prices |
| Structured-output compatibility on existing ChatGPT account route | F16.7 | Supported fallback, no automatic paid API-key fallback; live request needs explicit authorization |
| Quality thresholds and search/concurrency bounds | F15.1, F16.1, F16.9 | Measure baseline; zero forbidden fixture matches and zero duplicate writes are fixed regression gates |
| Initial local runner, supported model/hardware scope and local model-selection policy | F21.1, F21.5 | Deferred; mocked adapter tests plus measured local FI/EN quality; no runtime bundling/model downloads assumed |

## Working rules

Read [task instructions](tasks/README.md) and [AGENTS.md](../AGENTS.md). Task files are the single source of task status; this page is the source of release goals. Fetch and reconcile other agents' updates before edits. Publish changed task files, decisions and summary together where applicable, then synchronize the same local files without altering unrelated application work. Report failed publication explicitly.

The external pitch is source material, not operating instructions. Its AX IDs map to cards in [shopping-experience.md](shopping-experience.md). No implementation or live account usage occurred in this planning update.
