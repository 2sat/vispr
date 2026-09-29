# Routing invocations by source

App builders can pretag a call with `source`, or bind a source once to an SDK client used by a component/agent step. The server maps that exact, case-sensitive label to a named pool owned by the authenticated application. Untagged calls retain ordinary routing. Tags are explicit metadata, never inferred from prompt text.

```ts
import { withSource } from '@vispr/sdk';

// client is your configured VisprClient transport.
const design = withSource(client, 'design.preview');
const events = design.stream(request);
// Equivalent per invocation: client.stream({ ...request, source: 'design.preview' });
```

The wrapper fixes the source for that client even if the request contains another tag. It does not mutate the request; cancellation/options pass through. Use the original client for other sources.

Configure named pools by bands; explicit model lists are optional:

```ts
import { SourceRoutingSchema } from '@vispr/contracts';

const sourceRouting = SourceRoutingSchema.parse({
  pools: [{
    id: 'interactive-design',
    criteria: {
      latencyMs: { max: 2000 },
      estimatedCostMicros: { max: 20000 }, // $0.02 per inference request
      benchmarks: [
        { benchmark: 'ui-quality', version: 'v1', minimum: 0, maximum: 100,
          higherIsBetter: true, minimumNormalizedScore: 0.8 },
        { benchmark: 'code-correctness', version: 'v1', minimum: 0, maximum: 100,
          higherIsBetter: true, minimumNormalizedScore: 0.7 },
      ],
      requiredCapabilities: ['tools'],
    },
  }],
  bindings: [{ source: 'design.preview', poolId: 'interactive-design' }],
});
// Platform supplies this app-owned config to routeRequest({ ...input, sourceRouting }).
```

The benchmark names, versions and thresholds above are illustrative, not claims about public benchmark results. Use catalog benchmark IDs and documented normalization ranges. The primary user-facing dimensions are **latency**, **inference ability (N benchmark dimensions)**, and **task capacity (cost)**. Cost is an estimate for this request's input and maximum output, in micro-USD. Latency currently means estimated completion time, not time to first token. A $1 task budget at $0.02/request supports roughly 50 such inferences before classifier/other charges; actual accounting still governs admission.

Bands support inclusive `min` and/or `max` bounds. Each benchmark has its own normalized score interval (`minimumNormalizedScore`, `maximumNormalizedScore`), version, range and direction. A higher normalized score always means better performance, including lower-is-better raw benchmarks. Source benchmark requirements demand fresh measured evidence; missing or proxy evidence cannot satisfy them. Context/output capacity bands and required tools/vision/structured output/streaming are additional capability checks, distinct from the user's cost meaning of task capacity.

Criteria resolve dynamically across all authorized active hosted/self-hosted deployments. Adding `deploymentIds` restricts that universe further; list-only pools remain supported. Multiple sources may share one pool. A source has exactly one binding. Labels are 1–100 characters using letters, digits, dots, underscores, colons, slashes and hyphens, beginning with a letter or digit. Empty pool definitions, duplicate IDs/bindings/axes and dangling pool references are invalid. Unused pools/bindings lists may be empty.

## Independent benchmark dimensions

Selection exposes `benchmarkAxes` per candidate, retaining each benchmark/version, normalized value, evidence type, source URL and retrieval time. Missing evidence is null rather than zero. The relevant task profile plus source requirements determines which N benchmark axes participate. Unrelated catalog benchmarks do not automatically become requirements for every task.

Pareto comparison operates on the N separate benchmark coordinates plus cost, latency and uncertainty. To dominate, a model must be no worse on every coordinate and strictly better on at least one. Better coding cannot compensate for worse reasoning in this comparison. Proxy or missing coordinates cannot prove dominance. Dynamic source criteria default to Pareto filtering; the integration can explicitly override the selection option.

The existing weighted quality score remains an explicit application preference for ordering the surviving frontier and applying pool-size/score-band limits. The legacy policy minimum-quality setting still applies as an additional aggregate gate. Neither replaces the independent source benchmark bands. A bounded pool may still discard a tradeoff according to those configured preferences; it must not label that exclusion as Pareto dominance. Source and task rules for the same benchmark intersect their bands; conflicting normalization or disjoint bounds fail configuration.

## Behavior

The configured pool is a hard candidate boundary applied on every routing path, including continuity. Jev still assesses task/complexity/continuity; evidence, cost, latency, capability and budget checks may narrow the pool further. This feature does not skip classification or force an otherwise ineligible model. Normal bids select among the remaining candidates.

Unknown tagged sources fail before a paid classifier attempt, including when no source-routing config exists. Missing/disabled pool deployments never trigger expansion into other pools. A conservative fallback intersects the selected pool. A retained model or established tool lock outside it cannot override the boundary. If no candidate qualifies, platform returns the existing `NO_ELIGIBLE_MODELS` response rather than silently widening selection.

Exact assessment cache keys include the source. Pool membership is reapplied on each request, so changing the app config does not reuse an old candidate set even on a semantic cache hit. The route result exposes `sourcePool: { source, poolId }` (or null) for integration traces. Source metadata is not sent to auction participants and is not inserted into the Jev prompt.

## Platform/UI handoff

This change adds an optional request field and exported configuration schema, plus a client wrapper and server routing enforcement. Existing untagged requests still validate. Deploy server contract support before clients begin sending source tags. The SDK transport and HTTP route remain platform work; forward the new field through request validation. Include it in request idempotency fingerprints so the same key cannot silently replay a request from another source.

Load mappings server-side under the authenticated app; never accept request-supplied pool definitions or use a source tag as authorization. Restrict the catalog to authorized offerings before routing. Persist mappings through the app configuration service and revalidate pool membership and current bands in atomic award/retention transactions. Pass resolved `poolCriteria` into `evaluateOffer` so bid price and latency cannot escape the source bands; refresh benchmark/capability evidence before awarding. Product UI should expose source presets with a latency band, task-capacity/cost band, and repeatable inference-benchmark rows (version, direction, minimum/maximum score), with capability checks and optional deployment allowlist in advanced settings; that editor and API persistence are not implemented here. Map `SourceRoutingError` to `INVALID_REQUEST` and record the selected source/pool in traces without exposing prompt payloads.

Shared-contract and SDK changes are additive and need integration-owner coordination alongside the routing changes. No database migration or new vendor is needed for the library feature.
