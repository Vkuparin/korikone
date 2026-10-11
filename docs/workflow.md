# Reuse this workflow in another project

Give the next project's agents this instruction:

> Copy the workflow starter kit from `D:/AIstuff/repos/korikone/docs/workflow.md` into this project. Adapt the project name, initial version and actual development/test/release commands. Preserve the roadmap/task split, Simple/Strong cards, published claims, fixture-first development, focused checks, one full pre-release validation flow and synchronized local/GitHub status updates. Keep existing project instructions and work; reconcile conflicts instead of overwriting them. Do not copy Korikone's product backlog or domain code. Make this checkout readable by the development dashboard without adding agent reporting steps.

## Starter files

| Source in this repository | Destination in the new project | Adaptation |
| --- | --- | --- |
| [Agent template](workflow/AGENTS.template.md) | `AGENTS.md` | Merge with existing instructions; replace project commands and development-mode details |
| [Roadmap template](workflow/roadmap.template.md) | `docs/roadmap.md` | Project name, release goals, current release and initial version |
| [Task rules template](workflow/task-rules.template.md) | `docs/tasks/README.md` | Version index and project-specific fixture commands |
| [Version cards template](workflow/version.template.md) | `docs/tasks/<version>.md` | Initial version, feature goal, concrete cards and dependencies |
| [Later template](workflow/later.template.md) | `docs/tasks/later.md` | Only agreed work without an assigned release |

Set the initial version explicitly, such as `0.1.0`, and replace every `{{PLACEHOLDER}}`. Seed actual product goals with the owner; template example tasks are not authorization to build them. Keep private reference material in an ignored directory such as `scratch/`. Define the project's development/test-data isolation before tests can touch external services or personal data.

## How the work moves

1. The PM records product decisions and release goals in the roadmap. Implementation cards live only in version task files. Unassigned ideas stay in Later; historical audits can go in a separate history document.
2. Split work into independently reviewable cards. Strong cards settle schemas, APIs, integrations and orchestration. They update dependent cards with exact symbols, files and fixtures before Simple agents begin. Simple cards implement bounded work under those contracts. Owner marks a named decision or acceptance step.
3. Before claiming, fetch and reconcile GitHub, inspect actual code and active work, then publish In progress with agent/thread, branch/worktree and scope. Work only on assigned scope. Prefer separate worktrees for concurrent implementation; preserve other agents' files, staged work and statuses.
4. Implement and verify with deterministic fixtures at external boundaries and the real domain, persistence and UI paths. Use focused checks for affected behavior. Agents record the checks actually run, integration state and remaining acceptance, then publish the result and synchronize the local documents.
5. Release agents trust recorded focused checks. A pre-release gets one canonical full validation flow, local or CI. After failure, fix and rerun only failed or affected checks. Reuse passing evidence on unchanged application source; branch promotion and documentation updates do not require another full run. Keep packaged smoke checks small.

The dashboard is a read-only view of those files. It does not create reports, infer completion from commits or decide that a release is ready. Routine refresh uses no AI tokens.

Korikone's current agent policy already defines the one-flow release rule. CI trigger/evidence enforcement is still the planned R1.1 tooling card; the existing CI workflow is not a template for that policy. Configure the new project's automation deliberately and record which execution supplies the canonical release evidence.

## Dashboard compatibility

Keep these headings and columns; prose inside cells can be project-specific:

- `docs/roadmap.md`: a `## Delivery sequence` table with `Version`, `Goal`, `Canonical tasks`, `Release criterion`. Link cards as `tasks/<version>.md`, and unassigned work as `tasks/later.md`.
- When a release exists, put `[v<version>](https://.../releases/tag/v<version>)` under `## Current release`. Before the first release, say that nothing is published. Keep `## Accepted direction` and `## Decisions still needed` for expandable decision notes.
- Task files: feature headings such as `## F1. Product search`, and tables with `ID`, `Task and Done when`, `Agent`, `Depends on`, `Status`. Older tables without Agent/Depends on remain readable.
- Stable card IDs such as `F1.1`, `U2.3`, `R1.1` or `A.1`. Dependency cells reference IDs or named owner policies. Existing IDs stay stable when releases move.
- Status starts with `Planned`, `In progress`, `Needs decision`, `Done` or `Dropped`, followed by evidence or explanation. Completion evidence remains in that same cell.
- Canonical version filenames use `<major>.<minor>.<patch>.md` (or an existing `<major>.<minor>.x.md`). Do not maintain a second register for the dashboard.

Choose **Add checkout** in the dashboard, pick the folder or paste its absolute path, then switch projects using the header selector. One dashboard installation serves all compatible local checkouts. It never initializes or writes their roadmap files. Projects need to exist locally; remote updates appear through the normal Git synchronization workflow.

To run the tooling without copying it into another project:

```powershell
node D:/AIstuff/repos/korikone/scripts/dashboard/server.mjs --open
# Or start with a different checkout:
node D:/AIstuff/repos/korikone/scripts/dashboard/server.mjs --root D:/repos/another-project --open
```

For an independent copy, copy `scripts/dashboard/` and [dashboard usage](dashboard.md), add a launch command that runs `node scripts/dashboard/server.mjs --open`, and adapt documentation paths. The runtime uses built-in Node.js modules; browser fixture tests additionally use Playwright. Do not copy private project lists from local application data.
