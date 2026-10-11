# Development and testing

Project: {{PROJECT_NAME}}.

Use the project's development mode and isolated temporary test-data directory for implementation, debugging, automated tests and UI checks. Establish deterministic fixtures before exercising external services. Never use the owner's AI allowance, live accounts or personal data for routine testing. Live testing requires explicit owner authorization, an implemented feature and passing fixtures. State the remaining behavior and expected usage before requesting live acceptance.

Every feature must be testable locally. Mock external network/protocol boundaries, then exercise real validation, persistence and UI paths. Include success and relevant failure cases. Do not replace application handlers when the development fixtures already support the behavior. File dialogs may select synthetic local test files; the actual parsing, import/export and persistence paths remain real. Keep fixtures deterministic.

Use focused tests for each task. Run only affected files or test names. Add a focused UI check when interactions or application wiring need coverage. Use type checking, builds and formatting when relevant. Do not broaden passing checks without a new change, failure or unresolved concern. Record only checks actually run.

For pre-releases, trust coder agents' recorded focused checks. Run the full release flow once using one canonical local or CI execution. After failure, fix and rerun failed or affected checks only. Reuse passing evidence on unchanged application source across branch promotion and documentation changes. A routine coding task does not authorize a full-suite run. Keep packaged validation to launch/version and a relevant critical-path smoke check; do not replay the desktop suite against the package.

Project commands and isolation:

| Purpose | Project command or contract |
| --- | --- |
| Development mode and isolated data | {{DEVELOPMENT_AND_TEST_DATA}} |
| Focused unit tests | {{FOCUSED_UNIT_COMMAND}} |
| Focused UI/integration tests | {{FOCUSED_UI_COMMAND_OR_NOT_APPLICABLE}} |
| Relevant type/build/format checks | {{STATIC_CHECK_COMMANDS}} |
| One canonical release flow | {{RELEASE_FLOW_COMMANDS_AND_CI_TRIGGER}} |
| Packaged smoke, if applicable | {{PACKAGED_SMOKE_COMMAND_OR_NOT_APPLICABLE}} |

If the product uses AI, keep task schemas, domain validation and operation request limits separate from provider authentication, transport and capabilities. Use a shared provider-neutral task boundary, the agreed default provider and deterministic alternative-provider fixtures. New providers, model downloads and silent cloud fallback require their assigned scope. If the product has no AI, this introduces no AI implementation work.

Private reference material stays in an ignored local directory. Never commit or upload originals, credentials, personal/payment data or diagnostic copies. Use independently authored sanitized synthetic fixtures with reviewed expectations.

# Roadmap and task coordination

`docs/roadmap.md` contains release goals and product decisions. Canonical implementation cards/statuses live in `docs/tasks/<version>.md`; unassigned work is in `docs/tasks/later.md`. Historical audits are evidence, not a second task register. Read `docs/tasks/README.md`, the assigned card and direct dependency contracts, not the entire backlog.

Before claiming, fetch/reconcile GitHub and inspect code and active work. Publish In progress with agent/thread, branch/worktree and scope. Implement only assigned scope. Stable IDs survive version moves. A Strong agent settles contracts and updates dependent cards with actual files, symbols and fixtures before Simple handoff.

Record Done with commit/PR, local-only versus integrated/released status, actual checks and remaining owner acceptance. Task completion does not establish release readiness. Update behavior documentation when behavior changes; update the roadmap index when goals or decisions change.

Keep GitHub and local roadmap/task files synchronized. Preserve other agents' changes, publish the documentation and synchronize to that published state without altering unrelated work. Report failed pushes; never describe a local commit as pushed. Stage only owned changes. Do not reset, stash, clean up or overwrite another agent's work. Prefer separate worktrees for concurrent implementation; check for an existing suitable worktree first.

Use the existing table columns and status prefixes from task rules. Dashboard updates are automatic; agents do not maintain dashboards, summaries or extra metadata.

# Writing and collaboration

Use plain, concrete language. Apply the unslop skill when available. Preserve meaning, literal content, technical accuracy and requested formatting. Do not spawn/delegate work unless authorized by the owner or project instructions. Ask about genuine product ambiguity and named owner gates; continue independent authorized work while waiting. Keep progress updates concise and report results with evidence and practical limits.
