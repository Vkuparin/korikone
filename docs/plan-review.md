# Alternate-plan review and accepted direction

Accepted 8 October 2026. This records the comparison of [alt_plan.md](alt_plan.md) with the current design. The implementation baseline is [design.md](design.md), supported by the [implementation plan](implementation-plan.md), [UX specification](ux.md), [integration decisions](integrations.md) and [S-kaupat prerequisite plan](s-kaupat-mcp-plan.md).

## Decision

Keep the current plan as the foundation and merge selected ideas from the alternate proposal. Korikone is an easy-to-install, locally running, open-source AI grocery helper for non-technical users. Judge implementation choices by the installation, weekly shopping and recovery experience they produce. Architecture alone does not demonstrate usability.

The most useful alternate idea is continuity with the shopper's existing browser session. The current plan had made a dedicated session the default without enough evidence about login and checkout handoff. Compare both approaches before committing the S-kaupat implementation. This remains an experiment, not a decision to require an extension.

## Decisions by topic

| Topic | Accepted direction | Reason and comment |
|---|---|---|
| Installation | Target one user-facing installation with packaged dependencies | Users should not install development tools or configure workers. Require an extension only if a tested benefit justifies the extra setup. |
| Browser session | Compare managed session and minimal extension during S-kaupat S0 | Existing-session reuse could simplify login and checkout, but authenticated access and recovery need proof. |
| Desktop shell | Keep Electron/React/TypeScript as the working default | Avoid a planned framework rewrite. Reconsider Tauri only with evidence from the complete packaged application and a deliberate decision about maintaining Rust. |
| AI runtime | Start with the small application-owned workflow behind an AI provider interface | Meal interpretation needs less machinery than a general coding agent. Do not implement several runtimes or plan to replace the first one. |
| Cart actions | Application code applies one approved batch and verifies it | Preserve exact targets, context binding, journaling and reconciliation. The model does not get unrestricted mutation tools. |
| S-kaupat ownership | Separate project, built and released before Korikone store integration | Keep retailer maintenance and release artifacts reusable outside Korikone. Any required browser bridge belongs to that independent integration. |
| K-Ruoka reuse | Keep conditional upstream reuse | A different S-kaupat transport is not sufficient reason to rewrite K-Ruoka. Validate both user flows. |
| Demo journey | Build the complete fake-store workflow early | A user can test planning, matching, review and recovery before real shopping data is involved. |
| Product preferences | Separate hard constraints and soft preferences | A low price cannot override a dietary requirement, pinned brand or prohibition on substitutions. |
| Price selection | Compare the actual cost of enough packs | Lower unit price can still mean greater spending for this week's requirement. Display surplus; defer speculative waste penalties. |
| Pantry | Explicit exclusions and recurring staples | Inventory maintenance adds work for the user. Do not make inferred stock authoritative. |
| Component boundaries | Use modules first; extract packages when justified | The original package tree was too easy to read as mandatory scaffolding. Keep responsibilities clear without creating unnecessary build boundaries. |
| Compatibility | Validate schema/protocol ranges and capabilities before operations | Pinned artifacts still need compatibility checks, particularly if an extension can update independently. |
| Languages and retailers | Both chains; Finnish default and English selectable immediately | These accepted requirements are missing or optional in the alternate proposal and remain mandatory for the complete release. |

## Browser experiment

S-kaupat S0 compares two small working flows with an owned test account: a dedicated managed browser session and a minimal extension using the normal browser session. Test installation, first/returning login, selected account and branch, cart changes, browser restart, interrupted operations and reaching the same cart for manual checkout. Record user interventions and recovery outcomes. Prefer the simpler reliable experience; do not decide by download size alone.

An extension requires a concrete native-host installation and lifecycle design. Chrome launches a registered host and restricts native messaging to extension contexts; it is not a transparent link from page code to an existing MCP process. The implementation must validate senders and messages and define process connection, shutdown and reconnection. [Chrome native messaging documentation](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).

Host permissions also do not establish that every authenticated retailer request will work in the chosen extension context. Verify the necessary requests or DOM actions, account binding and failure behavior. [Chrome network request documentation](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).

If the extension wins, keep fixed retailer commands, narrowly scoped access and no side panel. Its native helper and bridge must work without Korikone so s-kaupat-mcp remains independent. If the managed session wins, prove that disconnecting automation leaves a usable human-controlled cart window. Do not copy session cookies into another browser as a handoff shortcut. Ship one selected S-kaupat approach initially.

The choice must also work alongside the K-Ruoka integration. Different internal transports can be acceptable, but users should not have to understand them. Test combined onboarding and the weekly flow across both chains.

## Framework and runtime comments

Tauri and browser-extension access are separate decisions. Either desktop shell can use a local worker or an extension bridge. Tauri supports external binaries, and Windows distribution needs a WebView2 installation strategy. Evaluate installed size, startup, memory, helper processes, updates and maintenance for the complete application. There is no evidence yet that changing shells improves Korikone's user experience. [Tauri external binaries](https://v2.tauri.app/develop/sidecar/), [Windows installer](https://v2.tauri.app/distribute/windows-installer/).

Codex app-server is a supported integration option, but the documented plan-usage setup still leaves token renewal with the application and requires restarting the child process with the renewed token. Its availability is not a reason to add a general agent runtime to a workflow that can use validated meal drafts and ordinary shopping code. Reconsider it only if a working comparison reduces total work, including packaging and recovery. [Official OpenAI documentation](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server).

## Corrections to the original current plan

- Treat same-cart login and checkout continuity as a first-class acceptance test, not a final browser-opening detail.
- Treat the package tree as a responsibility map. Start with modules in one application workspace.
- Group new recipes and portion questions into plan review; group unresolved products into basket review. One transfer approval covers the exact displayed batch.
- Change `cheapest` from lowest unit price to the lowest purchase cost sufficient for the required quantity among accepted eligible candidates. Show both unit price and surplus; do not claim globally optimal baskets.
- Define component compatibility and failure behavior explicitly, including any independently updated extension.
- Preserve recoverable writes, data migrations, both retailers and live language switching. These support ordinary users and are not optional late hardening.

## Deferred or rejected alternate scope

Do not build a second extension interface, a combined Korikone-specific store server, several AI runtimes, inferred pantry inventory or speculative waste scoring for v1. A public higher-level Korikone MCP interface can wait until there is a concrete user need. Delivery-slot discovery remains a capability to establish, not a method every retailer must pretend to support.

The alternate proposal allows automatic cart mutation before review and puts several recovery mechanisms in a late hardening phase. Keep review before mutation and implement the journal/reconciliation behavior with the first real transfer. Preserve existing cart items and avoid bulk clearing. Manual checkout remains permanent; opening the verified cart is an explicit user action.

## Next milestone

Build the independent S-kaupat project's S0 comparison, select the browser approach, then release its minimum reliable client/MCP integration with packaging and compatibility information. Korikone UI prototyping and the ChatGPT proof can proceed independently. Full store integration consumes the resulting pinned release.

These decisions are based on document and platform review. No live retailer experiment, extension prototype or framework benchmark has been performed as part of this review.
