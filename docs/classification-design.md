# Batched classification and exact assessment caching

Status: implemented in task-3 routing libraries; live platform/UI integration remains pending. See [implementation and handoff](routing-workstream.md). Hosted Jev remains the initial classifier. These changes reduce repeated calls without changing public-benchmark-only model selection or the application's hard constraints.

## Single batched request

One logical `TaskClassifier.assess` call evaluates all independent semantic questions against the same focused state:

- Task category (Choice).
- Complexity (Score or a bounded Choice mapped to the shared enum).
- Continuity: fresh selection, retain deployment, or retain through the tool cycle (Choice).

Each question is self-contained and must not reference the answer to another question in the batch. Explicit capabilities—image presence, tool schemas, output format and token capacity—come from request structure in code. The router maps the resulting task requirements to cached benchmark profiles and performs pricing/scoring arithmetic itself.

Use one TypeSafe HTTP request for this batch, not one request per question. A batch is within one application request, not a cross-user microbatch: do not hold incoming requests to collect other users' traffic. Version the complete question set and parsing/mapping rules together. Validate the complete response before caching it. Partial/malformed responses and transport failures follow the existing conservative fallback and are not cached as successful assessments.

The Jev adapter must have an explicit timeout and controlled retry policy. Record attempts separately; don't let SDK defaults introduce hidden retries. Enforce the remaining request deadline and budget before every paid attempt. Avoid duplicate inference dispatch after an uncertain network outcome.

## Exact assessment cache

Store only the validated semantic `Assessment`, never an eligible pool, award, bid, capacity reservation or spend authorization. Begin with a bounded cache interface and an in-process implementation for local testing. A production shared backing store is a platform integration choice; a process-local cache in Vercel is opportunistic and must not be presented as a guaranteed cross-instance hit rate.

Key an entry with a canonical digest containing:

- Application/tenant identity, established by trusted server authentication.
- Relevant request context: messages in order, tool definitions, requested output schema and semantic request fields.
- Session continuity facts: current deployment, unresolved tool call IDs and current deployment capability/configuration digest.
- Classifier identity and pinned model revision.
- Question/schema revision and preprocessing revision.

Exclude the per-request idempotency key so identical independent requests can hit; exclude credentials and raw identities from the persisted key. Preserve array order and exact text; sort object keys recursively for stable JSON. Do not normalize away whitespace or perform semantic similarity matching in this first version. Different session/tool context must miss even when the latest prompt text is identical.

Policy, catalog and price changes do not authorize reuse of a previously selected pool. If a future classification question consumes a policy/catalog field, that field's version must enter the key. Keep confidence gates outside the cached answer so current thresholds apply. Conservative fallback decisions are recalculated each time, not cached as if Jev produced them.

Implemented default limits: five-minute TTL, 256 local entries, explicit cache-off setting. Treat these as tunable implementation defaults. Do not extend TTL on reads. Keep payloads out of values and logs; cache only the digest plus typed assessment and timing/version metadata. Cache use and retention must respect the application's data-handling policy. Do not share across applications.

On a hit, revalidate current capabilities, quality evidence/freshness, endpoint availability, token/context limits, cost/latency constraints and remaining spend. Obtain a valid offer/reservation before execution. Expired bids can never become executable through a cache hit. Cache expiry must not be treated as model failure.

## Tool cycles and uncertainty

When a previous Jev decision established a tool-cycle lock, code may retain that lock until the tool cycle closes; it need not repeatedly classify unchanged continuity. Changes to required capabilities or explicit app policy still force revalidation. New semantic tasks and uncertain boundaries go through the normal classifier/cache path. A forced-fresh policy may reuse the semantic assessment but still requires a new auction.

On a miss with low confidence, keep a qualifying current deployment or use the configured conservative pool for a new task. A cache hit carrying low confidence follows the same rule; a hit is not proof of correctness. Do not cache outage placeholders, exceptions, aborted operations or application-specific fallback pools.

## Timings and accounting

Trace the decision source (`live`, `exact_cache`, or `tool_cycle_state`) and assessment model/question revision. Record key preparation, lookup, network/attempt durations, parsing, hit/miss, pool calculation and auction separately. Never describe cache lookup time as live Jev latency. Cache hits incur no new Jev usage; don't copy the original call's cost into the new request ledger.

Cached semantic results do not reserve money. Platform remains responsible for atomic paid-call budgets, including retries. Race suppression for identical concurrent misses is a later optimization; if introduced, charge the actual shared classification once and ensure cancellation by one caller does not cancel unrelated callers.

## Acceptance cases

- One adapter call includes task, complexity and continuity questions; no inter-question answer dependency.
- Identical authenticated app/context/revisions hit; differing app, message order, text, tool history, capability digest or revisions miss.
- Object property order alone does not change a key.
- Expired, malformed, aborted and failed assessments are not reused.
- TTL and capacity are bounded, eviction deterministic, cache disabled behavior clear.
- A cached assessment with changed catalog/prices still produces a newly checked pool; hard budget/availability constraints cannot be bypassed.
- All metrics distinguish hits from live calls and actual retry spend.

[TypeSafe's documented parallel primitives](https://docs.typesafe.ai/introduction) support the batched design. See [the classifier latency memo](classifier-latency.md) for vendor latency claims, deployment options and measurement cautions.
