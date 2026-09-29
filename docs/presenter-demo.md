# Presenter demo

The deployed playground supports two response modes. Prepared demo returns labeled
sample responses. OpenAI response generates a new response for the edited prompt
and bundled sample attachments. Classification, candidates, auctions and routing
timings remain illustrative in both modes. Every generated response identifies
the real OpenAI model separately from the simulated auction winner.

Set these server-only variables in Vercel before deploying:

- `VISPR_DEMO_FIXTURES=1`
- `OPENAI_API_KEY`: a project key with Responses API access and available quota.
- `VISPR_DEMO_ACCESS_CODE`: a private presenter code of at least 12 characters.

Open the playground, choose **OpenAI response**, enter the presenter code, then
Run. The code unlocks generation in that browser for one hour. API keys never
reach the browser. The public prepared mode requires no code or paid requests.

OpenAI calls use pinned `gpt-4.1-mini-2025-04-14`, at most 8,000 prompt characters,
1,800 output tokens, a 45-second timeout, `store: false`, and no automatic retries.
Usage and elapsed generation time are reported from the actual call. Estimated
cost uses published input/cached-input/output rates and is separate from the
provider bill. This demo path bypasses the marketplace ledger; it does not claim
to enforce the marketplace's daily budget. Keep the presenter code private.

Only signed run metadata is retained in per-browser HttpOnly cookies for an hour.
The prompt and output are not retained by the demo app. A new run of the same
scenario replaces its previous metadata. Provider data policies still apply.
**Why this model?** opens the simulated trace with actual generation metadata
shown in a separate section. Prepared traces exist for all five scenarios.

For presentation resilience, switch back to **Prepared demo** if the OpenAI
account hits quota or a request times out. Provider errors are shown explicitly;
failed live calls are never silently replaced by prepared responses.
