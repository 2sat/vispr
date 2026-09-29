# Product UI workstream: first slice

Branch: `work/ui`. Scope: `apps/web` presentation, UI fixtures and the server seam. Shared contracts, service routes, database migrations and other streams are unchanged.

## Implemented

Screens composed from `components/` and fed by `lib/`:

- **Model explorer** (`/explorer`) — interactive axis projection, latency/cost ceilings, independent benchmark floors, token-based cost estimates, sortable per-axis table, frontier/exclusion explanations, and illustrative criteria copying. Sourced discovery is separate from the fictional instructional dataset.
- **Playground** (`/playground`) — scenario list, editable request draft, policy preset selector and a Run button. Submits through a server action; renders the winning model, response, usage and cost on return.
- **Provider console** (`/providers/console`, operator role) — registered deployments with availability, connection status and bid strategy. `lib/bidding.ts` holds `quoteBid`, so the console preview and the simulated bidding adapters agree on what an offering would quote; floors always win. `force-dynamic`, since operator data changes per request.
- **Request trace** (`/runs/[runId]`) — the routing decision for one run: ordered routing steps, a plain-language "why this model won" summary, then progressive disclosure for score breakdown, excluded models, bids, timing/cost and the run record.

Presentation notes: `Disclosure` keeps trace detail collapsed by default. `AppHeader` includes Model explorer and a Manage menu with the live provider console at `/providers/console`. Applications and Catalog remain disabled until their pages exist. Fonts and design tokens live in `app/vispr.css`.

There is no `/` route yet; enter at `/playground`.

## Data and credentials

`lib/vispr-server.ts` is the only seam to Vispr and is marked `'use server'`, so the SDK key never reaches the browser. Its behaviour is explicit about provenance:

- `VISPR_DEMO_FIXTURES=1` serves illustrative data from `lib/demo-fixtures.ts`. Runs carry `illustrative: true` and the UI labels them.
- Otherwise, a missing `VISPR_API_KEY` returns an error. Missing credentials are never replaced with fake responses.
- The live SDK path is not wired yet and returns an error saying so. `getRunTrace` likewise has no live implementation.

Provider writes follow the same rule: `saveDeployment` validates through `validateBidPolicy` first and, in fixture mode, returns `persisted: false` rather than mutating process-local state, which would not survive across serverless requests. `probeEndpoint` returns a canned feature set in fixture mode and an explicit "not wired yet" otherwise.

`lib/endpoint-url.ts` validates operator-registered endpoints: hosted mode requires https and rejects loopback, private, link-local and IPv4-mapped addresses, while `VISPR_DEPLOYMENT_MODE=local` allows them. This is a literal-host check only — as its comment says, the outbound request path must re-check the resolved address at connect time, or a public name could still point at a private one. Provider operations also assume the auth layer has already established operator credentials.

Scenario and policy presets are product configuration rather than results, so they ship from fixtures on both paths. `lib/types.ts` holds view-model types that mirror the spec's records but carry only what the screens render; `CostBreakdown` keeps quoted, estimated, usage-derived and billed amounts separate, as the spec requires.

Pending: live streaming, policy persistence, auth, catalog/provider management screens, attachment handling, and history/replay billing. No fake API endpoints were added.

## Verification

```sh
pnpm check
```

The root `pnpm test` suite now includes the web tests, including six explorer calculation tests: multidimensional dominance, benchmark selection, cost/context changes, missing evidence, inclusive limits and stable sorting. The same suite covers platform and package tests. Component-level automation for Playground/Request Trace remains a gap.

Because the shared `tsconfig.base.json` sets `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, fixture lookups need explicit narrowing — see the guards in `Playground` and the sort fallback in `explainWinner`.


## Explorer design and integration

The explorer uses the existing typography, header and design tokens. Controls define hard bands on the left; the main area shows population counts, a selectable two-dimensional projection, all enabled benchmark columns and reasons for the selected model. Context can be plotted as a capability dimension but is not part of the performance frontier. Sorting a table column or changing the projection cannot silently change the N-dimensional decision. No blended quality score is used in this explorer.

The illustrative dataset contains fictional endpoint names with synthetic scores and is labeled throughout. Discovery mode reads the committed OpenRouter snapshot server-side and sends only display data to the client; it never forwards credentials. Price is an advertised base-rate estimate for the chosen token shape, not a billable quote. Public benchmark aggregates without reviewed versions and public latency that is not verified full-completion time stay unknown. Unknown required coordinates prevent frontier membership.

This is an exploration design, not the live router: it does not implement budget accounting, reservations, source mapping persistence, weighted ranking, pool-size caps, evidence freshness or auction awards. Copying emits an illustrative `PoolCriteria` shape with deliberately illustrative benchmark IDs. Before connecting live routing, replace the fixed instructional axes with catalog-defined versioned axes/ranges/directions and consume the router's actual candidate explanations. Add saved source presets through the authenticated configuration API.

Explorer validation includes six calculation tests, workspace typechecks and the production build. Browser checks cover threshold exclusions, sourced-mode unknown evidence and SVG hydration. Explorer styling stacks controls on narrow screens and keeps the wide axis table horizontally scrollable.
