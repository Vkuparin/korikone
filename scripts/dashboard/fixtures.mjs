export const roadmapFixture = `# Roadmap
## Current release
[v0.6.0](https://github.com/example/repo/releases/tag/v0.6.0) is published.
## Delivery sequence
| Version | Goal | Canonical tasks | Release criterion |
| --- | --- | --- | --- |
| 0.6.0 | Design | [Design](tasks/0.6.0.md) | Visual acceptance |
| 0.7.0 | Better product matching | [Matching](tasks/0.7.0.md) | Safe matching and owner acceptance |
| 0.8.0 | Edit the current list | [Edits](tasks/0.8.0.md) | Atomic edits |
| 1.0.0 | Stable | [Gates](pre-release.md) | All gates met |
| Unassigned | Future ideas | [Later](tasks/later.md) | Scope decisions |
## Accepted direction
Keep saved lists until success.
## Decisions still needed
Budget policy.
`;
export const releasedFixture = `# 0.6.0
## U14. Design
| ID | Task | Status |
| --- | --- | --- |
| U14.1 | Review the design | Done: included in published v0.6.0 |
`;
export const tasksFixture = `# 0.7.0
## F15. Resolve general groceries
| ID | Task and Done when | Agent | Depends on | Status |
| --- | --- | --- | --- | --- |
| F15.1 | Define category rules. Reject unsuitable products. | Strong | U14.1 | Done: abc123, merged to main; not released. Owner acceptance remains. |
| F15.2 | Match groceries consistently | Simple | F15.1 | In progress: Agent One, branch codex/matcher |
| F15.3 | Present alternatives | Simple | F15.2 | Planned |
| F15.4 | Decide category defaults | Strong, with owner | | Needs decision: bread policy |
| F15.5 | Old automatic update | Simple | | Dropped: explicit action instead |
## F15 extensions: product corrections
| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| F15.6 | Keep product corrections | F15.1 | Done: local-only commit def456; not merged |
`;
export const futureFixture = `# 0.8.0
## F17. Atomic edits
| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| F17.1 | Define edit commands | F15.2 | Planned |
`;
export const laterFixture = `# Later
## F19. Budgets
| ID | Task | Agent | Depends on | Status |
| --- | --- | --- | --- | --- |
| F19.1 | Decide budgets | Strong | | Needs decision: policy |
`;
export const fixtureFiles = {
  "docs/roadmap.md": roadmapFixture,
  "docs/tasks/0.6.0.md": releasedFixture,
  "docs/tasks/0.7.0.md": tasksFixture,
  "docs/tasks/0.8.0.md": futureFixture,
  "docs/tasks/later.md": laterFixture,
};
