# Routing and auctions: implementation and handoff

Branch: `work/routing`. Changes are confined to the routing/auction packages and design documents. Shared contract and database ownership remain unchanged.

## Implemented

- Deterministic eligibility filtering for active endpoints, streaming, images, tool history/definitions, structured output, context capacity and output limits.
- Explicit task/benchmark profiles with benchmark version, normalization direction/range, weight and optional required minimum. Only matching fresh observations are used. Proxy evidence cannot satisfy required measured thresholds.
- Incomplete optional coverage requires the application toggle and contributes an uncertainty penalty. Entirely absent evidence cannot establish minimum quality.
- Fresh endpoint-specific cost/latency inputs. Cost estimates use integer micro-USD arithmetic and round up; remaining request budget includes the allowance left after classification.
- Fixed policy-bound utilities with an exposed quality/cost/latency/uncertainty breakdown. Deterministic pool-size cap and exclusion reasons.
- Continuity decisions for explicit app settings, established tool locks, Jev judgment, uncertainty and unavailable classification. An ineligible current endpoint cannot be retained.
- One hosted Jev HTTP request for independent task, complexity and continuity choices, with a pinned model and versioned questions/preprocessing. Strict response validation, explicit timeout, no implicit retries, and required per-attempt spend authorization/accounting hooks.
- Tenant-scoped exact assessment cache: SHA-256 canonical keys, five-minute TTL, 256-entry LRU defaults, cache-off setting, revision checks, defensive copies and cancellation. Failed/corrupt stores degrade to a live assessment. Cached results never authorize an award or spend.
- `routeRequest` orchestrates classification/cache, fresh budget checks, named conservative pools and continuity. Only a matching tool result with a qualifying current deployment can reuse an established tool-cycle decision. Ledger/configuration failures propagate rather than becoming outage fallbacks.
- Optional Pareto filtering and score bands in selection context, followed by deterministic pool limits.
- Concurrent auction collection with deadline/cancellation enforcement even when an adapter ignores abort, dark/workload invitations, fixed/capacity/discount simulated strategies, and fresh offer cost/latency scoring.
- Bid shape, invitation membership, auction identity, expiry and server-receipt deadline validation. Participant timestamps cannot backdate a bid. Deterministic ranking with duplicate and invalid-score checks.

## Integration contracts

`selectCandidates` takes the shared request, policy, assessment and catalog plus explicit context supplied by catalog/platform: benchmark profiles, endpoint metrics, token estimator, freshness windows, current time and remaining budget. No prices are fabricated. `createPoolSelector` adapts this function to the existing shared package interface; retain the richer `score` breakdown when producing trace details.

Current estimates assume the provided input/output rates describe the serving configuration fully. Endpoints with extra unbounded reasoning/cache/tool charges must be excluded or supplied a conservative bound by platform. This module does not enforce a billing ledger or guarantee a vendor bill.

`collectAuction` accepts authenticated participant-to-deployment registrations, passes only an invitation to each bidder, validates replies using server receipt time, and invokes a required `evaluate` callback before ranking. Use `evaluateOffer` with current candidate quality, observed latency, token estimates and remaining budget. A bidder's optimistic latency claim cannot override slower observed latency. Simulated reservation tokens are explicitly non-binding; platform must atomically reserve real capacity/spend and persist the award before dispatch.

## Integration order and ownership

1. Platform authenticates the application/session, validates policy ownership, and loads current catalog/metrics and session state. Never accept a client-supplied tenant identity, capability digest or tool lock as authoritative.
2. Construct a server-side `JevClassifier` with an exact model version, API key, `authorizeAttempt` and `recordAttempt`. The authorization callback must atomically reserve a conservative classification cost, respect cancellation/deadlines, and reject insufficient budget. The accounting callback must reconcile successful usage and retain uncertain charges. Callback errors stop routing. Default is one attempt; explicitly enabled retries apply only to HTTP 429/529 and each needs authorization.
3. Wrap it in `AssessmentService` and `MemoryAssessmentCache`, then call `routeRequest`. Supply a fresh `remainingBudget` callback, benchmark profiles, current endpoint metrics, a trusted capability/configuration digest and a named conservative deployment list. The classifier/cache code uses Node crypto and belongs in the server runtime. The cache is opportunistic per process on Vercel; shared storage remains a platform choice.
4. For a new auction, map eligible deployments to authorized registrations and call `collectAuction`, supplying current-policy offer evaluation. For continuity, platform must still acquire a valid offer/reservation for the retained deployment. Recheck expiry, endpoint state, funds and capacity in the atomic award transaction; routing results do not confer execution authority.
5. Platform persists session/tool-cycle state, translates result/attempt timings into shared traces and dispatches the awarded endpoint. UI consumes those events and exposes cache/frontier settings when shared configuration is wired.

The routing package includes local options without changing shared policy or trace schemas. New persisted/API/UI configuration fields belong to the platform contract owner. No paid API call, durable session store, ledger transaction, API handler or UI integration is claimed complete by this workstream.

## Design and build sequence

The completed sequence was: batched adapter and attempt accounting; exact cache and isolation; route orchestration and conservative continuity; Pareto/score-band selection; concurrent simulated bidding and post-bid utility checks; failure/cancellation tests and handoff documentation. Product choices were already settled, so no additional question batch was required. Internal quality evaluations, semantic similarity caching and concurrent-miss coalescing remain deferred.

## Verification

`pnpm check` passed: all workspace typechecks, 65 core tests and the production build. `pnpm --filter @vispr/web test` passed all five UI tests. Coverage includes batching and malformed response validation, retry accounting, timeout/cancellation, cache isolation/revisions/TTL/LRU, post-cache eligibility checks, tool-cycle boundaries, conservative fallback, Pareto/score bands, price floors, hanging/late bidders, invitation mutation, bid expiry and final offer constraints. Existing capability/evidence/budget and database foundation tests also pass.

Jev HTTP behavior is verified with controlled responses, not paid live calls. Hosted credentials, measured classifier latency, real endpoint execution and database award concurrency must be verified by the platform integration workstream before the demo is represented as live end to end.

## Invocation source presets

Implemented in the contracts/SDK/routing libraries: optional source tags map to app-owned named model pools, with exact-match validation and hard pool boundaries across cache hits, continuity and conservative fallback. Jev still classifies within the boundary; all hard constraints apply. See [source routing](source-routing.md) for configuration, SDK examples, validation and the platform/UI handoff. Durable configuration, HTTP transport and a Sources settings editor remain integration work.

### Dynamic pool dimensions

Source presets now accept inclusive latency and task-capacity/cost bands plus N independent inference-benchmark score bands. Model/deployment lists are optional restrictions. Each benchmark remains a coordinate in the Pareto sort space, with version, direction, evidence and freshness; the weighted quality summary is only an additional application preference/gate, not a replacement for these axes. Dynamic membership and hard bands are rechecked after semantic cache reuse and against final offers. See [source routing](source-routing.md) for schema/examples and the GUI handoff.
