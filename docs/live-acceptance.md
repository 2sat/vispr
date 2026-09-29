# Live integration handoff

September 29, 2026. Work stopped at the user's wrap-up request.

## Implemented

- Active, reviewed application routing configurations connect Jev, capability/evidence pool selection, simulated bids, PostgreSQL capacity and one-winner award, and pinned execution. The explicitly selected offering remains available for transport acceptance when no reviewed routing configuration is active.
- Pool publication validates benchmark versions, endpoint cost/completion-time evidence, freshness, and registered endpoint identity. Publication is atomic and operator-owned. No real qualified pool has been published yet.
- Spend reservation includes the classifier and the maximum reviewed execution bound. The ledger settles both costs, while provider usage remains separate. Unknown classification or execution charges remain encumbered. Maintenance and reconciliation release eligible capacity.
- A live SDK workspace loads application policies, runs all five task prompts, supports cancellation, loads persisted traces, and exports real events. Design preview blocks scripts and network access. The live workspace is available at the homepage; existing presenter pages remain available.
- Invited password login and application-key issuance are wired. An expiring, deployment-scoped acceptance operator credential permits creating a demo account without sending email, staging benchmark data, and reconciling vendor billing.
- `pnpm smoke:hosted` provides read-only preflight; `--run` dispatches one SDK or OpenAI-compatible request without retries and records billing/ledger evidence.

## Verification

Node 24.18.0: 150 tests across 20 files, all package/web typechecks, and the production build passed after integration into current main. Controlled tests cover all five task types, source restrictions, classifier outage fallback, quality failure, cancellation at the award boundary, and unknown charges. These are software integration checks, not live model-quality or billing evidence.

The routing migration was applied to hosted Supabase project `xcqpiusinmfuicwmizqz`; the routing table and classification/publication RPCs were verified afterward. Foundation and platform migrations were already hosted. No paid inference call was made by this work and no demo account was provisioned before the wrap-up request.

## Remaining acceptance

1. Create the requested demo account/application and run real SDK/API inference against a reviewed bounded offering, capturing actual serving identity, generation and vendor billing.
2. Stage/review benchmark model/version/configuration mappings and endpoint evidence, then publish a qualified catalog. Synthetic fixtures and public inventory discovery are not a qualified pool.
3. Run all five tasks through the hosted marketplace path; verify provider failures, cancellation, multi-connection budget/award races, and deployed invited login.
4. Session continuity remains rejected explicitly pending its durable session/lease integration.

Vercel's sensitive production credentials are usable in hosted functions but cannot be exported with `vercel env pull`. The acceptance operator is disabled by default and requires a matching token plus an expiry within two hours. Any acceptance deployment uses its own URL; it is not promoted to the public production alias.

