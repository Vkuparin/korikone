# Task lists

[Roadmap](../roadmap.md) contains goals and decisions. Version files contain canonical implementation cards; Later contains unassigned work. Agents read only the assigned card and its direct contracts.

## Taking a card

1. Fetch/reconcile GitHub, inspect code and active work, then publish an In progress claim with agent/thread, branch/worktree and scope.
2. Implement only assigned scope with local development fixtures and focused checks. Strong agents settle contracts and rewrite dependent Simple handoffs with actual files, symbols and fixtures.
3. Record Done with commit/PR, integration state, actual checks and remaining acceptance. Local-only, integrated and released are separate facts.
4. Update behavior documentation, publish owned changes and synchronize local task documents. Preserve others' files/statuses and report failed pushes.
5. Release agents run one canonical full pre-release flow and reuse passing evidence; failures get affected reruns only. Follow AGENTS.md for development isolation and project commands.

## Conventions

- Simple: bounded implementation under a settled contract. Report missing contracts before dependent work.
- Strong: schema/API, integration or orchestration judgment. Settle contracts before Simple handoff.
- Owner: named product decision or acceptance step. Fixture work can precede owner acceptance.
- Status starts with Planned, In progress, Needs decision, Done or Dropped. Follow with evidence or reason.
- Stable IDs, such as F1.1 or U1.2, survive version moves. Dependencies reference those IDs or an explicit owner policy.
- Every card states behavior, scope/files, dependencies, fixtures and Done when. Do not claim unrun checks or infer release readiness from Done counts.
- The dashboard parses existing files. No extra dashboard reporting or metadata is required.

## Index

| File | Scope |
| --- | --- |
| [{{INITIAL_VERSION}}]({{INITIAL_VERSION}}.md) | {{INITIAL_RELEASE_GOAL}} |
| [Later](later.md) | Unassigned work |
