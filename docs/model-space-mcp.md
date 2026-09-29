# Model-space MCP endpoint

`POST /mcp` is an authenticated, stateless Streamable HTTP MCP endpoint for a model acting as an application design assistant. The calling MCP client supplies the model. This server exposes evidence and validates proposals; it does not invoke another LLM or spend inference tokens.

Connect an MCP client that supports custom authorization headers to `https://<your-vispr-host>/mcp` with `Authorization: Bearer <application-key>`. Use an existing `vispr_...` application key. The endpoint verifies that key and the application's invited owner on every request. Policies are read only within that authenticated application. Keep keys in the client's secret store, never URLs or prompts. OAuth discovery is not provided in this first version.

## Tools

1. `get_model_space({ policyId? })` returns the app's latest selected/default policy, its active reviewed routing evidence when configured, a content hash of that evidence (or the committed discovery snapshot), provenance, advertised pricing (including published tier/extra-charge metadata), model capabilities, missing evidence, and the shared `PoolCriteria` schema.
2. The calling model analyzes those data against the app builder's workload requirements.
3. `propose_static_manifold({ policyId, policyVersion, snapshotId, source, workload, criteria, rationale, task? })` validates and returns a content-addressed draft and a compatible `SourceRouting` configuration.

A manifold here means an intersection of independent hard bands, rather than a curved learned surface or a frozen list of models. Latency and cost ceilings are mandatory and cannot exceed application policy. Every selected benchmark uses an explicit identity, version, normalization range/direction and hard normalized floor. Selected benchmarks cannot be optional. The resulting criteria remain fixed for one app invocation source; model/deployment membership can change as verified evidence changes.

Example tool arguments (use the actual IDs, versions and limits returned by `get_model_space`):

```json
{
  "policyId": "app-policy",
  "policyVersion": 1,
  "snapshotId": "<hash-from-get_model_space>",
  "source": "invoice.extract",
  "workload": { "inputTokens": 1200, "maxOutputTokens": 400 },
  "criteria": {
    "latencyMs": { "max": 2500 },
    "estimatedCostMicros": { "max": 15000 },
    "requiredCapabilities": ["structuredOutput"],
    "contextTokens": { "min": 1600 }
  },
  "rationale": "Invoice extraction needs structured output within these app-owned latency and cost limits. A versioned extraction benchmark must be added once its evidence exists."
}
```

`estimatedCostMicros` uses integer millionths of a US dollar per request. Latency means full completion time, not time to first token. `workload` describes the preview token shape, not an authorization to dispatch or a billing bound. Each real request needs its own conservative cost estimate and budget reservation.

## Proposal status and enforcement boundary

Proposals return `status: proposed`, `active: false`, and `persisted: false`. They do not write a policy, activate a source binding, dispatch inference, or grant auction eligibility. The content hash binds the authenticated application, source, workload, criteria, catalog snapshot and policy version. Changing only explanatory prose does not change that identity. Stale policy/snapshot inputs fail and require a new model-space read.

Without an app-specific active reviewed configuration, the committed catalog contains discovery data only. In this mode, the preview reports known exclusions or `unverified`, with no eligible deployments. With an active reviewed configuration, the tool also returns versioned observations, endpoint metrics, profiles and existing source bindings. It evaluates the proposal through the same `selectCandidates` function as the live router, including freshness checks and independent benchmark floors. `previewEligibleDeploymentIds` describes this dry run only, not an award or registration/capacity check. `task` selects the preview profile and defaults to the reviewed conservative task. Proposed benchmark normalization must match reviewed axes. Published base prices are estimates; provider tiers and extra charges may alter the actual bid. Fictional explorer scores are never MCP evidence. Missing required evidence never becomes zero or a passing score.

A builder can review/export the returned `sourceRouting` draft. The returned source configuration preserves other source bindings. A builder can merge it into the reviewed routing config and publish it through the existing `/api/applications/[id]/routing` endpoint. That endpoint owns durable publication and activation checks; MCP does not bypass it. The live router applies source criteria during candidate selection and bid evaluation. Source-tagged requests without an active reviewed pool fail closed. Dedicated proposal review/storage UX remains future work. Production acceptance must verify the fixed region at candidate selection, bid receipt, and award/dispatch, combined with app budgets, capabilities and fresh evidence. Empty pools fail closed. Neither the classifier nor a bidder may widen the region automatically. Application credentials in this endpoint have proposal/read authority only.

## Transport and verification

The official MCP SDK handles initialization, tool discovery, schema validation, notifications and JSON responses. POST bodies are limited to 64 KiB. Responses are not cacheable. Cross-origin browser requests are rejected. GET/SSE subscriptions and DELETE sessions return 405 because no resumable session is created. No database migration or new credential is required.

Protocol integration tests use the official MCP client against the actual Next route with a mocked database transport. Tests cover negotiation, calls, tenant-scoped policy lookup, invalid/revoked keys, origin checks, request limits, proposal identity, stale versions, missing evidence and policy-boundary violations. They do not certify a production credential or live routing enforcement.

References: [official MCP server SDK](https://ts.sdk.modelcontextprotocol.io/server), [Streamable HTTP specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).
