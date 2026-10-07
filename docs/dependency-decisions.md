# Prototype dependency decisions

## K-Ruoka

Use the Apache-2.0 `nikosavola/k-ruoka-mcp` Windows binary from release `v0.1.3`, source revision `558a22e526057f35c7804081a77c19659cc3e671`.

- Release wheel SHA-256: `2bda8fd257286da6554b65375d0fa878211ffc8b48f13e5c6d2d1365276c09db`.
- Extracted executable SHA-256: `6b662fbe702dfea353689c7f7042c53a417f426e58e255d33aedb44f52392f2d`.
- License copied from the release wheel into `vendor/k-ruoka/LICENSE`.
- `scripts/prepare-worker.mjs` checks the release archive before extraction. Runtime checks the executable checksum, reported version and required tool names before operations.
- The real stdio handshake and tool listing passed on Windows on 8 October 2026.
- Upstream manages a separate Chrome profile. Korikone sets its path under local application data and detects installed Chrome. No Python, Rust or MCP setup is needed by the user.
- The adapter allows only catalogue, login, cart read and absolute quantity tools. No bulk clear or checkout command is exposed.
- Products expose normal prices and availability but lack structured pack sizes, deposits and dietary attributes. Pack labels are parsed conservatively. Weighted prices and ambiguous pack labels remain unresolved. Product acceptance must include checking the pack label and dietary suitability. Prices are estimates, with fees and any unreported deposits unresolved until store checkout.
- Same-profile checkout handoff closes the worker and launches Chrome against that profile. Live account continuity remains an acceptance check; it is not established by the protocol test.

## ChatGPT

The official DevKit examined at `0a36fefeb913055c8c7a1a29b63d82b96b2e841a` uses the Sign-in with ChatGPT DevKit Noncommercial License 1.0. Korikone does not copy or bundle it. Investigate an independently authored implementation of the documented local-app protocol to preserve the project's Apache-2.0 licensing. Official sign-in and inference have not yet been tested in Korikone.

## Release status

The first Windows NSIS installer build succeeded. It is an unsigned development prototype, not a signed consumer release. Live login, live cart mutation, clean-machine installation and household usability sessions remain unverified.

Live read-only catalogue smoke passed on 8 October 2026: the adapter found Ruoholahti and normalized 20 pasta search results from that branch. No account login or cart mutation was performed.
