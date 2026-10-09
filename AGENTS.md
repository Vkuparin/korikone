# Development and testing

Use development mode for implementation, debugging, automated tests and UI checks. Enable **Settings > Development mode**, or launch with `KORIKONE_DEVELOPMENT=1`. Use a temporary `KORIKONE_TEST_DATA` directory for automated Electron tests; this forces development mode and prevents turning it off.

Do not use the owner's ChatGPT allowance or retailer accounts for routine testing. Do not disable development mode or make live AI requests unless the user specifically asks for live testing. Request a live acceptance check only after the feature is implemented and its fixture tests pass. Explain the remaining live behavior to verify and the expected ChatGPT usage before asking.

Every feature must be testable with local fixtures. Add success and relevant failure cases at the external boundary, then exercise the real application validation, persistence and UI paths. Do not replace app IPC handlers to cover behavior already supported by development mode. Mock network responses for protocol and adapter unit tests; never contact live accounts. Keep fixtures deterministic and extend them when adding supported foods or workflows.

Use focused unit tests for each task or feature. Select the affected files or test names, for example `npm test -- tests/receipts.test.ts` or `npm test -- tests/development.test.ts -t "multi-dish"`. Run a focused UI test only when the change needs application or interaction coverage, for example `npm run test:ui -- tests/ui/shopping.spec.ts -g "cancellation"`. Use type checking, builds and formatting checks when relevant to the change. Do not broaden passing checks without a new failure, change or unresolved concern.

Run full unit and desktop suites only when preparing a release. Release preparation requires `npm test`, `npm run test:ui`, `npm run build` and `npm run format:check`, plus the relevant packaged-app checks. Routine implementation, debugging and feature completion do not authorize a full-suite run.

Local file dialogs may be stubbed to select test files. Receipt parsing, backup import/export, diagnostics and clipboard operations stay real and local in development mode.

# Writing preferences

Use plain, concrete language. Apply the unslop skill when writing or editing prose. Preserve meaning, technical accuracy, literal content and requested formatting.
