# {{INITIAL_VERSION}}: {{INITIAL_RELEASE_GOAL}}

Read [task rules](README.md), [AGENTS.md](../../AGENTS.md), the assigned card and direct dependency contracts. Replace these example cards with owner-agreed project scope before implementation.

## F1. {{FEATURE_NAME}}

State the user problem, resulting behavior and product constraints. Planned paths remain suggestions until the Strong contract lands.

| ID | Task and Done when | Agent | Depends on | Status |
| --- | --- | --- | --- | --- |
| F1.1 | Settle the feature schema/API, validation, persistence and boundary fixtures in named files. Rewrite dependent cards with exact symbols and fixtures. Done when the contract is documented and focused success/failure fixtures pass. | Strong | | Planned |
| F1.2 | Implement the bounded user interaction using F1.1's contract and real application paths. Done when focused fixtures cover success, failure and retained user input; behavior documentation matches. | Simple | F1.1 | Planned |

Completion evidence belongs in Status: for example, Done: commit/PR, integrated on main; not released. Focused checks actually run; remaining owner acceptance. A claim uses In progress: agent/thread, branch/worktree, assigned scope.
