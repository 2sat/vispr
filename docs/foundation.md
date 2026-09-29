# Foundation handoff

This is a development scaffold, not a working marketplace or deployed demo. Four human developers can consume its contracts and fixtures from independent clones after the checks below pass.

## Local setup

Use Node 24 and pnpm 11.19.0 (pinned in package.json). From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm dev
```

The web shell runs on http://localhost:3000. `/api/health` explicitly reports scaffold status. No keys are required for the shell, typechecking, tests or build. There are no live inference endpoints yet. The scaffold is public and contains only sample prompts; it does not claim invite-only auth is implemented.

Copy `apps/web/.env.example` to `apps/web/.env.local` when implementing integrations. These are placeholders only. Keep all vendor keys server-side. Do not populate preview deployments with production credentials by default.

## Database

The migration establishes organizations/memberships, application-owned versioned policies, API-key hashes, catalog snapshots, provider registration, requests, traces, optional payloads, spend reservations and ingestion runs. RLS and read grants deny anonymous access and isolate application reads. Server mutations and secrets are not exposed to browser roles.

The migration is tested with embedded PostgreSQL (PGlite) and a minimal Supabase Auth schema harness. This validates SQL constraints and RLS, not hosted Supabase login/invitation delivery. A running Docker daemon and the Supabase CLI are needed for the full local stack:

```sh
supabase start
supabase db reset
```

Public signup is disabled in `supabase/config.toml`. Hosted settings must be configured separately and invitation/login verified before a deployed demo serves protected data. Budget account transactions, award/capacity tables/functions, detailed normalized catalog storage, and session persistence follow in their assigned workstreams. Spend reservation rows alone do not enforce the daily budget; do not activate paid inference before atomic spend enforcement exists.

## Contracts and fixtures

`@vispr/contracts` is the source of truth for version 0.1.0. It defines request, policy, capability, deployment, benchmark snapshot, task assessment, candidate, invitation, bid, award, usage and trace event schemas. `@vispr/contracts/fixtures` exports five task briefs, a policy, a request and synthetic trace data. Every fixture is clearly synthetic; none is evidence of benchmark scores or provider performance.

Interface-only packages establish seams for catalog repositories, Jev classification, pool selection, bidding, atomic award persistence, execution and SDK transport. They intentionally do not fake production behavior. Root tooling and contract changes go through the integration owner.

## Vercel

Import this monorepo and select `apps/web` as the project root with the Next.js preset. Enable source access outside the root for workspace dependencies. Install from the workspace lockfile. Check the build in a preview before sharing. Do not configure catalog cron until its authenticated route and durable leases exist; the daily worker is planned, not deployed in this scaffold.

## Verification scope

`pnpm check` typechecks every package, runs contract and database-boundary tests, then builds the web shell. CI runs the same command without vendor credentials. Live OpenRouter provider pinning, Jev classification, paid budgets, real invites and developer-device inference remain pending integration acceptance items.

## Initial verification record

On September 29, 2026, all eight workspace package typechecks passed, all 10 contract/database tests passed, and the Next.js production build passed. The production shell was inspected in the browser at localhost:3100. The local Docker daemon was unavailable, so full Supabase startup and invite delivery were not exercised. No paid model calls were made.
