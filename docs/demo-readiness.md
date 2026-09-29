# Demo readiness — 2026-09-29

Assessed repository main `652e9a9` after pulling platform PR #3, with local explorer/navigation work preserved. This is a historical assessment; the explorer and navigation fix are now included on main, and provider workspace updates have since landed. This is a code and local-check assessment, not verification of hosted secrets, database migrations or production acceptance.

## Conclusion

The individual building blocks exist, but the intended SDK → classification → eligible pool → provider auction → real inference → trace demonstration is not wired end to end. The latest platform contribution changes the remaining effort from missing execution infrastructure to service integration and acceptance.

| Area | Present | Delta for a real demo |
| --- | --- | --- |
| Platform/execution | Native SSE SDK and OpenAI-compatible endpoint; pinned OpenRouter/direct adapters; app keys and invited-membership checks; spend ledger, cancellation, reconciliation and award/capacity RPCs | Apply/verify hosted migration and environment, provision a certified offering, verify actual provider and billed usage through both clients |
| Routing/auctions | Batched Jev, exact cache, continuity rules, source bands, N benchmark axes, candidate filtering, simulated bidders, deadline collection | Production service never calls these libraries yet; bind trusted state, catalog/metrics, Jev spend hooks, bid persistence and atomic award before execution |
| Catalog | Resumable source ingestion, explicit alias review, local durable store, AA connector; seven-model public inventory discovery | Verified versioned benchmark imports; registered endpoint capabilities and completion-time/cost evidence; PostgreSQL ingestion adapter and refresh endpoint/cron |
| Product UI | Playground and trace presentation | `vispr-server.ts` still returns “Live SDK path is not wired yet”; live trace read returns null; fixtures produce fixed outcomes. Wire real stream/trace and error/cancel states |
| Source/session options | Shared schemas and routing rules | Platform `prepare` explicitly rejects source labels and sessions pending integration; persist app-owned source criteria and session/tool locks |
| Operator screens | Application/policy/key/provider APIs | Login/session UX and management pages absent; API-backed setup can support an initial operator-prepared demo |
| Explorer | Explorer visualization, bands, independent dimensions and sourced/illustrative modes | Live versioned evidence and persisted source presets still disconnected |
| Live acceptance | Automated mocked HTTP/SQL tests | Real invited login, paid hosted families/open-model calls, deployed concurrency, bill reconciliation and reachable developer self-hosted endpoint are unverified |

## Recommended critical path

1. **Platform owner: establish one paid transport smoke test.** Verify Supabase migration, invited identity, app/key/policy and a bounded active offering. Run native SDK and compatible chat endpoint, check serving identity, cancel behavior, traces and billing. No classifier or auction claim at this gate.
2. **Catalog + platform: publish a minimum qualified pool.** Three or more reviewed offerings spanning cost/latency/benchmark tradeoffs, including a hosted open model. Import real benchmark axes with explicit versions/configurations and endpoint-specific estimates. Keep missing evidence unknown and the developer-device offering pending until verified.
3. **Routing + platform: connect the decision pipeline.** Reserve classification spend per attempt; invoke assessment/cache and source/continuity logic; collect/persist simulated bids, atomically award capacity/spend, then execute only the winning offering. Recheck bands and budgets at award. Emit actual assessment/candidate/bid/award/timing events. Demonstrate cache reuse and source restrictions without relaxing constraints.
4. **UI owner: connect the five scenarios to that same SDK path.** Stream output and cancellation, load the actual trace, expose exclusion/award reasons and preview design output safely. Save policies/source presets via authenticated APIs. Merge the local explorer and unavailable-menu fix. Management screens can follow the prepared demo if operator setup is done through APIs.
5. **Joint acceptance on the deployed preview.** Exercise the five scenarios, native and compatible clients, same-task/tool continuity, classifier failure, empty pool/no bids, insufficient budget and cancellation; verify no duplicate dispatch/award under concurrency and accurate bill reconciliation. Add direct-device live acceptance when the endpoint is available.

## Concrete integration hazards

- The early transport selects `execution_offerings[0]`; it does not call `routeRequest`, `collectAuction` or `JevClassifier`. Merely deploying all packages does not create an auction pipeline.
- Spend currently reserves full configured context length × upper input rate plus maximum output × upper output rate. A discovery entry with 1.05 million context tokens and $2/million input would reserve $2.10 before output, above the former $0.25 cap. The follow-up cap migration raises the ceiling to $5; the hosted migration and a corresponding policy version must be applied before that allowance is effective. Choose a genuinely bounded serving configuration or implement and verify a tighter input/extra-charge bound; never substitute a simulated bid for real upstream liability.
- Catalog public TTFT/throughput is not the routing module's full-completion latency estimate. Join benchmark model/version/configuration independently from concrete serving-provider metrics.
- Discovery metadata lacks reviewed versions for the displayed public benchmark aggregates. It is not a routable evidence snapshot.
- The production health route still reports scaffold/liveInference=false. Update readiness reporting only when it reflects the verified integrated path.
- The root test configuration now includes web/platform tests and its server-only shim. The preserved explorer tests should run through that suite rather than a conflicting standalone web configuration.

Hosted configuration and credentials were not inspected or changed as part of this assessment. The former missing AA credential observation applies to that local process, not proof that Vercel lacks a secret.
