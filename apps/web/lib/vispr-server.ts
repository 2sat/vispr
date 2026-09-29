'use server';

// Server-side seam between the screens and Vispr. Keeping this on the server
// means the SDK key never reaches the browser.

import { validateBidPolicy } from './bidding';
import { fixtureRun, demoTrace, policies, providerDeployments, scenarios } from './demo-fixtures';
import { validateEndpointUrl, type DeploymentMode } from './endpoint-url';
import type {
  BidPolicy, EndpointDraft, ProbeResult, ProviderDeployment, RunRequest, RunResult, SaveResult, TraceView,
} from './types';

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
