# Routing and auctions: first implementation slice

Branch: `work/routing`. Changes are confined to the routing/auction packages and design documents. Shared contract and database ownership remain unchanged.

## Implemented

- Deterministic eligibility filtering for active endpoints, streaming, images, tool history/definitions, structured output, context capacity and output limits.
- Explicit task/benchmark profiles with benchmark version, normalization direction/range, weight and optional required minimum. Only matching fresh observations are used. Proxy evidence cannot satisfy required measured thresholds.
- Incomplete optional coverage requires the application toggle and contributes an uncertainty penalty. Entirely absent evidence cannot establish minimum quality.
- Fresh endpoint-specific cost/latency inputs. Cost estimates use integer micro-USD arithmetic and round up; remaining request budget includes the allowance left after classification.
- Fixed policy-bound utilities with an exposed quality/cost/latency/uncertainty breakdown. Deterministic pool-size cap and exclusion reasons.
- Continuity decisions for explicit app settings, established tool locks, Jev judgment, uncertainty and unavailable classification. An ineligible current endpoint cannot be retained.
- Bid shape, invitation membership, auction identity, expiry and server-receipt deadline validation. Participant timestamps cannot backdate a bid. Deterministic ranking with duplicate and invalid-score checks.

## Integration contracts

`selectCandidates` takes the shared request, policy, assessment and catalog plus explicit context supplied by catalog/platform: benchmark profiles, endpoint metrics, token estimator, freshness windows, current time and remaining budget. No prices are fabricated. `createPoolSelector` adapts this function to the existing shared package interface; retain the richer `score` breakdown when producing trace details.

Current estimates assume the provided input/output rates describe the serving configuration fully. Endpoints with extra unbounded reasoning/cache/tool charges must be excluded or supplied a conservative bound by platform. This module does not enforce a billing ledger or guarantee a vendor bill.

`validateBid` and `rankBids` are primitives, not a running auction service. The authenticated caller must map the participant to its authorized offerings, enforce receipt ordering and bidder ownership, recheck post-bid price/latency/budget constraints, and atomically award/reserve capacity. Only rank accepted bids after those checks. Platform owns the transaction.

## Pending task-3 work

- Live Jev adapter with one batch for independent judgments.
- Exact assessment cache and timing hooks per [classification design](classification-design.md).
- Pareto-frontier/score-band options and richer task-profile configuration, where shared policy contracts support them.
- Bidder strategies, concurrent collection/deadline orchestration and final bid utility integration.
- Named conservative-pool configuration and session lock persistence, with platform integration.
- Service/UI integration and paid live verification.

The batching/cache behavior is now included in the demo spec and engineering plan; this slice does not claim it is running.

## Verification

`pnpm check` passed: all workspace typechecks, 33 root tests (23 routing/auction cases plus 10 foundation tests), and production build. Tests cover capability exclusions, missing/proxy/stale evidence, normalization, remaining budgets, endpoint freshness, deterministic pool caps, exact arithmetic, continuity fallbacks, participant timestamp abuse and auction tie-breaking. The five UI playback tests also pass. Pre-push review added checks for per-component charge rounding, policy identity, conflicting evidence, finite scoring, input-order stability, exact constraint boundaries, invalid receipt timestamps and mixed-auction rejection. No paid model calls were made.
