# Korikone implementation plan

Revised 8 October 2026. Implements [design.md](design.md) and [ux.md](ux.md). The original CLI plan is [archived](archive/2026-10-07/implementation-plan.md).

## Dependency order

Status, 8 October 2026: the prerequisite is done. [s-kaupat-mcp](s-kaupat-mcp-plan.md) v1.0.0 is released and Korikone has a pinned S-kaupat adapter with offline contract tests. The next work is observed live acceptance for both chains (stages 3 and 4), then the consumer pilot. The original sequencing follows.

Build and release [s-kaupat-mcp as a separate project](s-kaupat-mcp-plan.md) first. Its S0 phase compares managed-session and minimal-extension access before committing to either implementation. The [decision record](plan-review.md) explains this revision. In parallel with that dependency only if useful, prototype Korikone's UI and verify ChatGPT sign-in. Start the full application after the S-kaupat cart gate passes. This sequencing avoids building a polished promise around an unproven retailer integration.

| Stage | Usable result | Depends on |
|---|---|---|
| Prerequisite S0-S3 (done) | Independently packaged S-kaupat MCP with verified list behavior (no server-side cart exists) | Released as s-kaupat-mcp v1.0.0 |
| 0. Product and technical proofs | Tested sign-in, UI flow and dependency decisions | Can precede prerequisite completion |
| 1. Application foundation | Installable app with manual planning and demo stores | Prerequisite release and stage 0 decisions |
| 2. Assisted planning | ChatGPT produces editable, validated meal drafts | Stage 1 |
| 3. Both store catalogues | Store-specific priced baskets with switching | Stage 1, pinned MCP releases |
| 4. Cart transfer | Approved changes verified in either retailer cart | Stages 2 and 3 |
| 5. Consumer pilot | Tested installer, recovery and weekly workflow | Stage 4 |
| 6. Optional improvements | History, offers and measured refinements | Pilot evidence |

Stages 2 and 3 can be developed independently once the foundation is stable. A K-Ruoka-only internal build is useful, but it does not meet the two-store release requirement. If S-kaupat cart support proves infeasible, explicitly rescope the product instead of quietly downgrading the requirement.

## 0. Product and technical proofs

### ChatGPT spike

Use the official local-app flow from the [cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt). Verify project eligibility and redistribution conditions. Pin the DevKit revision and record its license. Build the smallest Electron proof: connect, discover a model, receive completed inference, reconnect after restart, and sign out. Prove the renderer never receives credentials.

Exercise declined/missing plan permission, cancellation, a stale callback, token expiry, unavailable models and usage-limit failure after partial output. Confirm the response builder conforms to the current preview contract. Check the SDK abstraction supports Korikone's required structured request/stream behavior; use a small documented HTTP layer inside the provider if necessary. No coding-agent runtime is required.

### Dependency review

Apply the [integration adoption gates](integrations.md) to K-Ruoka and the new S-kaupat release. Record artifact versions, checksums, licenses, schemas, auth behavior, supported units and browser requirements. Test both processes from a packaged-app harness. Resolve profile ownership and human checkout handoff before building the transfer UI. Run the selected S-kaupat browser approach through combined onboarding with K-Ruoka; record any additional setup. Keep Electron as the default unless a complete packaged comparison justifies a change. Do not plan a framework or agent-runtime rewrite.

### UX proof

Prototype onboarding, weekly planning, basket review, store switching, missing products and partial transfer recovery using realistic Finnish sample data. Observe at least three non-technical people completing the core tasks without coaching. Treat this as an initial usability check, not statistical validation. Fix navigation and copy before committing to detailed components.

Exit: one completed ChatGPT request from the local runtime; a documented K-Ruoka adoption decision; a passing S-kaupat release gate before stage 1; and an understandable prototype. If ChatGPT access is unavailable, retain a manual prototype and report the blocker rather than substituting hidden API charges.

## 1. Application foundation

Use an Electron/React/TypeScript workspace. Begin with modules; the design document's module tree is a boundary guide, not a mandatory set of independently built packages. Add schema validation, SQLite migrations, a component catalogue, unit tests, UI tests and CI. Select and pin exact dependency versions during implementation. Keep provider/browser work outside the renderer and CPU/blocking work off the UI thread.

Build the app shell, runtime Finnish/English localization (Finnish default), household setup, recipe editor, staple editor, settings and demo mode. Supply synthetic data and fake K-Ruoka/S-kaupat providers through the same registry as real adapters. Build a complete demo journey early: choose meals, build requirements, match products, review changes, transfer to the fake cart and verify it. Include existing items, an unavailable product, a price change and an interrupted transfer. The demo uses deterministic sample meal inputs until AI is connected; clearly label all products and prices as sample data. Forms are the normal data entry route; imports/exports are optional.

Implement plan revisions, store contexts, scoped product IDs, decimal-safe quantities and integer-cent pricing. Add local data export, migration backup and restore. Store secrets and retailer profiles outside the repository; ignore all runtime data and debug output.

Use translation keys from the first component; ship complete `fi` and `en` catalogues. Put the language selector on onboarding and the persistent app header. Persist language locally and switch immediately without reload. Localize UI/accessibility text and format values at render time. Keep retailer queries and stable domain data separate from translated labels.

Test switching on onboarding, in an edited form, during AI generation, in basket review and during transfer/recovery. Preserve focus where possible, unsaved text, decimal-comma input, approvals, selected context and operation state. Verify future progress/errors adopt the new language, with no duplicate request or mutation. Check missing translation keys in CI and longer English/Finnish labels in visual review.

If the selected browser approach requires an extension, bundle/register the native helper, guide extension installation and enablement, and test missing, disabled and incompatible extension states. No extension side panel is in scope.

Package a Windows installer at this stage. Verify launch and editing on a clean machine. Do not postpone packaging until every feature depends on a developer environment.

Exit: a user can install, create recipes, plan a week and export a shopping list without a terminal or AI. Restart preserves data. Fake providers demonstrate both chains and an unsupported capability.

## 2. Assisted meal planning

Integrate the proved ChatGPT provider. Show connection state and usage management in settings. Keep manual planning available when AI is unavailable. A provider change cannot silently send household data to a different account.

Implement bounded meal interpretation: user input and approved recipe context produce a validated draft. Reject invented recipe references, invalid quantities and unsupported units. Ask about ambiguous portions. New recipes require approval before persistence; group them and portion questions into the plan review rather than separate dialogs. Preserve provenance so users can see which meals require each ingredient.

The deterministic planner scales portions, merges compatible units, applies skips/extras and adds due staples. Confirmed purchases advance cadence; transfer does not. Put uncertainty on the relevant card rather than requiring the user to search a conversation.

Test representative Finnish prompts against an anonymized evaluation set: leftovers, skipped pantry items, partial weeks, dietary exclusions, changed portions and unknown recipes. Test malformed/partial AI output and interrupted requests without live inference in CI. Use a few deliberate live evaluations outside CI.

Exit: ordinary requests produce correct editable plans, invalid output cannot corrupt saved data, and manual planning remains usable through sign-in or usage failures.

## 3. Catalogue and matching for both chains

Implement the two local MCP adapters and provider registry. Adapt proposed Korikone methods to each upstream schema; never assume matching method names imply matching semantics. Surface typed errors and capabilities.

Build retailer/branch search, fulfillment context and saved favorites. Fetch store-scoped products and observations. Implement accepted-product choices, `pinned`, `cheapest` and `ask`, exact pack arithmetic, quantity increments, unknown pricing and constrained substitutions. Distinguish hard dietary/brand/substitution rules from soft preferences. For `cheapest`, minimize the cost of enough packs of one accepted candidate to cover the requirement; break ties by surplus and stable product ID. Display unit price and surplus without optimizing inferred pantry stock. Require explicit acceptance of unfamiliar products.

Build basket cards with quantity, pack size, total, unit price and reason for choice. Show unknown fees, price timestamps and unresolved items. Store switching creates a new revision and rematches without writing to either cart.

Run shared provider contract tests for both chains using sanitized fixtures. Include reused product IDs across providers, different branch prices, offers tied to another account, unknown stock, weighted produce, deposits and incomplete pack data. Include the 500 g/EUR 2 versus 1 kg/EUR 3 case, pack rounding, equal-cost ties and hard exclusions that a cheaper product must never override. Test a fictional third provider registration to catch chain assumptions in shared logic.

Exit: the same ingredient list creates independently priced baskets at either chain. Switching preserves the meals, clears stale approvals and makes no cart mutation. Nine-in-ten automatic matching for familiar ingredients is a pilot target, not a release substitute for correctness.

## 4. Cart transfer and review

Implement the approval-bound diff, per-cart lock, operation journal, absolute quantity writes and reconciliation described in the design. Existing unrelated lines stay in place. Overlapping lines show the resulting quantity. A missing price, unresolved product, changed context or excessive quantity blocks transfer until handled.

Show a review screen with a single primary transfer action. Group unresolved choices and approve the exact batch once; avoid repeated per-item confirmations for the approved transfer. Approval includes the refreshed quote, baseline and target quantities. Disable duplicate submission. Reconcile after each write and after completion. Stop on uncertain state, login loss, a changed cart or user cancellation. Provide a reviewed resume action; never call it rollback.

Verify manual checkout uses the authenticated cart. Detach automation and hand the store window to the user. For a managed session, do not assume the user's default browser shares the worker's cookies. For an extension, verify the selected browser profile/tab/account and stop command dispatch on handoff. Test restart and recovery for the chosen approach. Korikone never confirms an order on the user's behalf.

Required failure tests:

- Timeout before a write and timeout after a successful write.
- Apparent success with no cart change; anonymous cart returned as empty.
- Process crash between dispatch and journal completion.
- Concurrent manual cart edit, changed branch/slot and overlapping product.
- Double click, two windows and retry after restart.
- Weighted unit confusion, excessive quantity, missing stock and price change.
- Attempted unapproved mutation, bulk clear or checkout through app IPC/tools.

Live acceptance is separate from CI: one small user-observed transfer per chain, exact readback, then a representative basket after the small test passes. Document setup, intended changes and cleanup for those future tests.

Exit: both chains pass the same correctness scenarios. A partial failure preserves data and clearly distinguishes verified, pending and uncertain lines. The user can finish checkout manually in the correct cart.

## 5. Consumer pilot and release

Run three or four weekly cycles across households using both chains. Include at least one tester who did not participate in development. Measure onboarding completion, time to review a familiar basket, unresolved choices, unexpected cart changes and recovery success. Zero unexplained cart changes is a release gate.

Complete keyboard and screen-reader checks, contrast checks, 200% zoom, narrow-window layouts, reduced motion and localized errors in both Finnish and English. Verify Finnish is the first-launch default, the saved choice survives restart, and live switching works without lost work. Inspect loading, empty, offline, partial and expired-login states alongside the happy path. Keep the store and branch visible throughout review and transfer.

Test signed installers and updates where the target platform supports them, migration backup/restore, worker shutdown, disk-full handling and an older saved database. If signed distribution is not ready, label the build as a limited preview rather than a general consumer release. Ship pinned workers and required browser components through a documented installation path. Check protocol/schema compatibility before enabling store operations; show a recoverable update message for incompatible components. Exercise an app/worker version mismatch and, if applicable, an independently updated extension. Provide a redacted diagnostic export and a plain-language troubleshooting page.

Exit: a new user can install, connect ChatGPT, choose either store, plan, review, transfer and reach manual checkout without developer assistance. Neither dependencies nor tokens appear in the normal user flow. Known store limitations are documented and visible in the app.

## 6. Add only what the pilot justifies

Consider order-history import, cadence suggestions, offer-led meal suggestions, substitution settings and basket comparison. All depend on explicit provider capabilities. Show savings against a stated comparable baseline and include known fees. Cross-store comparison must account for pack quantities and incomplete matches; it cannot simply compare two displayed totals.

Mobile/hosted access and household sharing require separate design decisions. Reuse the domain packages, but re-evaluate authentication eligibility, account isolation and retailer session handling for those environments.

## Working agreements

- Keep s-kaupat-mcp releases independent; consume pinned artifacts, never a moving branch. Require compatible schemas and capabilities at startup.
- Ship one desktop interface and one chosen S-kaupat browser approach. Reconsider extra interfaces, pantry tracking and additional AI runtimes only after pilot evidence shows a need.
- Core tests and provider protocol fixtures run offline in CI. Live account tests are small, deliberate and documented.
- Use type checking, formatting, unit/contract tests and relevant UI tests before a release. Do not build tests that merely repeat the implementation.
- Review schema migrations and exercise backup/restore. User recipes cannot be recovered by re-importing store history.
- Keep one local application and local workers. No cloud deployment or remote MCP service is needed for v1.
- Time-box an uncertain store investigation to two focused evenings, then record a decision and fallback. Never describe catalogue-only support as completed cart integration.
