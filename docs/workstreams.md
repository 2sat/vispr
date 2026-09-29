# Four-workstream development split

Start parallel implementation only after the shared foundation builds and its contracts/fixtures are available. Each device uses its own clone and branch; do not sync live working directories between devices. Branch names below are proposed conventions, not branches created by this document.

| Stream / suggested branch | Ownership | Independent acceptance |
| --- | --- | --- |
| Platform and execution / `work/platform` | `packages/db`, `packages/providers`, `packages/sdk`, server API/auth integration, migrations, CI and deployment | Invite-only access, streaming, provider pinning, cost reconciliation, SDK/API compatibility |
| Catalog / `work/catalog` | `packages/catalog`, source fixtures and ingestion commands | Idempotent imports, alias review, validation, atomic snapshots, resumable refresh |
| Routing and auctions / `work/routing` | `packages/routing`, `packages/auction`, Jev questions and deterministic decision tests | Eligibility, continuity, scoring, bid validation, fallback rules |
| Product UI / `work/ui` | `apps/web` presentation/components and frontend tests | Five scenarios, policy forms, provider/catalog screens, traces and design preview |

The platform stream is the integration owner. Its API route files inside `apps/web` are reserved for that stream; the UI stream owns pages/components. Coordinate changes to shared layout before editing. Other streams can propose migrations, but the integration owner assigns ordered migration IDs and merges them. Shared contracts and root tooling are integration-owned; change requests describe compatibility impact and fixture updates before implementation.

## Foundation handoff

The foundation supplies pnpm workspace configuration, Next.js shell, typed Zod contracts, representative synthetic fixtures, package boundaries, Supabase local configuration/migrations, and build/typecheck/test commands. Synthetic fixtures test software contracts only; they are not benchmark evidence or real provider results.

Interface changes use a pull request and contract version change when incompatible. All streams consume `@vispr/contracts`; never copy request/response types into private packages. UI works with labeled fixtures until real services arrive. No stream invents an unrecorded fallback or relaxes hard policy constraints.

## Integration protocol

1. Pull the current main branch before branching; read the demo specification and engineering plan.
2. Keep commits small and scoped to owned files. Make dependency needs explicit in each PR.
3. Run the shared verification commands and the workstream's acceptance tests.
4. Merge through the integration owner into one integration preview. Rebase frequently; do not wait for all four branches to finish before integrating.
5. Record completed, blocked and remaining acceptance items in each PR. Mocked behavior is not live verification.
6. Keep server credentials out of source, fixtures, logs and client bundles. Production configuration is managed by the integration owner.

Paid testing is centrally coordinated. Four local databases would create four independent budgets: use one shared test spending ledger or explicitly partition a centrally approved allowance before parallel paid runs. Routine work uses deterministic fixtures. Different devices do not necessarily imply separate model-account quotas.

## Cross-stream dependencies

Catalog publishes normalized snapshots consumed by routing. Routing emits eligible deployment IDs and auction decisions consumed by execution. Execution returns the shared event/usage protocol consumed by the SDK and UI. Database transactions own award, capacity and spend concurrency; routing packages propose decisions but do not implement their own competing ledgers.

The self-hosted developer endpoint is an external dependency. Build against the direct adapter contract, keep its registration pending until reachable, and do not report a live self-hosted acceptance check as passed before it is exercised.

## Suggested first assignments after foundation

- Platform: one pinned OpenRouter call through both developer interfaces, plus auth/budget enforcement before inviting users.
- Catalog: Artificial Analysis connector and idempotent import pipeline against snapshots.
- Routing: capability/coverage filtering and score decomposition, then Jev and continuity.
- UI: scenario workspace and trace viewer against shared fixtures, then policy/provider/catalog screens.
