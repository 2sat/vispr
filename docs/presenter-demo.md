# Presenter demo

## Local rehearsal

Install dependencies with `pnpm install --frozen-lockfile`. Set
`VISPR_DEMO_FIXTURES=1` in `apps/web/.env.local`, then run `pnpm dev` and open
`http://localhost:3000/playground`. The root URL redirects there. The IBM Plex
fonts are bundled with the application, so startup does not fetch Google fonts.

Prepared demo works without paid credentials. Its responses are fixed samples;
editing the prompt does not generate a new answer or assessment. Policy presets
re-score the illustrative bids. The selected policy and winner stay consistent
between the result card and **Why this model?**. Policy editing is not available.

## Six-minute audience walkthrough

1. **0:00–0:45 — Playground.** Choose **Code debugging**, **Prepared demo**, and
   `quality-first`. Read the duration-conversion bug. Say: “This walkthrough uses
   prepared responses and simulated routing to show how a policy changes a decision.”
2. **0:45–1:30 — Run.** Click **Run**. Show the sample patch and the illustrative
   `gemini-pro` winner. Expand **Policy settings** to show quality/cost/speed priorities.
3. **1:30–2:45 — Explain.** Click **Why this model?**. Show task assessment,
   exclusions, valid offers and the late rejected bid. These are example evidence
   and timings, not measurements from a live marketplace request.
4. **2:45–4:00 — Change the requirement.** Return to **Playground**, keep Code
   debugging, choose `cheapest-qualified` and click **Run**. The illustrative
   winner changes to `gpt-mini`. Open **Why this model?** to confirm the selected
   policy and awarded bid. The response stays the same prepared sample.
5. **4:00–5:00 — Audience choice.** Offer **Invoice extraction** for JSON or
   **UI design & prototyping** for an HTML preview. Run their choice. For design,
   show **Preview** and **Source**; scripts are disabled in the preview.
6. **5:00–6:00 — Marketplace context.** Open **Manage → Model catalog** to show
   sourced inventory and evidence gaps. Optionally show **Manage → Provider console**
   as illustrative configuration. Close: “One interface, policy-driven selection,
   and a decision you can inspect.”

If OpenAI presenter credentials are configured, switch to **OpenAI response**
for an edited prompt. Explain that only response generation is real: the auction
winner, assessment and routing timings remain simulated, and the actual response
model is listed separately. Rehearse this mode before the presentation.

## Optional OpenAI response setup

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
