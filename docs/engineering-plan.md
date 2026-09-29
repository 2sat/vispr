# Vispr engineering plan

Status: planning complete; shared foundation implementation underway. See [foundation handoff](foundation.md) for implemented scope and pending acceptance. September 29, 2026.

Companion: [demo specification](demo-spec.md). This plan records the subsequent engineering decisions and is authoritative for the SDK compatibility scope, vendor selections, session routing, and budgets.

## Settled decisions

| Area | Decision |
| --- | --- |
| App and API hosting | Next.js on Vercel, Node.js runtime |
| Database and user identity | Supabase PostgreSQL and invite-only Supabase Auth |
| Hosted execution | Shared Vispr-funded OpenRouter account; pin elected model/provider |
| Self-hosted execution | Direct OpenAI-compatible adapter; developer device endpoint pending |
| Inference integration | Vercel AI SDK behind Vispr execution adapter |
| Classification | Jev through TypeSafe; versioned questions and model |
| Catalog | Artificial Analysis plus repeatable public source imports and serving inventory |
| Scheduled ingestion | Vercel Cron, bounded batches, durable cursors/leases in PostgreSQL |
| Developer interfaces | TypeScript SDK and OpenAI-compatible chat completions endpoint |
| Session continuity | Jev chooses fresh auction, retain deployment, or retain through tool cycle |
| Low confidence | Retain qualifying deployment; new tasks use configured conservative pool |
| History | Trace/usage retained by default; payload retention per app; sample demo history enabled |
| Spending | $10/day shared demo ceiling; $0.25/request including Jev and retries; configurable |
| Quality evidence | Public benchmarks only; internal quality evaluations deferred |

Simulated provider bids remain separate from real OpenRouter charges. Registered demo participants represent model/provider offerings; external companies are not actually submitting negotiated offers.

## Repository structure and boundaries

- `apps/web`: Next.js UI, auth, service routes, cron entry point and SSE responses.
- `packages/contracts`: versioned request/policy/event schemas and stable error codes.
- `packages/sdk`: published-shape TypeScript client, typed streams and cancellation.
- `packages/routing`: Jev assessment, continuity decisions, evidence selection and pool scoring.
- `packages/auction`: invitation generation, simulated bidder strategies, bid validation and award.
- `packages/providers`: OpenRouter and direct compatible execution adapters; token/cost accounting.
- `packages/catalog`: source connectors, identity mapping, normalization and snapshot publication.
- `packages/db`: migrations and transaction/RPC boundaries.
- `supabase`: local configuration, auth settings, RLS policies and seed setup.

Use pnpm workspaces. Shared contracts validate inputs at every external boundary. Keep selection arithmetic and bid validation as pure functions. Pin dependency versions during the scaffold and record runtime requirements then.

## One request, end to end

1. Authenticate an application API key or dashboard session; enforce membership and policy ownership.
2. Validate supported request fields. Establish request idempotency and resolve explicit session ID, if supplied.
3. Reserve a classification allowance atomically against request and shared daily budgets. Capture policy and catalog versions.
4. Call Jev with necessary task/history context and separate questions for task requirements and continuity. Record actual classification usage.
5. Enforce capabilities and remaining budget in code. If continuity is indicated, validate the current deployment and use its still-valid offer or obtain a renewed bid from it. Continuity never reuses expired pricing or a spent capacity reservation.
6. Otherwise form an eligible pool and run a bounded, sealed, simulated auction. Reserve affordable execution spend and award atomically.
7. Dispatch through OpenRouter pinned to the winner, or directly to the self-hosted deployment. Stream normalized events immediately after execution begins.
8. Reconcile usage, capacity reservations, session state and terminal trace. Expose quoted auction price and real execution cost separately.

A retained deployment is reported as a continuity decision with renewed/valid pricing, not as an auction that never happened. Capability or budget failures override continuity. Do not change models in the middle of a partially exposed response.

## OpenRouter execution contract

A registered hosted offering includes a concrete OpenRouter model ID and an allowed provider/endpoint slug. Resolve these from serving inventory; model creator and inference host are different identities. Do not assume a broad provider slug pins a particular region or quantization. Register only routing specificity the API can enforce and capture the actual serving identity returned.

For each awarded request send the selected model, a single-provider `provider.only` restriction, `allow_fallbacks: false`, and parameter-support requirements where supported. Do not enable automatic model routing or pass a list of backup models. Vispr owns re-award decisions. Verify provider-option serialization in the AI SDK adapter with a captured-request contract test.

OpenRouter permits restricting providers and disabling fallbacks.[1] Usage is available in responses, including the last streaming event.[2] Persist generation ID and reconcile missing usage later through the generation lookup. A dropped stream is not evidence of zero cost. SDK-level automatic retries for billable POSTs must be disabled or explicitly coordinated by Vispr; do not promise exactly-once inference after an ambiguous network failure.

Maintain two execution adapters from the first implementation: `openrouter` and `openai-compatible-direct`. OpenRouter is not a required dependency of a self-hosted call. Builder-supplied OpenRouter keys and direct proprietary integrations are deferred unless required to support a capability the gateway lacks.

## Interfaces and compatibility boundary

### TypeScript SDK

Expose `inference.stream`, a non-streaming convenience method, trace retrieval and cancellation. Support `policyId`, `sessionId`, idempotency key, normalized messages, supported tools/output schema, and output-token limits. Events include assessment, candidates, bids, award/continuity, text/tool deltas, usage, completion and failure. All events carry request ID and increasing sequence.

### OpenAI-compatible endpoint

Provide `POST /v1/chat/completions` with Bearer Vispr application keys. `model: "vispr/default"` uses the application's default policy; `model: "vispr/policy/<id>"` selects a saved policy owned by that app. `GET /v1/models` lists these virtual routing model IDs, not every underlying candidate.

Initial supported subset: messages, stream, temperature where supported, output-token limit, function tools/tool results, tool choice and schema output where the selected endpoint supports them. Translate supported fields explicitly and reject unsupported parameters with a clear 400 response rather than silently ignoring them. Document the subset; this does not claim full Responses/Assistants API parity.

Streaming follows chat-completion chunk conventions and ends with `[DONE]`; auction traces do not appear as invented completion chunks. Return `X-Vispr-Request-Id` and expose trace via the separate request endpoint. Support optional `X-Vispr-Session-Id` and `Idempotency-Key` headers. Without a supplied session ID, accept caller-provided history for classification but do not infer cross-request ownership from text similarity.

Test against a real OpenAI-compatible client in addition to the native SDK, using controlled test adapters. Tool execution stays in the consuming application.

## Task-aware continuity

Jev returns independent judgments for task family/complexity and a continuity enum: `fresh`, `retain`, or `tool_cycle`. Include enough task history and the previous deployment's capabilities for the decision, but no secrets. Track confidence and question version.

Store sessions with application ownership, current deployment, last decision, unresolved tool call IDs, and an optimistic version. App policy can force fresh/retain behavior or accept automatic decisions. Concurrent mutation of a session uses a short lease/version check; duplicate tool cycles cannot independently alter the winner.

When Jev is uncertain, retain the existing deployment only if it still passes hard rules. A new task uses the app's conservative pool and still runs its auction. For classification outages use the same explicitly configured fallback path and label it as unavailable rather than pretending a model judgment occurred. If the retained model fails requirements, reselect; if no model qualifies, return a typed error.

Keep portable message/tool history. Provider-specific hidden state or nonportable content constrains switching. Never discard that state silently. Payload storage being disabled does not prevent the caller from resending context; persist only the minimum continuity metadata needed in that mode.

## Database, auth and secrets

Use Supabase Auth invitations and disable public signup; verify this at the service boundary, not merely by hiding a signup button.[3] Invitations are operator actions. Demo roles: owner/operator, application builder, and provider manager. Enforce app/provider ownership in service code and database RLS. Privileged server credentials never enter browser bundles. Hash Vispr API keys and show them once on creation.

Additional records beyond the demo spec: Membership, Session, BudgetAccount, SpendReservation, IngestionLease and PayloadRetentionPolicy. Monetary values use integer sub-dollar units or exact numeric values, never binary floats. Atomic PostgreSQL functions/transactions handle budget reservation, provider capacity and auction award. Scope uniqueness by app and idempotency key.

Shared vendor credentials live in deployment secrets. For the initial developer-device endpoint, store a secret reference configured by the operator. Arbitrary customer secret vaulting is not required for the demo. The registered endpoint must be reachable and authenticated before activation.

## Spending and history

Default daily accounting uses UTC and records that timezone in the UI; make the boundary configurable. Reserve before paid calls using pricing snapshots, context estimates, maximum output and supported reasoning limits. Include Jev and retries in the $0.25 request total and all requests in the $10 daily total. OpenRouter spend, not a discounted simulated bid, controls the real budget gate.

Settle against returned usage; keep conservative outstanding reservations for unknown charges until reconciliation. Unused reservations can be released when non-dispatch or cancellation is confirmed. Do not release ambiguous execution reservations solely because the local lease expired. Reject or require a compatible bounded configuration when the provider cannot support the needed spend bound. Explain that vendor billing reconciliation can reveal residual differences; never claim cancellation guarantees no further billing.

Metadata history is on by default. Prompt/response storage is configurable and enabled for bundled demo samples. Proposed operational defaults: 30-day metadata retention, 7-day payload retention, with scheduled deletion. These retention durations are implementation defaults, not previously selected user requirements. Payload access follows application membership. Replay explicitly creates a fresh billable request, records parent request ID and uses current policy/catalog unless the user selects a recorded snapshot.

## Catalog and scheduled work

Separate model quality evidence from serving inventory. Join public benchmarks to canonical model/version/configuration; OpenRouter inventory supplies routable offerings and provider-specific metadata when available. Display unmatched aliases for operator review. Never label one provider's latency as a measurement of another deployment.

Artificial Analysis is the first automated benchmark connector. Its API requires a key and attribution.[4] JSON/CSV source connectors and manual imports preserve their source, benchmark version and data-access mode. Domain coverage gaps remain visible.

A secured Vercel Cron route acquires a PostgreSQL lease, processes a bounded batch and saves a durable cursor. Repeated/overlapping invocations cannot double-publish a snapshot. Vercel documents protecting cron routes and accounting for overlapping executions.[5] Manual refresh uses the same worker function. Retain the last valid snapshot on any incomplete or invalid refresh.

Start with daily catalog refreshes and a bounded maintenance sweep for pending reconciliation, stale reservations and retention cleanup. Operations requiring finer timing must run in the active request path, not assume cron fires at an exact instant. No additional queue vendor for the demo.

## Self-hosted endpoint dependency

The developer already has a running model and is preparing remote access. Required handoff: authenticated HTTPS base URL, API dialect, model ID/version, context/output limits, supported features, quantization details if known and operator-supplied cost basis. Credentials are supplied through secrets, never the plan.

Build the direct adapter and registration/connectivity checks now. Keep the offering disabled with a visible pending status until reachable. Hosted open models through OpenRouter allow the rest of the demo to progress. Live self-hosted verification remains an explicit final acceptance item; a mocked endpoint does not satisfy it.

## Parallel delivery

See [the four-workstream split](workstreams.md) for ownership, shared-contract rules, dependencies and integration responsibilities. Build the foundation before dispatching the independent workstreams.

## Delivery sequence

| Milestone | Deliverable | Acceptance gate |
| --- | --- | --- |
| 1. Foundation | Monorepo, contracts, Supabase migrations/auth, Vercel config | Invited login works; uninvited access and cross-app reads fail; secrets absent from client |
| 2. First live path | Shared execution service, OpenRouter adapter, SDK and compatible endpoint | Both clients stream the same request shape; elected provider is pinned; usage is reconciled |
| 3. Catalog | Source connectors, serving inventory, canonical mapping, refresh UI | Reimports are idempotent; overlap is safe; malformed source preserves last good snapshot |
| 4. Routing and continuity | Jev, policy editor, evidence scoring, sessions | Hard constraints always win; missing coverage toggle works; uncertainty follows settled defaults |
| 5. Auctions and budgets | Registration, bid strategies, atomic award/capacity/spend | One award under races; late bids rejected; losing bidders never receive payload; concurrent spend reservations respect ceilings |
| 6. Demo and history | Five scenarios, traces, design preview, replay | All use production SDK path; no hardcoded winners; sample replay is clearly billable |
| 7. Live acceptance | Vercel deployment, smoke checks and developer endpoint | Hosted families plus open model succeed; real self-hosted path verified when endpoint arrives |

Milestone 2 may use an explicitly selected test offering to validate transport; it is not represented as completed routing or an auction. Final demo requires the full path through milestones 4–6.

Testing: schema and pure scoring tests, transaction concurrency tests, captured provider payload tests, compatibility client contract tests and UI smoke tests. Classification-quality benchmarking remains deferred; basic integration fixtures check expected shapes/fallback handling. Paid live checks stay within configured ceilings and report actual results, never simulated success.

## Dependencies and remaining setup

No further product decisions are required to start implementation. Setup will need Vercel and Supabase project access, shared OpenRouter credits/key, TypeSafe key, Artificial Analysis key, and the developer endpoint when ready. Invite delivery configuration must be verified in Supabase; if external SMTP is required for the chosen setup, select that vendor at setup time rather than silently assuming email delivery works.

Use application trace tables and structured Vercel logs initially; an extra observability vendor is unnecessary for the demo. Do not log prompts or credentials through platform logs. The next work is milestone 1, followed by the early live transport slice.

## References

1. [OpenRouter provider routing and fallback controls](https://openrouter.ai/blog/insights/reliability-failover/).
2. [OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting).
3. [Supabase user invitations](https://supabase.com/docs/guides/auth/users) and [auth configuration](https://supabase.com/docs/guides/auth/general-configuration).
4. [Artificial Analysis API](https://artificialanalysis.ai/api-reference).
5. [Vercel Cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs).
