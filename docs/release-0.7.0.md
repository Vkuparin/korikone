# v0.7.0 release preparation

In progress, 12 October 2026. PM release agent, branch codex/release-v0.7.0, isolated managed checkout. Scope: reconcile completed cards, version manifests, finish one canonical validation flow, package, small smoke check, publish unsigned Windows pre-release and synchronize roadmap/task evidence.

All 42 F4/F5/F15/F16 cards are recorded Done on main; exact counts are verified before publication. Source candidate: caa123034dfbfb74f3d8cc9acbc5eef8e4a46145. Existing CI run 38175606384 passed build and 574 unit tests, failing only the old pack-size selection assertion. The corrected focused case passes; metadata is 0.7.0, local build/typecheck and formatting pass. A single local desktop flow is running with two workers and isolated development fixtures; no live AI or retailer calls. Packaging, smoke and publication are not yet complete.

R1.1 owns preventing automatic repeated full runs. Stable-release installer/signing/household gates remain separate.
