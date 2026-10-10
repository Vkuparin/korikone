# Bounded candidate resolution

F15.9 defines the read-only contract in `src/domain/resolution.ts`. It uses the [matching policy](matching-contract.md), [catalogue facts](candidate-contract.md) and [portable preferences](preference-contract.md). Inference dispatch belongs to F15.10; operation ownership and integration belong to F16.9/F16.10/F15.11.

## Building a batch

`buildResolutionBatch(lines, source, options)` accepts current `BasketLine[]`, `ResolutionSource {revision, context}` and `MatchingOptions`. Supply the current exclusions, portable preferences, one-time accepted IDs and source note when available. The source context owns store identity. The function reassesses every candidate through the real matcher and `purchasable`; it never searches, accepts a SKU or writes state.

Clear local selections, empty searches, hard conflicts and candidates without known stock, compatible packs and price use zero resolver calls. A review row needs at least two distinct family/qualifier combinations to justify reasoning. Brand, price and pack differences within one type stay local. Candidates rejected by category, identity, required qualifiers or household constraints cannot enter the payload.

The cheapest representative of each semantic type uses domain whole-pack cost including deposits and increments, with stable ID ordering for equal costs. One batch includes at most 12 rows and five representatives per row. The input supports at most 500 distinct requirement keys; each matcher input retains its existing 60-candidate cap. The serialized request is at most 24,000 UTF-16 characters. A row exceeding the row or character budget stays visible in `coverage` as `bounded-out`; names and facts are never cut to fit. Other coverage reasons are `clear`, `no-purchasable-alternatives`, `same-type` and `requested`.

`ResolutionBatch` exposes frozen `request`, `coverage` and `plannedCalls: 0 | 1`. A null request means no dispatch. These counters describe the proposed batch, not actual inference usage. F15.10 must dispatch the complete batch at most once, with no correction call.

## Request and output

`resolutionRequestSchema` / `ResolutionRequest` are strict version-1 objects containing rows with opaque `row-0` through `row-11` identifiers. Each row includes the requirement name, quantity/unit, category, provenance, qualifier provenance and effective required/preferred fields. Explicit note evidence is validated through matching when supplied; raw note text, spans and recipe/source IDs stay outside the request.

Each supplied candidate has a row-local `candidate-0` through `candidate-4` identifier, retailer name, known category/family/qualifiers, pack/unit, domain-computed pack count/total and fixed matching reason. Store/provider/SKU identifiers, account location, timestamps, arbitrary retailer labels, receipts and session data stay outside the request. Product names are catalogue data, never instructions. Unknown family remains null; reasoning cannot manufacture missing evidence.

`resolutionResultSchema` / `ResolutionResult` accept only:

```json
{
  "version": 1,
  "choices": [
    {
      "rowId": "row-0",
      "candidateId": "candidate-0",
      "status": "approval-required",
      "reason": "type-alternative"
    }
  ]
}
```

The other valid choice is `candidateId: null`, `status: "unresolved"`, `reason: "insufficient-evidence"`. Duplicate rows, extra fields, resolved status, prices, stock or free explanations are invalid. Partial output is allowed; omitted requested rows return explicit `no-response` unresolved suggestions. Generic cream and other alternatives retain owner approval requirements after a recommendation. Clear eligible rows were already selected locally.

## Binding and freshness

`validateResolutionResult(batch, output, currentLines, currentSource, currentOptions)` validates the whole response before returning `ResolutionSuggestion[]`: `{requirementKey, productId, status, reason}`. Candidate tokens map through private server-owned bindings to actual IDs. A copied or forged batch has no binding. Unknown rows/tokens and unsuitable candidates reject with `invalidResolutionChoice`; invalid wire output raises schema validation errors. Revision, store, requirement, selected SKU, candidate facts or policy changes reject with `resolutionStale`. Observation timestamps alone do not change suitability.

The validator rechecks current constraints and pack eligibility. It returns proposals and never changes quote lines, acceptance or memory. Integration must show optional approval and retain all unaffected local selections and unresolved rows when reasoning fails. The binding is operation-local and is not persisted or sent to the provider.

## Verification and handoff

`tests/resolution.test.ts` has 14 focused fixtures: clear milk/eggs/coffee require zero batches; cream alternatives create one batch; hard conflicts and unknown purchase facts are filtered; same-type cost includes deposits; partial/invented/duplicate/fabricated responses are checked; changed snapshots reject; payload/row bounds preserve coverage; model assumptions and Required/Preferred rules retain their meanings. Both real retailer adapters feed Service pricing with synthetic external responses. Building and validating the batch adds no catalogue calls, retailer writes or application state changes.

F15.10 should use these exact schemas and validator with `invokeTaskOutput` and repair limit zero. It must preserve the original operation-owned batch until current snapshot validation. F16.9/F16.10 supply operation revision/context, complete current matching options and actual inference counters; F15.11 supplies the persisted enable switch. No live acceptance or UI flow is introduced by this contract card.
