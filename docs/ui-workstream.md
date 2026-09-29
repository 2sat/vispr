# Product UI workstream: first slice

Branch: `work/ui`. Scope: `apps/web` presentation, UI fixtures and the server seam. Shared contracts, service routes, database migrations and other streams are unchanged.

## Implemented

Two screens, both composed from `components/` and fed by `lib/`:

- **Playground** (`/playground`) — scenario list, editable request draft, policy preset selector and a Run button. Submits through a server action; renders the winning model, response, usage and cost on return.
- **Request trace** (`/runs/[runId]`) — the routing decision for one run: ordered routing steps, a plain-language "why this model won" summary, then progressive disclosure for score breakdown, excluded models, bids, timing/cost and the run record.

Presentation notes: `Disclosure` keeps the trace's detail collapsed by default, so the default view stays at the level of the decision rather than the mechanism. `AppHeader` carries the primary nav plus a Manage menu stub pointing at screens that do not exist yet (`/applications`, `/providers`, `/catalog`). Fonts and design tokens live in `app/vispr.css`.

There is no `/` route yet; enter at `/playground`.

## Data and credentials

`lib/vispr-server.ts` is the only seam to Vispr and is marked `'use server'`, so the SDK key never reaches the browser. Its behaviour is explicit about provenance:

- `VISPR_DEMO_FIXTURES=1` serves illustrative data from `lib/demo-fixtures.ts`. Runs carry `illustrative: true` and the UI labels them.
- Otherwise, a missing `VISPR_API_KEY` returns an error. Missing credentials are never replaced with fake responses.
- The live SDK path is not wired yet and returns an error saying so. `getRunTrace` likewise has no live implementation.

Scenario and policy presets are product configuration rather than results, so they ship from fixtures on both paths. `lib/types.ts` holds view-model types that mirror the spec's records but carry only what the screens render; `CostBreakdown` keeps quoted, estimated, usage-derived and billed amounts separate, as the spec requires.

Pending: live streaming, policy persistence, auth, catalog/provider management screens, attachment handling, and history/replay billing. No fake API endpoints were added.

## Verification

```sh
pnpm check
```

`apps/web` currently has no tests of its own, so it has no `test` script and no `vitest.config.mts`; the root suite globs `packages/**` only. Re-add both alongside the first component test. Test coverage for these screens is the main gap in this slice.

Because the shared `tsconfig.base.json` sets `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, fixture lookups need explicit narrowing — see the guards in `Playground` and the sort fallback in `explainWinner`.
