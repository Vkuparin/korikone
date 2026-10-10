# Task lists

[roadmap.md](../roadmap.md) records release goals and decisions. Each version file here contains canonical implementation cards; [later.md](later.md) holds unassigned work. [roadmap-history.md](../roadmap-history.md) is historical evidence, not another status register.

## Taking a card

1. Read the assigned card, direct dependency contracts and relevant code. Do not load the entire backlog. Check `origin/main` and active work before claiming; status may lag code.
2. Mark In progress with agent/thread, branch/worktree and scope. Publish the claim so other agents can see it. Do not implement another agent's claimed card.
3. Use development fixtures at external boundaries and real validation/persistence/UI paths. Run focused checks and record their evidence; release agents trust passing coder checks. Pre-releases get one full validation flow, local or CI, under AGENTS.md. Fix failures with affected checks only, and keep packaged smoke checks small.
4. Mark Done with commit/PR, integration state, exact checks and remaining owner checks. Local-only, merged and released are different facts. Never claim unrun tests.
5. A Strong card establishing an API updates dependent cards with actual symbols, files, schemas and fixtures before Simple handoff. Proposed paths are suggestions, not existing-code claims.
6. Update behavior documentation when implementation changes it. Update roadmap summaries when release scope or decisions change; do not duplicate card statuses there.
7. Fetch/reconcile, publish changed docs to GitHub and synchronize local copies, preserving unrelated changes. Record unmerged branches explicitly. Report failed pushes.

## Conventions

- Simple: bounded work with a settled contract. If the contract is unresolved, report the missing decision to the PM before dependent implementation.
- Strong: design/schema/API judgment, unfamiliar integrations or cross-cutting orchestration. Split follow-ups after fixing the contract.
- Owner: decision or acceptance needing the owner. Technical fixture work can precede a named owner step.
- Status: Planned, In progress, Done, Dropped with reason, or Needs decision naming the gate. A decision blocks only its dependent work.
- Stable IDs survive version moves. Read a cross-version prerequisite contract/status rather than copying the card.
- Each card states behavior, file scope, dependencies, fixtures and Done when. A feature is complete only when its required cards are complete.
- Owner visual checks normally use development mode and zero AI requests. Request live acceptance only for behavior fixtures cannot establish, after focused checks pass and with request/retry usage stated.

## Index

| File | Scope |
| --- | --- |
| [0.2.x](0.2.x.md) | Alpha checks |
| [0.3.0](0.3.0.md) | Both chains |
| [0.4.0](0.4.0.md) | Smooth flow |
| [0.5.0](0.5.0.md) | Embedded stores |
| [0.6.0](0.6.0.md) | Design, appearance, Settings |
| [0.7.0](0.7.0.md) | Matching, prices, evaluation, pipeline |
| [0.8.0](0.8.0.md) | Edits |
| [0.9.0](0.9.0.md) | Purchases, memory, repetition |
| [0.10.0](0.10.0.md) | Calendar, recipes, exports |
| [0.11.0](0.11.0.md) | Beta gates |
| [Later](later.md) | Unassigned work |
