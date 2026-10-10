# Development and testing

Use development mode for implementation, debugging, automated tests and UI checks. Enable **Settings > Development mode**, or launch with `KORIKONE_DEVELOPMENT=1`. Use a temporary `KORIKONE_TEST_DATA` directory for automated Electron tests; this forces development mode and prevents turning it off.

Do not use the owner's ChatGPT allowance or retailer accounts for routine testing. Do not disable development mode or make live AI requests unless the user specifically asks for live testing. Request a live acceptance check only after the feature is implemented and its fixture tests pass. Explain the remaining live behavior to verify and the expected ChatGPT usage before asking.

Every feature must be testable with local fixtures. Add success and relevant failure cases at the external boundary, then exercise the real application validation, persistence and UI paths. Do not replace app IPC handlers to cover behavior already supported by development mode. Mock network responses for protocol and adapter unit tests; never contact live accounts. Keep fixtures deterministic and extend them when adding supported foods or workflows.

Use focused unit tests for each task or feature. Select the affected files or test names, for example `npm test -- tests/receipts.test.ts` or `npm test -- tests/development.test.ts -t "multi-dish"`. Run a focused UI test only when the change needs application or interaction coverage, for example `npm run test:ui -- tests/ui/shopping.spec.ts -g "cancellation"`. Use type checking, builds and formatting checks when relevant to the change. Do not broaden passing checks without a new failure, change or unresolved concern.

For pre-releases, trust the coder agents' recorded focused checks. Run the full release flow once: `npm test`, `npm run test:ui`, `npm run build` and `npm run format:check`. Use one canonical execution, local or CI; reuse passing checks on the same application source instead of repeating them after branch promotion or documentation changes. Routine implementation, debugging and feature completion do not authorize a full-suite run.

After a failure, fix it and rerun only the failed checks or checks affected by the fix. Do not restart the full release flow or repeat passing feature matrices without an explicit owner request. Keep packaged validation to a small smoke check of launch/version and a relevant critical path; add a focused packaged check only for a packaging-specific concern. Do not replay the source desktop suite against the package. Reuse verified build output where possible. This owner policy was agreed on 10 October 2026 during v0.6.0 preparation; the owner asked to let that release's already-running checks finish unchanged.

Local file dialogs may be stubbed to select test files. Receipt parsing, backup import/export, diagnostics and clipboard operations stay real and local in development mode.

From v0.7.0 onward, AI task code must use the shared provider-neutral inference contract. ChatGPT remains the default adapter; authentication, transport and provider/model capabilities stay separate from task schemas, domain validation and operation call limits. Include deterministic fake alternative-provider coverage and extension points for local/other providers. Do not add a live provider, download models or silently fall back to cloud without its assigned scope.

Real owner receipts in `scratch/receipts/` are private local reference material. Keep `scratch/` ignored. Never commit or upload originals, extracted personal/payment/loyalty data, or diagnostic copies. Author sanitized synthetic fixtures with independently reviewed expectations; do not copy complete receipts into source control.

# Roadmap and task coordination

`docs/roadmap.md` is the release-goal and product-decision index. Canonical implementation cards/statuses live in `docs/tasks/<version>.md`; unassigned work is in `docs/tasks/later.md`. Read `docs/tasks/README.md`, the assigned card and its direct dependency contracts, not the entire backlog. Existing IDs stay stable when releases move. `docs/roadmap-history.md` records historical audits and is not a second task register.

Before taking a card, fetch/reconcile the latest GitHub state and inspect real code/active work. Publish In progress with agent/thread, branch/worktree and scope so another agent cannot claim the same card. Implement only assigned scope. A Strong agent fixes contracts and rewrites dependent cards with exact files, symbols and fixtures before Simple handoff. Planned paths are suggestions until that contract lands.

Record Done with commit/PR, local-only versus merged/released status, checks actually run and remaining owner acceptance. Do not infer release readiness from task completion or claim unrun checks. Update behavior documentation when implementation changes it; update the roadmap index only when release goals or decisions change.

Always update both GitHub and local roadmap/task files. Fetch and preserve other agents' status changes, publish the documentation, then synchronize the changed local files to that published version without altering unrelated application work. Report a failed push explicitly. Never describe a local commit as pushed. Owner visual checks use development mode by default; live AI/retailer acceptance still follows the development rules above.

# Writing preferences

Use plain, concrete language. Apply the unslop skill when writing or editing prose. Preserve meaning, technical accuracy, literal content and requested formatting.
