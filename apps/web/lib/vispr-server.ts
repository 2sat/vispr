'use server';

// Server-side seam between the screens and Vispr. Keeping this on the server
// means the SDK key never reaches the browser.

import { fixtureRun, demoTrace, policies, scenarios } from './demo-fixtures';
import type { RunRequest, RunResult, RunSummary, TraceView } from './types';
import { cookies } from 'next/headers';
import { randomUUID } from 'node:crypto';
import { generateDemoResponse, presenterAuthorized, readDemoData, sealDemoData } from './openai-demo';
import { rankBids } from './format';

const useFixtures = () => process.env.VISPR_DEMO_FIXTURES === '1';

export async function runScenario(req: RunRequest): Promise<RunResult> {
  if (!req || !scenarios.some((s) => s.id === req.scenarioId)) return { ok: false, error: 'Unknown scenario.' };
  if (!policies.some((p) => p.id === req.policyId)) return { ok: false, error: 'Unknown policy.' };

  if (useFixtures()) {
    const run = fixtureRun(req.scenarioId, req.policyId);
    if (!req.live) return { ok: true, run };
    const secret = process.env.VISPR_DEMO_ACCESS_CODE ?? '';
    const jar = await cookies();
    if (!presenterAuthorized(req.presenterCode, jar.get('vispr-demo-presenter')?.value, secret)) {
      return { ok: false, error: 'Enter the presenter code to enable OpenAI responses.' };
    }
    try {
      const result = await generateDemoResponse(req);
      run.runId = `openai-${randomUUID()}`;
      run.output = result.output;
      run.generation = result.generation;
      run.usage = null;
      const trace = illustrativeTrace(run);
      run.winner = trace.run.winner;
      const options = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/', maxAge: 3600 };
      jar.set('vispr-demo-presenter', sealDemoData({ presenter: true, expires: Date.now() + 3600000 }, secret), options);
      // Keep only per-browser trace metadata, never the prompt/response or API key.
      jar.set(`vispr-demo-${req.scenarioId}`, sealDemoData({ run: { ...run, output: '' }, expires: Date.now() + 3600000 }, secret), options);
      return { ok: true, run };
    } catch (error) {
      return { ok: false, error: error instanceof Error && error.name !== 'TimeoutError'
        ? error.message : 'OpenAI took too long. Use the prepared demo or try a shorter request.' };
    }
  }

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
  if (useFixtures()) {
    const scenario = scenarios.find(s => `demo-${s.id}` === runId);
    if (scenario) return illustrativeTrace(fixtureRun(scenario.id, scenario.defaultPolicyId));
    if (!/^openai-[0-9a-f-]{36}$/.test(runId)) return null;
    const jar = await cookies();
    const secret = process.env.VISPR_DEMO_ACCESS_CODE ?? '';
    for (const item of scenarios) {
      const data = readDemoData<{ run: RunSummary; expires: number }>(jar.get(`vispr-demo-${item.id}`)?.value, secret);
      if (data?.run.runId === runId && data.expires > Date.now()) return illustrativeTrace(data.run);
    }
    return null;
  }
  // TODO(milestone 2): GET the trace from the routing service's trace route.
  return null;
}

function illustrativeTrace(run: RunSummary): TraceView {
  const trace = structuredClone(demoTrace);
  const scenario = scenarios.find(s => s.id === run.scenarioId)!;
  trace.run = { ...run };
  trace.scenarioName = scenario.name;
  trace.policy = policies.find(p => p.id === run.policyId)!;
  trace.assessment.taskFamilyLabel = scenario.name;
  trace.assessment.extracted.outputFormat = scenario.outputKind;
  const winner = rankBids(trace.auction.bids, trace.policy.weights)[0];
  if (winner) {
    trace.run.winner = { model: winner.model, provider: winner.provider };
    trace.auction.bids = trace.auction.bids.map(b => ({ ...b, status: b.status === 'rejected' ? 'rejected' : b.deploymentId === winner.deploymentId ? 'awarded' : 'valid' }));
  }
  return trace;
}
