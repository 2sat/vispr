# Public demo pool discovery

On 2026-09-29 we fetched [OpenRouter's model inventory](https://openrouter.ai/api/v1/models), then each shortlisted model's advertised endpoint-details URL. The timestamped [discovery snapshot](data/demo-pool-discovery.json) preserves source URLs, inventory hash, selected model metadata, endpoint pricing/capabilities and public endpoint statistics. The inventory contained 464 model entries at retrieval. No paid inference calls were made.

The seven candidate models are OpenAI GPT-6.1 Sol and GPT-6 Luna, Anthropic Claude Sonnet 5.5, Google Gemini 3.8 Flash, Qwen3.8 Flash, Llama 4 Scout, and DeepSeek V4.1 Flash. This is a discovery shortlist covering different vendors and advertised price points, not a benchmark-based ranking or endorsement. Qwen/Llama/DeepSeek entries link to weight repositories; self-hosted eligibility still requires an actual registered endpoint, capability checks and applicable license review.

## What is real versus still pending

The snapshot contains live public inventory, advertised prices, context/output limits, supported parameters, provider endpoints and endpoint latency/throughput statistics where available. These are source observations, not our workload measurements or guarantees. Model-level price may be a starting rate rather than the awarded endpoint's rate; preserve tiers, extra charge fields, quantization and configuration. Endpoint latency statistics must not be silently substituted for the router's estimated full completion time.

Some model rows contain aggregated Artificial Analysis or Design Arena fields. They are retained as discovery metadata only: they lack the reviewed benchmark version/configuration mapping needed to publish independent, measured routing axes. Missing fields stay missing. New or apparently strong models with incomplete benchmark evidence cannot bypass eligibility checks.

Jack's catalog importer is now merged and supports durable imports, explicit alias review and the [Artificial Analysis API](https://artificialanalysis.ai/api-reference). A live AA import has not run; `ARTIFICIAL_ANALYSIS_API_KEY` was absent from this process. The repository's catalog import fixtures and UI playback remain synthetic. This discovery file is deliberately not an active catalog snapshot and does not auto-register or enable any deployment.

## Remaining integration

1. Register reviewed concrete OpenRouter provider offerings from endpoint inventory; avoid automatic model/provider fallback. Keep the developer's self-hosted offering pending until reachable.
2. Use the catalog importer with source/model aliases and explicit benchmark versions/configurations; keep N independent axes rather than treating a composite intelligence index as every task's ability.
3. Obtain endpoint-specific completion-time estimates and conservative cost bounds for the request shape. Distinguish public statistics from measured application telemetry.
4. Publish the reviewed catalog and metrics, then run source-band eligibility and simulated auctions. Platform must perform atomic budget/capacity/award checks before a paid call.

Refresh the public inventory and each selected row's `links.details` endpoint before registration; this committed snapshot is a reproducible record of discovery, not an evergreen catalog. The production repeatable refresh path remains Jack's catalog worker plus platform serving discovery.
