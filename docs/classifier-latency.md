# Classifier latency and local deployment options

Research snapshot: September 29, 2026. Architecture memo; no live latency measurements or classifier substitution implemented. Existing Jev selection remains the demo default. Internal evaluations of candidate inference models remain deferred.

## Recommendation

Keep a replaceable classifier interface, start with one hosted Jev call for all independent judgments, and measure its contribution separately from the auction and winning inference. First remove unnecessary calls through explicit policy, tool-cycle state and exact caching. Prototype a warm local encoder only if measured overhead warrants it; use a small local LLM when the encoder cannot express the required judgments. Do not assume a local model is faster, equally accurate, or equally calibrated.

## Is Jev open, self-hostable, or embeddable?

The public offering is a hosted API. TypeSafe's [model documentation](https://docs.typesafe.ai/models) serves Jev through `POST /v1/systemone`; the [customer agreement](https://typesafe.ai/legal/mca) describes a TypeSafe-hosted service. No official weights, model redistribution license, offline runtime, or public self-host/on-prem offering were found in the [official repositories](https://github.com/typesafe-ai) and documentation reviewed. This does not establish that a private enterprise arrangement is impossible; vendor confirmation would be needed.

The [JavaScript SDK is MIT-licensed](https://github.com/typesafe-ai/typesafe-sdk-js/blob/main/LICENSE), but it is an API client, not Jev's inference engine. It can be incorporated into Vispr's server code; it does not embed a local model. The [SDK guide](https://docs.typesafe.ai/sdk/javascript) documents Node.js 20+ and server environment credentials.

Do not plan to train a local Jev imitation from its responses: section 2.3(b) of the [customer agreement](https://typesafe.ai/legal/mca) restricts distillation, imitation training and using service/output to develop similar or competing products. Independently sourced open classifiers are a different path; this memo is not a determination of contractual coverage for a particular experiment.

## How much latency does it add?

TypeSafe's September 15 [launch post](https://typesafe.ai/blog/introducing-system-one-models-and-jev) claims **70–500 ms end-to-end response time** for its System One queries. This is a vendor result, not a Vispr measurement, percentile guarantee, or SLA. It does not establish behavior for our region, payload sizes, concurrency, retries or server cold starts. Do not add another estimated network round trip to that claim as though the published figure were compute-only.

For our serial routing path:

`time to first inference token = ingress/auth + critical-path preparation/classification + pool selection + auction + winning-provider TTFT`

Classification measurement must cover state preparation, serialization, request wait, response validation and retries. Overlapping catalog/session reads can hide some work; only the uncovered critical path contributes extra wall time. The auction remains overhead even if classification becomes instantaneous. Total completion time and first-token latency are separate user experiences.

Jev accepts Choice, Score and Noul questions together. TypeSafe says questions run independently in parallel against shared state and additional questions barely affect response time. Batch task category, complexity and continuity in one request; a question cannot consume another answer within that batch. [Primitive composition](https://docs.typesafe.ai/introduction)

## Reduce overhead before changing models

1. **Use deterministic facts first.** Parse tools, image presence, requested output schema, context length and explicit app overrides in code. Honor an already-established tool-cycle lock without repeatedly asking whether the same cycle should stay locked. Reassess at the boundary or when requirements change; recheck eligibility and pricing on every call.
2. **Keep state focused.** Supply the latest task, necessary continuity context and structured session facts. Avoid resending irrelevant documents or generating a fresh summary solely to save classifier time. Jev documents degradation from irrelevant large state and prompt injection sensitivity. [Known limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13)
3. **Cache assessments, not stale awards.** Key exact cached assessments by tenant, relevant input/history digest, classifier revision, question version and capability context. Bound retention. Recompute the pool from current policy, catalog and availability; never reuse expired offers. Semantic caching remains experimental because similar text can hide changed requirements.
4. **Overlap independent preparation.** Load catalog snapshots and session/policy records alongside classification where authorization and budget reservation permit. Do not start paid winning inference before a valid award.
5. **Bound deadlines and retries.** Make classification consume the remaining overall request deadline. Record every attempt, cost and timeout. TypeSafe documents SDK backoff on rate limits; defaults must not silently turn a small routing step into seconds of delay. [Model/rate-limit behavior](https://docs.typesafe.ai/models)
6. **Preserve conservative fallback.** On uncertainty or timeout, retain a qualifying current deployment; new tasks use the configured conservative pool. Hard capability and budget limits always apply. Do not transfer Jev confidence thresholds to another model's scores without validation.

## Local alternatives worth testing

| Approach | Concrete starting candidate | Advantages and limits |
| --- | --- | --- |
| Rules and exact cache | TypeScript policy/state machine | No model or network call for covered cases. Not a semantic classifier; must abstain outside explicit coverage. |
| Zero-shot encoder | [DeBERTa-v3-base-zeroshot-v2.0-c](https://huggingface.co/MoritzLaurer/deberta-v3-base-zeroshot-v2.0-c) | Public weights, MIT model card, CPU/GPU support; the author identifies the `-c` variant as using commercially friendly training data. Tests text/label entailment without generative decoding. Its documented 512-token window limits continuity context; work grows with candidate labels. No evidence here establishes Vispr accuracy or latency. |
| Small local LLM | [Qwen3-0.6B](https://huggingface.co/Qwen/Qwen3-0.6B) | Apache-2.0 weights, local runtimes, optional non-thinking mode. Use non-thinking mode and constrained short output. More flexible task/continuity interpretation, but prefill, decoding, memory and cold loads can outweigh a hosted call. A generated confidence number is not calibrated confidence. |

Use an encoder for a small stable taxonomy plus an explicit unknown outcome; avoid pretending entailment scores are probabilities that a model will successfully complete the downstream job. Neither candidate is asserted to match Jev. These are reproducible experiment baselines, not claims that they are the newest or best classifiers.

[Transformers.js](https://huggingface.co/docs/transformers.js/index) supports classification and zero-shot pipelines using ONNX Runtime, with browser WASM/WebGPU and quantization options. Verify and pin an actual compatible export, tokenizer and runtime before promising browser support for a candidate. Native/local LLM execution is also possible through [llama.cpp](https://github.com/ggml-org/llama.cpp), which supports local inference and an OpenAI-compatible server.

## Placement, privacy and deployment

- **Browser SDK:** A worker can run an optional downloaded local classifier. Account for download, initialization, memory pressure, browser support and device variability separately from warm inference. Treat browser classifications as untrusted hints; server policy, spend and capability enforcement remain authoritative. Do not ship the Jev key to the browser.
- **Native app or app-builder server:** A warm local process/sidecar is the strongest first experiment: controlled hardware and persistent weights, with classification close to the originating task. A Node SDK can call it through a replaceable adapter. A trusted app-builder backend is a different trust boundary from arbitrary browser input.
- **Vispr hosted service:** This remains required for the OpenAI-compatible endpoint because its callers need not run our SDK. A local-to-service classifier means a server deployment, not an end-user device. Keep hosted Jev initially; if we self-host an alternative, use a warm service and measure the additional hop. Avoid coupling a large model load to every Vercel request.
- **Developer-device endpoint:** Useful for experiments, but reaching it from Vercel still incurs network latency and depends on the device staying awake. The pending authenticated connection is needed before using it for hosted requests.

A dark auction conceals the prompt from losing bidders, not from a hosted classifier. Jev currently accepts text only; derive image/tool requirements from request structure rather than claiming it inspected reference pixels. Local classification can remove TypeSafe from the prompt path, but Vispr and the winning executor still receive the payload under the current architecture. TypeSafe says it does not train on customer requests and documents enterprise ZDR; that is not a blanket zero-retention promise for the demo. [Models](https://docs.typesafe.ai/models), [data handling](https://docs.typesafe.ai/legal/)

## Instrumentation experiment

Implement one assessment contract across hosted Jev, rules/cache and experimental local adapters: source, model/question revision, task requirements, continuity, uncertainty/abstention, usage and timings. Classification identifies semantic requirements; **code** applies public benchmark evidence, exact prices, latency thresholds, weights and missing-coverage policy. Do not ask the classifier to remember the current model market or perform scoring arithmetic.

Run the same five demo scenarios plus continuation, tool-result, topic-change and ambiguous cases. Use independent fixtures, not Jev-generated training labels. Vary short/long inputs, warm/cold runtime, serial/concurrent load, and actual target device/deployment region. Start with a small cost-bounded pilot; collect enough repeated observations before reporting percentiles.

Record request/trace IDs, input size, question count, cache state, classifier total/attempt timings, model load separately, failures, retries, chosen fallback, pool computation, auction time, provider dispatch, first token, completion and actual charges. Report p50/p95 with sample count and conditions; claim p99 only with an adequate sample. Avoid logging raw payloads when retention is disabled.

Compare local-vs-hosted end-to-end latency, not just kernel speed. A cascade has cost roughly `local time + escalation fraction × hosted time` before overlap; low local coverage can make it slower. A paired fixed-route control isolates middleware overhead without confusing it with different winning model speeds. Include schema validity, hard-limit invariants and manually specified continuity cases as engineering acceptance checks. Broader classifier calibration and candidate-model quality evaluations remain deferred; no local replacement should be promoted as quality-equivalent on speed alone.

**Next implementation:** add pluggable assessment and timing hooks in the routing workstream, retain Jev as baseline, then run the bounded experiment when credentials and the developer endpoint are ready. No additional hosted vendor is required for this first comparison.
