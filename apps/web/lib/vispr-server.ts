'use server';

// Server-side seam between the screens and Vispr. Keeping this on the server
// means the SDK key never reaches the browser.

import { fixtureRun, demoTrace, policies, scenarios } from './demo-fixtures';
import type { RunRequest, RunResult, TraceView } from './types';

const useFixtures = () => process.env.VISPR_DEMO_FIXTURES === '1';

export async function runScenario(req: RunRequest): Promise<RunResult> {
  if (!scenarios.some((s) => s.id === req.scenarioId)) return { ok: false, error: 'Unknown scenario.' };
  if (!policies.some((p) => p.id === req.policyId)) return { ok: false, error: 'Unknown policy.' };

  if (useFixtures()) return { ok: true, run: fixtureRun(req.scenarioId, req.policyId) };

  if (!process.env.VISPR_API_KEY) {
    // Spec: missing credentials are explicit, never replaced with fake responses.
    return { ok: false, error: 'VISPR_API_KEY is not set. Configure it, or set VISPR_DEMO_FIXTURES=1 for illustrative data.' };
  }

  // TODO(milestone 4): stream through @vispr/sdk, e.g.
  //   const run = await vispr.inference.stream({ policyId, messages, idempotencyKey });
  //   for await (const event of run.events) { ... }
  // then map the completion + trace events into a RunSummary.
  return { ok: false, error: 'Live SDK path is not wired yet.' };
}

export async function getRunTrace(runId: string): Promise<TraceView | null> {
  if (useFixtures()) return runId === demoTrace.run.runId ? demoTrace : null;
  // TODO(milestone 2): GET the trace from the routing service's trace route.
  return null;
}
