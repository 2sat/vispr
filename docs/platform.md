# Platform and execution handoff

The `work/platform` implementation supplies the first explicitly selected transport path. It does not pretend to run Jev, catalog selection, continuity, or an auction before those streams integrate. No paid inference, hosted invitation delivery, or developer-device acceptance was performed by this implementation.

## Implemented boundaries

- Invited Supabase membership gates dashboard management. Bearer application keys are SHA-256 hashed, scoped to their app, revocable, and shown only at issuance. The application owner's membership must still exist when an API key is used. Browser access remains governed by RLS.
- Application creation, immutable policy versions, key issuance/revocation, provider and pending deployment registration, and free inventory connectivity diagnostics have authenticated service endpoints. Inventory reachability does not verify tools, structured output, vision, or inference; new deployments remain pending.
- OpenRouter execution pins a concrete model and one `provider.only` slug, with `allow_fallbacks: false` and `require_parameters: true`. The AI SDK has both HTTP and streaming retries disabled. Direct compatible inference uses its own URL/key and never calls OpenRouter.
- Native SSE emits validated increasing-sequence contract events. SDK methods include `inference.stream`, `inference.generate`, `trace`, and `cancel`. Abort signals propagate upstream. Explicit cancellation is durable and checked at dispatch and during streaming. Interrupted calls never replay automatically.
- Global PostgreSQL spend reservations enforce the smaller of policy limits and $0.25/request / $10/day. The ledger is shared across applications, uses integer micro-USD, and resets settled spending at UTC midnight. Outstanding charges carry across days. Missing billing data keeps conservative reservations; cancellation or expiry does not refund dispatched calls.
- OpenRouter usage cost, generation ID and actual returned serving identity are recorded separately from any future simulated bid. Daily maintenance reconciles up to three pending generations, expires payload rows and 30-day trace rows, and releases only hour-old requests proven never dispatched. Direct calls lacking billing data remain pending for operator reconciliation.
- Database RPCs provide capacity acquisition/release, deadline-checked bid submission and atomic one-winner award. Routing/auction packages remain responsible for schema validation, eligibility, pricing, policy arithmetic and candidate decisions before calling these server-only RPCs.

## Configuration and first transport call

Use the pinned Node 24 / pnpm workspace. Apply ordered migrations to local Supabase with `pnpm exec supabase db reset`; apply reviewed migrations to hosted Supabase through your normal deployment process. `pnpm check` verifies code and SQL without real credentials. Local HTTP client tests need permission to bind a loopback port.

Server environment:

- `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`) and `SUPABASE_SECRET_KEY` (legacy `SUPABASE_SERVICE_ROLE_KEY` also accepted).
- `OPENROUTER_API_KEY` is the centrally funded account used by explicit hosted execution and generation reconciliation.
- `CRON_SECRET` protects `/api/maintenance`; `apps/web/vercel.json` schedules one daily sweep.
- `VISPR_DIRECT_ALLOWED_ORIGINS` is an exact comma-separated operator allowlist. Secrets for registered deployments are environment references named `VISPR_PROVIDER_<NAME>`. Registration accepts authenticated HTTPS URLs and rejects credentials in URLs. Redirects are disabled. Only operators provision endpoints; do not allow arbitrary callers to modify the origin allowlist. Development execution alone may enable HTTP with `VISPR_ALLOW_LOCAL_ENDPOINTS=true`; production never accepts HTTP.

Disable hosted public signup, email signup and anonymous sign-in as well as local signup. An authenticated user without an operator-created membership receives 403 even if hosted signup settings were accidentally relaxed. Confirm invitation delivery/login before sharing protected data. The sample presentation shell remains public.

Use a Supabase access token to `POST /api/applications` with `{ organizationId, name, policy }`. Then `POST /api/applications/<id>/keys` returns a new application key once. Policies are the shared `PolicySchema`; append versions through `/api/applications/<id>/policies`. Key revocation uses `DELETE /api/applications/<id>/keys?keyId=<key-id>`.

The first path requires an operator-created `execution_offerings` row keyed by application/policy/version, containing:

- A validated active shared `Deployment` with current concrete serving model/provider IDs.
- `base_url`: `https://openrouter.ai/api/v1`, or an exact approved direct origin and API path.
- `secret_reference`: `OPENROUTER_API_KEY` for hosted execution, or the operator's direct environment reference.
- Integer input/output micro-USD per million tokens upper rates and `bounded=true` **only after** confirming the output cap and all separately billed reasoning/cache/extra charges fit the bound. Unknown bounds must remain disabled.

The bound reserves the full deployment context at its input rate plus maximum requested output at its output rate. The first strict path accepts text and tool/schema requests, using UTF-8 bytes plus message overhead as a conservative context gate. It rejects image inputs and sessions until their spend and continuity integration exists. If the conservative reserve exceeds the request ceiling, select a cheaper/smaller certified offering; do not lower the reservation to simulated auction prices.

```ts
const vispr = new Vispr({ apiKey: process.env.VISPR_API_KEY!, baseURL: 'https://your-vispr-service.example' });
const run = vispr.inference.stream({
  policyId: 'balanced', idempotencyKey: crypto.randomUUID(),
  messages: [{ role: 'user', content: 'Hello' }], maxOutputTokens: 100,
});
for await (const event of run.events) console.log(event);
```

Idempotency is application-scoped. A duplicate receives 409 and must retrieve the original trace, rather than replaying a paid POST. Keep the returned `X-Vispr-Request-Id` for tracing/cancellation. Generation IDs missing after an ambiguous failure require operator reconciliation; maintenance never assumes zero cost.

## Compatible endpoint subset

`GET /v1/models` lists `vispr/default` and `vispr/policy/<id>` for the authenticated app. `POST /v1/chat/completions` accepts messages (including function calls/results), `stream`, `temperature`, either `max_tokens` or `max_completion_tokens`, function `tools`, `tool_choice` (`auto`, `none`, `required`), strict JSON-schema `response_format`, and `stream_options.include_usage`. Unknown fields and unsupported virtual model IDs return 400. Tool execution belongs to the consumer.

Streaming preserves upstream stop/length/tool finish reasons, emits a final optional usage chunk and `[DONE]`, with provider failures as explicit error frames. Traces use `/api/requests/<id>`; they are never invented completion chunks. Optional `Idempotency-Key` is supported. `X-Vispr-Session-Id` is parsed but receives explicit `NOT_CONFIGURED` until continuity integrates. Responses/Assistants parity and arbitrary tool-choice objects are outside this subset.

## Routing and auction integration

`begin_execution` creates the app-scoped idempotent request and reserve atomically. Use the real upstream bound, including Jev/retries when integrated. The early transport bypasses classification explicitly, so no Jev allowance is spent today. Do not reuse a successful request reservation for a second call.

For auctions: persist a bounded deadline, acquire each offering's capacity, validate the shared bid and private policy, call `submit_bid`, select a qualifying bid after close, then `award_auction` against a funded request reservation. A repeated award returns false. `executing` capacity remains occupied even after its expiry timestamp; release explicitly after execution resolves. These RPCs are service-role-only and use row locks. PGlite validates constraints and duplicate award attempts; a deployed multi-connection PostgreSQL race/load check is still required.

Payload retention: opt-out redacts text/tool argument deltas in persisted traces. Live consumers receive complete deltas. This path never persists prompts; full retained request history awaits product integration.

## Remaining live/integration acceptance

Real invitation/login, OpenRouter paid streaming through both clients, actual provider identity/bill lookup, hosted preview, all commercial families, and reachable self-hosted inference remain unverified. Catalog/routing/auction decisions, Jev spend, complete session continuity, replay/history UI, and provider feature activation are cross-stream integration dependencies. Do not advertise this transport slice as the completed five-scenario marketplace.

PR review hardening additionally preserves generation IDs before exposing partial output, recovers hour-old interrupted executions for reconciliation, and leaves their uncertain spend/capacity encumbered. Modern Supabase secret keys travel only on `apikey`; legacy JWT service keys also use Bearer authorization. Malformed or unpaired tool history is rejected before reserving or dispatching.
