'use server';

// Server-side seam between the screens and Vispr. Keeping this on the server
// means the SDK key never reaches the browser.

import { validateBidPolicy } from './bidding';
import { fixtureRun, demoTrace, policies, providerDeployments, scenarios } from './demo-fixtures';
import { validateEndpointUrl, type DeploymentMode } from './endpoint-url';
import type {
  BidPolicy, EndpointDraft, ProbeResult, ProviderDeployment, RunRequest, RunResult, RunSummary, SaveResult, TraceView,
} from './types';
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
    if (!req.live) return { ok: true, run: illustrativeTrace(run).run };
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

export async function getRunTrace(runId: string, policyId?: string): Promise<TraceView | null> {
  if (useFixtures()) {
    const scenario = scenarios.find(s => `demo-${s.id}` === runId);
    if (scenario) {
      if (policyId && !policies.some(p => p.id === policyId)) return null;
      return illustrativeTrace(fixtureRun(scenario.id, policyId ?? scenario.defaultPolicyId));
    }
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
  const ranked = rankBids(trace.auction.bids, trace.policy.weights);
  trace.run.bidCount = ranked.length;
  const winner = ranked[0];
  if (winner) {
    trace.run.winner = { model: winner.model, provider: winner.provider };
    trace.auction.bids = trace.auction.bids.map(b => ({ ...b, status: b.status === 'rejected' ? 'rejected' : b.deploymentId === winner.deploymentId ? 'awarded' : 'valid' }));
  }
  return trace;
}

// ---- Provider console ----
// Provider operations require operator credentials; enforce that in the auth
// layer before these run. Fixture mode never persists — the spec forbids
// relying on process-local state across serverless requests.

const deploymentMode = (): DeploymentMode => (process.env.VISPR_DEPLOYMENT_MODE === 'local' ? 'local' : 'hosted');

export async function listDeployments(): Promise<ProviderDeployment[] | null> {
  if (useFixtures()) return providerDeployments;
  // TODO(milestone 3): load the operator's deployments from PostgreSQL.
  return null;
}

export async function saveDeployment(
  offeringId: string,
  patch: { available?: boolean; bidPolicy?: BidPolicy },
): Promise<SaveResult> {
  if (patch.bidPolicy) {
    const problem = validateBidPolicy(patch.bidPolicy);
    if (problem) return { ok: false, error: problem };
  }
  if (useFixtures()) {
    const current = providerDeployments.find((d) => d.offeringId === offeringId);
    if (!current) return { ok: false, error: 'Unknown offering.' };
    return { ok: true, persisted: false, deployment: { ...current, ...patch } };
  }
  // TODO(milestone 3): conditional UPDATE on the deployment row, then return it.
  return { ok: false, error: 'Saving is not wired yet.' };
}

export async function probeEndpoint(draft: EndpointDraft): Promise<ProbeResult> {
  if (!draft.modelId.trim()) return { ok: false, error: 'Enter a model ID.' };
  if (!draft.secretRef.trim()) return { ok: false, error: 'Enter a secret reference.' };
  const needsUrl = draft.kind === 'openai-compatible' || draft.kind === 'hosted-open';
  if (needsUrl) {
    const check = validateEndpointUrl(draft.endpoint, deploymentMode());
    if (!check.ok) return check;
  }
  if (useFixtures()) {
    // Canned result so the flow can be walked through; the page shows the illustrative badge.
    return { ok: true, features: { streaming: true, tools: false, 'structured-output': true, images: false } };
  }
  // TODO(milestone 3): call the endpoint through the AI SDK adapter and probe each
  // declared feature (streaming, tool call, JSON schema, image input) for real.
  return { ok: false, error: 'Connection checks are not wired yet.' };
}
