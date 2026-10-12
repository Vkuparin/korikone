# v0.8.0 release preparation

In progress, 12 October 2026. PM release agent on codex/release-v0.8.0, reusing the isolated managed release checkout. Scope: reconcile completed cards, update version metadata, run one canonical local release flow, package from that build, perform a small packaged smoke, publish the unsigned Windows pre-release and synchronize local roadmap/tasks with GitHub.

Candidate: 3b6458039dbe80e3385ae6caa2f51de2909a57a5. All 21 Done cards and the justified U19.3 drop are integrated on main; their older branch-status notes are historical. Coder-focused checks and green fast CI 38208403933 are recorded evidence; the full release suites were skipped in that CI run and are not claimed as run.

Canonical local checks: build, formatting, unit and desktop once. Only failed or affected checks will be rerun. All use development fixtures and isolated test profiles, with no live AI or retailer accounts. Publication and packaged validation are pending.

Phone QR scanning, chain-accent visual acceptance and live interpretation/retailer-return checks remain unrun owner checks. They are recorded separately from the fixture-tested pre-release. Stable installer, signing and household gates remain open.
