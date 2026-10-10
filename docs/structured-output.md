# Structured output on the current ChatGPT route

F16.7 audit, 10 October 2026. Application source baseline `62abf52`; branch `codex/v0.7.0-strong`. No live inference, model change, paid key or account access was used. Official pages were fetched during this audit.

## Interface evidence

The ChatGPT-plan documentation specifies account-scoped model discovery at `GET https://api.openai.com/v1/models`, selected model slugs, and OAuth inference at `POST https://api.openai.com/v1/responses`. Each HTTP request uses array `input`, `store: false` and `stream: true`. Success requires completed inference; partial text is insufficient. [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)

The route-specific limitations reject several general API fields, including `max_output_tokens`, `temperature`, `metadata`, `prompt` and persistent HTTP continuation. They do not explicitly document JSON-schema output. Absence from that rejection list is not a positive capability guarantee. [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

The general Responses guide documents `text.format` with type `json_schema`, schema, name and strictness, and distinguishes schema adherence from plain JSON mode. This supports a candidate request shape for a future compatible provider; it does not independently establish that the ChatGPT-plan route accepts it for the selected account/model. [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)

Audit conclusion: explicit route evidence confirms the existing streamed text request. Native schema output remains unconfirmed for this app route. Keep the functional prompt/JSON/Zod path; never send an exploratory schema request automatically or retry with different billing/provider/model. This is the implementation choice derived from the evidence above, not an official statement that native schema is unavailable everywhere.

## Actual source and protocol fixtures

`src/ai/protocol.ts` exports `chatGPTOutputModes = ["text"]`. `responseRequest(model, input, output = { mode: "text" })` returns exactly model, user-message input, store false and stream true. A json-schema output request fails locally as neutral `InferenceError("unsupportedCapability")`, distinct from invalidDraft. It adds no token-limit or other unconfirmed fields.

`ChatGPT.models` preserves displayed catalogue ordering and slugs. `ChatGPT.generate` uses `responseRequest`, sends OAuth through the existing connection and waits for `completedText`. The latter bounds accumulated text to 100,000 characters and pending SSE data to 1,000,000; it requires completion and propagates incomplete/usage/cancel errors. Task prompts and semantic validators live in `draft.ts`, separate from the wire parser.

`tests/ai-protocol.test.ts` checks the exact request shape, native-output rejection before any wire request, completed text followed by real JSON/domain validation, malformed quantities/references, partial/incomplete/usage-failed streams and cancellation. These mocked fixtures demonstrate local behavior, not server acceptance of an untested field. Existing `tests/ai.test.ts` keeps one schema repair for malformed draft output and no retry for provider/usage/cancel errors.

## Versioned schema and dependent contracts

F16.17 creates actual shared task IDs `shopping-draft` v1 and `recipe-import` v1 in `src/ai/tasks.ts`, using the existing provider-neutral `InferenceTask` type. Its ChatGPT adapter advertises only the evidenced text output mode from `chatGPTOutputModes`. Authentication remains in `ChatGPT`; tasks never import it. Model discovery does not currently supply a verified per-model native-schema capability, so do not guess from model names.

F16.8 creates `src/ai/output.ts` to select output mode within the already pinned `InferenceSession` and validate task results. Text capability uses existing draft/recipe prompts, JSON parsing and Zod/semantic validation. A deterministic alternative adapter may advertise native schema for fixtures; that path carries a versioned task-owned wire schema named `shopping_draft_v1` or `recipe_import_v1`. Only advertise it for a provider whose implementation supports it. A rejected unsupported schema is terminal; never make a second request that silently switches formats or adapters. The existing interpretation-schema repair remains at most one within the operation call count. Resolver gets none.

Native schema shape cannot substitute for domain checks: saved/new recipe references, identity remapping, integer units, source provenance, exclusions and coverage still need validation. Do not blindly serialize Zod defaults/refinements as a strict native wire schema. Optional fields and provider schema-subset limitations need an explicit wire representation and tests. Prompt fallback remains a full supported path, not an error recovery switch after a failed native request.

F16.9 pins provider/model/capabilities and a maximum-three session for interpretation, at most one interpretation repair and at most one resolver. Transport usage/incomplete/cancel errors never reach invalidDraft repair. Protocol deltas are not validated planning events.

## Optional future live compatibility check

No live check is needed to continue the supported text implementation. To enable native schema on ChatGPT later, first implement its isolated request shape and mocked success/rejection/completion fixtures, then request a separately authorized compatibility check. Use one tiny synthetic request with a two-field strict schema, the owner's explicitly selected available model, store false and streaming. Cap: one inference request, zero retries, zero resolver/retailer writes. A failed/unsupported result leaves native capability disabled. This would consume one ChatGPT-plan inference request; do not infer a token/credit price from model names or promise a specific allowance cost.

Focused audit checks: `npm test -- tests/ai-protocol.test.ts tests/ai.test.ts` (15 passed), typecheck and changed-file formatting/diff checks. UI, full release tests and live compatibility were not run for this protocol audit.
