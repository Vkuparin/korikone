# v0.7.0 release preparation

In progress, 12 October 2026. PM release agent, branch codex/release-v0.7.0, isolated managed checkout. Scope: reconcile completed cards, version manifests, finish one canonical validation flow, package, small smoke check, publish unsigned Windows pre-release and synchronize roadmap/task evidence.

All 42 F4/F5/F15/F16 cards are Done on main. The integrated candidate was caa123034dfbfb74f3d8cc9acbc5eef8e4a46145. CI run 38175606384 passed build and 574 unit tests, failing one old pack-size selection assertion. Its corrected focused case passed, followed by the affected persistence file in green CI run 38176422170. Version metadata is 0.7.0.

The single full source desktop run reported 83 passed and 21 failed out of 104. Only failed/affected checks were rerun. Most failures were old phase text, selection labels, unsupported synthetic quantities or transfer-count assumptions. Two application fixes preserve unresolved matching explanations after restart and connect planShopping usage-limit failures to the AI settings/error UI. Affected quote tests: 12 passed. Targeted Settings, cancellation, keyboard, preference, pack-size and retailer-handoff checks now pass. Remaining interface variants are still running; full desktop acceptance is not yet claimed.

Build/typecheck and formatting passed. The rebuilt installer reuses verified output; all eight dist files match app.asar. Packaged launch/version, one note-to-list update and restart passed using an isolated development profile: version 0.7.0, three saved rows, one fixture inference request, zero retailer writes, and no new inference/catalogue reads on restart. The smoke comparison normalizes omitted undefined fields to match persisted JSON.

Packaging and smoke are complete; tagging/publication are pending. No live AI/retailer calls or private receipts were used. R1.1 prevents automatic repeated full runs. Stable-release installer/signing/household gates remain separate.
