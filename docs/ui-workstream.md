# Product UI workstream: first slice

Branch: `work/ui`. Scope: `apps/web` presentation, UI fixtures and tests. Shared contracts, service routes, database migrations and other streams are unchanged.

## Implemented

- Five scenario selectors seeded from `@vispr/contracts/fixtures`.
- Editable request draft and local policy draft, validated against shared contracts.
- Synthetic, cancellable example playback with assessment, eligible/excluded candidates, simulated offers, scripted award, response, usage and completion.
- Trace details, a captured draft/policy snapshot and JSON export.
- Sandboxed static design preview and HTML source view. Scripts, forms and network resources are disabled for the bundled preview.
- Responsive single/two-column presentation, keyboard focus, labeled fields and status text.

All example outputs are prerecorded synthetic fixtures, not inference. Edited prompts/preferences are captured for interface testing; they do not recalculate the fixture trace. The UI says this prominently. Drafts and runs are held in memory only. Switching scenarios resets the draft and clears the previous playback.

## Integration seam

`TraceViewer` consumes shared `TraceEvent[]`. `appendEvent` assembles ordered events for one request and ignores duplicate, out-of-order or late terminal events. The execution stream must supply the ordered protocol; reconnect/resume buffering is not implemented. Replace the fixture timer with the SDK stream once platform supplies it. Error and continuity events already have presentation support.

`fixture-run.ts` extends the shared assessment fixture with clearly named UI-only examples. It does not implement Jev, eligibility math or auction arbitration. Current sample offers/timestamps are static illustrative data and must never be submitted to the real auction.

The request snapshot uses `InferenceRequestSchema`; the local draft uses `PolicySchema`. Live policy persistence, auth, catalog/provider management screens, attachment handling, real streaming, and history/replay billing remain pending. No fake API endpoints were added.

## Verification

```sh
pnpm --filter @vispr/web test
pnpm check
```

The five UI tests cover all scenario event sequences, duplicate/out-of-order/wrong-request rejection, cancellation with partial output, provider failure rendering state, and the static preview fixture constraints. The root tests remain the 10 foundation checks. Integration owner: add the UI test command to CI's required checks when merging this slice; current CI still runs only the root suite plus typechecks/build.

Browser checks: support example completes with 8 events; invalid policy weights disable playback and show validation feedback; scenario changes restore the relevant defaults; the design iframe renders its static example. No paid requests were issued.
