import { createHash } from 'node:crypto';
import { z } from 'zod';
import { InvocationSourceSchema, PoolCriteriaSchema, SourceRoutingSchema, type Policy } from '@vispr/contracts';
import discovery from '../../../docs/data/demo-pool-discovery.json';

const tokenCount = z.number().int().nonnegative().max(10_000_000);
export const WorkloadSchema = z.strictObject({ inputTokens: tokenCount, maxOutputTokens: tokenCount.positive() });
export const ProposalInputSchema = z.strictObject({
  policyId: z.string().min(1).max(200), policyVersion: z.number().int().positive(),
  snapshotId: z.string().min(1).max(200), source: InvocationSourceSchema,
  workload: WorkloadSchema, criteria: PoolCriteriaSchema,
  rationale: z.string().min(1).max(4000),
});
export type ProposalInput = z.infer<typeof ProposalInputSchema>;
export const snapshotId = createHash('sha256').update(JSON.stringify(discovery)).digest('hex');
const units = { latencyMs: 'full completion milliseconds', estimatedCostMicros: 'USD millionths per request', contextTokens: 'tokens', maxOutputTokens: 'tokens', benchmarks: 'independent versioned normalized axes, higher normalized score is better' };
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
export function modelSpace(applicationId: string, policy: Policy) {
  return {
    applicationId, policy, snapshotId, retrievedAt: discovery.retrievedAt, sourceUrl: discovery.sourceUrl,
    units, criteriaSchema: z.toJSONSchema(PoolCriteriaSchema),
    evidenceStatus: 'discovery-only', benchmarkAxes: [],
    models: discovery.models.map(model => ({
      id: model.id, name: model.name, contextTokens: model.context_length,
      advertisedInputUsdPerMillionTokens: Number(model.pricing.prompt) * 1e6,
      advertisedOutputUsdPerMillionTokens: Number(model.pricing.completion) * 1e6,
      pricing: model.pricing, // Preserve published tiers and extra charges.
      architecture: model.architecture, supportedParameters: model.supported_parameters,
      completionLatencyMs: null, benchmarkObservations: [], registeredDeploymentIds: [],
    })),
    instructions: [
      'Use each relevant versioned benchmark as an independent hard axis. Never replace missing evidence with zero, fictional scores, or a composite score.',
      'Propose fixed latency/cost bounds and benchmark floors for a stable invocation source. Do not select or freeze a list of model names.',
      'Published prices and model capabilities are discovery hints, not binding bids or certified deployment evidence.',
      'Call propose_static_manifold with this snapshotId and policy version. Its result is a draft for builder review, not an active routing policy.',
    ],
  };
}
export function proposeManifold(applicationId: string, policy: Policy, raw: unknown) {
  const input = ProposalInputSchema.parse(raw);
  if (input.snapshotId !== snapshotId) throw new Error('Catalog snapshot changed. Read the model space again.');
  if (input.policyId !== policy.id || input.policyVersion !== policy.version) throw new Error('Policy changed or is unavailable. Read the model space again.');
  const { criteria, workload } = input;
  if (criteria.latencyMs?.max === undefined || criteria.estimatedCostMicros?.max === undefined) throw new Error('A static manifold needs explicit latency and request-cost ceilings.');
  if (criteria.latencyMs.max > policy.maxLatencyMs || criteria.estimatedCostMicros.max > policy.requestBudgetMicros) throw new Error('Manifold ceilings cannot relax application policy.');
  if (workload.maxOutputTokens > policy.maxOutputTokens) throw new Error('Workload output exceeds application policy.');
  for (const value of [criteria.estimatedCostMicros.min, criteria.estimatedCostMicros.max]) if (value !== undefined && !Number.isSafeInteger(value)) throw new Error('Cost bounds must use integer USD millionths.');
  for (const axis of criteria.benchmarks ?? []) {
    if (axis.required === false || axis.minimumNormalizedScore === undefined) throw new Error('Each selected benchmark needs a hard floor and cannot be optional.');
  }
  const effectiveCriteria = {
    ...criteria,
    ...(criteria.benchmarks ? { benchmarks: criteria.benchmarks.map(axis => ({ ...axis, required: true })) } : {}),
  };
  const identity = { applicationId, policyId: policy.id, policyVersion: policy.version, snapshotId, source: input.source, workload, criteria: effectiveCriteria };
  const proposalId = createHash('sha256').update(canonical(identity)).digest('hex');
  const poolId = `manifold-${proposalId.slice(0, 24)}`;
  const sourceRouting = SourceRoutingSchema.parse({ pools: [{ id: poolId, criteria: effectiveCriteria }], bindings: [{ source: input.source, poolId }] });
  const preview = discovery.models.map(model => {
    const advertisedCostMicros = Math.ceil((Number(model.pricing.prompt) * workload.inputTokens + Number(model.pricing.completion) * workload.maxOutputTokens) * 1e6);
    const exclusionReasons: string[] = [];
    if (advertisedCostMicros > criteria.estimatedCostMicros!.max! || advertisedCostMicros < (criteria.estimatedCostMicros!.min ?? 0)) exclusionReasons.push('Advertised base-rate estimate outside cost band');
    if (workload.inputTokens + workload.maxOutputTokens > model.context_length) exclusionReasons.push('Workload exceeds advertised context');
    for (const [name, value, band] of [
      ['context', model.context_length, criteria.contextTokens],
      ['output', model.top_provider.max_completion_tokens, criteria.maxOutputTokens],
    ] as const) if (value !== null && band && (value < (band.min ?? 0) || value > (band.max ?? Infinity))) exclusionReasons.push(`Advertised ${name} limit outside band`);
    if (model.top_provider.max_completion_tokens !== null && workload.maxOutputTokens > model.top_provider.max_completion_tokens) exclusionReasons.push('Workload exceeds advertised output limit');
    return { modelId: model.id, advertisedCostMicros, status: exclusionReasons.length ? 'excluded' : 'unverified', exclusionReasons, missingEvidence: ['registered deployment', 'fresh full-completion latency and binding cost', ...(criteria.benchmarks ?? []).map(axis => `benchmark:${axis.benchmark}@${axis.version}`), ...(criteria.requiredCapabilities ?? []).map(capability => `deployment capability:${capability}`)] };
  });
  return {
    schemaVersion: '1', proposalId, ...identity, rationale: input.rationale,
    status: 'proposed', active: false, persisted: false, sourceRouting, preview,
    eligibleDeploymentIds: [],
    activationBlockers: ['Builder approval and durable source-binding integration required', 'Verified deployment metrics and benchmark evidence required', 'Live source routing and auction enforcement are not yet integrated in the execution service'],
    enforcement: {
      geometry: 'intersection of independent hard bands', membership: 'dynamic against fixed criteria',
      onMissingEvidence: 'exclude', onEmptyPool: 'fail closed; never widen bands',
      checkpoints: ['before auction invitation', 'on received bid', 'before award and dispatch'],
      scope: 'Only the authenticated application and this exact invocation source. Re-evaluate cost for each actual request shape; preview token counts are not a billing bound.',
    },
  };
}
