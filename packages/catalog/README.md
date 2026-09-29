# Catalog workstream

`@vispr/catalog` implements the bounded refresh worker used by manual and scheduled entry points. It consumes the shared `@vispr/contracts` schemas. No API routes, shared contract changes, or migrations are included.

## Local ingestion

From the repository root, with the foundation's Node 24 and pnpm installed:

```sh
pnpm --filter @vispr/catalog ingest fixtures/import.json /tmp/vispr-catalog.json fixture-run-1
```

Repeat with the **same run ID** until status is `completed`. The synthetic fixture uses one row per batch, so two invocations complete it. A new run ID reimports the artifact; unchanged data creates no additional snapshot. Paths in the configuration resolve from the Catalog package's working directory. Fixtures test engineering behavior only; their scores and prices are not real measurements.

The file store uses an exclusive lock and atomic rename. Multiple sources serialize snapshot publication. A crash can leave `<state>.lock`; after confirming no worker owns it, an operator can remove the lock and resume the run. This adapter is for local ingestion on one filesystem. Hosted workers must provide `IngestionStore.transaction` using PostgreSQL: serialize all snapshot publication, acquire a source lease, load state, invoke the bounded callback, and commit run/cursor/records/snapshot together. Roll back if the callback throws. Do not use separate per-instance files on Vercel.

## Sources and identities

- `artificialAnalysisSource` uses the documented `/api/v2/data/llms/models` endpoint and server-side `x-api-key`, with ETag requests and bounded 429/5xx retries. HTTP bodies are limited to 5 MB while streaming. Set `ARTIFICIAL_ANALYSIS_API_KEY` for the CLI. Credentials are excluded from persisted run metadata and diagnostic output. Redirects are rejected.
- `artificialAnalysisMapping` requires explicit benchmark versions. It preserves ratios versus index values and USD per million tokens; TTFT seconds become milliseconds. Missing fields stay unknown. AA speed/pricing are public source observations, **not measurements of a registered deployment**.
- `artifactSource` supports manual JSON arrays and RFC 4180 CSV. `httpSource` supports scheduled HTTPS JSON/CSV imports. Configurable mappings declare benchmark names, versions, ranges, and source field paths.
- Alias entries map stable source model IDs to canonical version IDs and require `reviewed: true`. Zero or multiple mappings quarantine the row. There is no fuzzy name matching. Configuration is retained in the normalized source record and stable upsert key. Configure `configuration` to retain known reasoning/quantization/harness information.
- Serving inventory is passed as shared-schema `Deployment[]` from Platform's discovery/registration service. Catalog never derives capabilities or active deployments from benchmark rows. Pending self-hosted offerings remain pending as supplied. Inventory must be complete when publishing; it is frozen for each resumable run.

Artificial Analysis requires attribution: [Artificial Analysis](https://artificialanalysis.ai/). The operator must comply with [API data terms](https://artificialanalysis.ai/api-reference). Local state temporarily retains raw rows for resumable processing; use it only with sources permitting that retention. Completed runs keep hashes, normalized data and quarantine reasons, not raw payloads. Source URLs must not contain secrets. Hosted URL imports require Platform's network destination policy before invocation.

## Publication and validation

Each run stores adapter version, source ID, retrieval metadata, content hashes, ETag, staged records, durable page/cursor/offset, counts, and quarantine reasons. The next batch uses the persisted page rather than fetching it again. Resume rejects changed source identity/content, mappings, alias reviews or serving inventory. ETags are reused only for the same source and normalization inputs; new alias reviews force a full fetch. Run IDs are globally unique; a running source blocks a different run ID. Completed/failed IDs are terminal and safe to retry. Network outages, throttling and deadline interruptions keep the run running with a retry diagnostic; retry the same run ID to resume from its durable page/cursor.

Numeric ranges, source identity, duplicate record/configuration keys and shared snapshot schemas are validated. Any rejected row, failed fetch, malformed page or empty full response leaves the last good snapshot and normalized records unchanged. Fix the input and use a new run ID after a failed run. Complete successful refreshes mark absent records stale; partial pages do not. Updates use stable source record/configuration keys, and timestamps alone do not create new snapshots. Historical snapshots remain available.

Shared contract 0.1.0 supports deployments and benchmark observations but lacks source run metadata, canonical model records, evaluation configuration, prices and latency. Those are retained in Catalog's internal persistence types. Benchmark tuples with multiple source/configuration observations are omitted from the shared snapshot to avoid conflation. Platform/Routing must agree on a richer shared contract before consuming these fields; no incompatible contract is introduced here. Prices remain exact source USD decimals in metadata, not billable micro-USD arithmetic. Budget enforcement belongs to Platform.

## Acceptance and integration

Run `pnpm test` and `pnpm typecheck`. Catalog tests exercise durable resume, idempotent imports, quarantine/last-good preservation, stale records, overlapping runs, CSV validation, and captured AA request/response fields. Additional regression tests cover changed alias reviews with cached sources, resumable outages/cancellation, and bounded response streams. No live AA call or paid model call is part of these checks.

Platform owns the PostgreSQL adapter, ordered migration IDs, authenticated manual/cron API handlers, source URL access policy and UI history endpoints. Product UI consumes run counts/quarantine and snapshot IDs. Live API credentials, hosted transaction/lease verification and deployed cron invocation remain integration acceptance items.
