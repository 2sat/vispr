import { AssessmentSchema, CatalogSnapshotSchema, InferenceRequestSchema, PolicySchema, type Assessment, type Candidate, type CatalogSnapshot, type InferenceRequest, type Policy } from '@vispr/contracts';
import type { PoolSelector } from './index';

export interface BenchmarkRule {
  benchmark: string;
  version: string;
  weight: number;
  minimum: number;
  maximum: number;
  higherIsBetter: boolean;
  required?: boolean;
  minimumNormalizedScore?: number;
}
export interface EndpointMetrics {
  inputMicrosPerMillionTokens: number;
  outputMicrosPerMillionTokens: number;
  estimatedCompletionMs: number;
  observedAt: string;
}
export interface SelectionContext {
  // Supplied by the execution adapter; include messages, images and tool schemas.
  estimateInputTokens(request: InferenceRequest, deploymentId: string): number;
  metrics: Readonly<Record<string, EndpointMetrics>>;
  profiles: Readonly<Partial<Record<Assessment['task'], readonly BenchmarkRule[]>>>;
  now: number;
  maximumEvidenceAgeMs: number;
  maximumMetricsAgeMs: number;
  remainingRequestBudgetMicros: number;
}
export interface ScoreBreakdown { quality: number; cost: number; latency: number; uncertaintyPenalty: number; total: number }
export interface ScoredCandidate extends Candidate { score: ScoreBreakdown | null }

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const unsignedInteger = (n: number) => Number.isSafeInteger(n) && n >= 0;
function fresh(timestamp: string, now: number, maxAge: number) {
  const time = Date.parse(timestamp);
  return Number.isFinite(time) && time <= now && now - time <= maxAge;
}
export function estimateCostMicros(input: number, output: number, inputRate: number, outputRate: number): number {
  if (![input, output, inputRate, outputRate].every(unsignedInteger)) throw new Error('Token counts and rates must be nonnegative safe integers');
  // Round each billable component up independently to avoid under-reserving
  // when a provider rounds input and output charges separately.
  const total = (BigInt(input) * BigInt(inputRate) + 999999n) / 1000000n
    + (BigInt(output) * BigInt(outputRate) + 999999n) / 1000000n;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Estimated cost exceeds safe integer range');
  return Number(total);
}
export function scoreUtilities(policy: Policy, quality: number, costMicros: number, latencyMs: number, uncertainty: number): ScoreBreakdown {
  PolicySchema.parse(policy);
  if (!Number.isFinite(quality) || quality < 0 || quality > 1 || !unsignedInteger(costMicros) || !Number.isFinite(latencyMs) || latencyMs < 0 || !Number.isFinite(uncertainty) || uncertainty < 0 || uncertainty > 1) throw new Error('Invalid scoring inputs');
  const cost = 1 - clamp(costMicros / policy.requestBudgetMicros);
  const latency = 1 - clamp(latencyMs / policy.maxLatencyMs);
  const uncertaintyPenalty = policy.uncertaintyPenalty * uncertainty;
  return { quality, cost, latency, uncertaintyPenalty, total: policy.weights.quality * quality + policy.weights.cost * cost + policy.weights.latency * latency - uncertaintyPenalty };
}
function validateContext(context: SelectionContext) {
  if (!unsignedInteger(context.remainingRequestBudgetMicros) || !Number.isFinite(context.now) || !Number.isFinite(context.maximumEvidenceAgeMs) || context.maximumEvidenceAgeMs < 0 || !Number.isFinite(context.maximumMetricsAgeMs) || context.maximumMetricsAgeMs < 0) throw new Error('Invalid selection context');
  for (const rules of Object.values(context.profiles)) {
    if (!Number.isFinite(rules.reduce((sum, rule) => sum + rule.weight, 0))) throw new Error('Benchmark weights overflow');
    const seen = new Set<string>();
    for (const rule of rules) {
      if (!Number.isFinite(rule.weight) || rule.weight <= 0 || !Number.isFinite(rule.minimum) || !Number.isFinite(rule.maximum) || rule.minimum >= rule.maximum || !Number.isFinite(rule.maximum - rule.minimum) || (rule.minimumNormalizedScore !== undefined && (!Number.isFinite(rule.minimumNormalizedScore) || rule.minimumNormalizedScore < 0 || rule.minimumNormalizedScore > 1))) throw new Error('Invalid benchmark profile');
      const key = JSON.stringify([rule.benchmark, rule.version]);
      if (seen.has(key)) throw new Error('Duplicate benchmark profile rule');
      seen.add(key);
    }
  }
}
export function selectCandidates(input: { request: InferenceRequest; policy: Policy; assessment: Assessment; catalog: CatalogSnapshot }, context: SelectionContext): ScoredCandidate[] {
  const request = InferenceRequestSchema.parse(input.request);
  const policy = PolicySchema.parse(input.policy);
  const assessment = AssessmentSchema.parse(input.assessment);
  const catalog = CatalogSnapshotSchema.parse(input.catalog);
  validateContext(context);
  if (request.policyId !== policy.id) throw new Error('Request policy does not match supplied policy');
  if (new Set(catalog.deployments.map(d => d.id)).size !== catalog.deployments.length) throw new Error('Duplicate deployment IDs');
  const profile = context.profiles[assessment.task] ?? [];
  const hasImages = request.messages.some(m => m.role === 'user' && Array.isArray(m.content) && m.content.some(part => part.type === 'image_url'));
  const needsTools = Boolean(request.tools?.length) || request.messages.some(m => m.role === 'tool' || (m.role === 'assistant' && m.toolCalls?.length));
  const candidates = catalog.deployments.map((deployment): ScoredCandidate => {
    const reasons: string[] = [];
    const capabilities = deployment.capabilities;
    if (deployment.status !== 'active') reasons.push('Deployment is not active');
    if (!capabilities.streaming) reasons.push('Streaming is unsupported');
    if (hasImages && !capabilities.vision) reasons.push('Image input is unsupported');
    if (needsTools && !capabilities.tools) reasons.push('Tool protocol is unsupported');
    if (request.outputSchema && !capabilities.structuredOutput) reasons.push('Structured output is unsupported');
    const inputTokens = context.estimateInputTokens(request, deployment.id);
    if (!unsignedInteger(inputTokens)) reasons.push('Input token estimate is unavailable');
    else if (inputTokens + request.maxOutputTokens > capabilities.contextTokens) reasons.push('Context capacity is insufficient');
    if (request.maxOutputTokens > capabilities.maxOutputTokens || request.maxOutputTokens > policy.maxOutputTokens) reasons.push('Output token limit exceeded');

    let weighted = 0, coveredWeight = 0, uncertainWeight = 0;
    const totalWeight = profile.reduce((sum, rule) => sum + rule.weight, 0);
    if (!profile.length) reasons.push('No benchmark profile configured for this task');
    for (const rule of profile) {
      const matching = catalog.benchmarks.filter(b => b.modelId === deployment.modelId && b.benchmark === rule.benchmark && b.benchmarkVersion === rule.version && fresh(b.retrievedAt, context.now, context.maximumEvidenceAgeMs) && b.value >= rule.minimum && b.value <= rule.maximum)
        .sort((a, b) => Number(a.evidence === 'proxy') - Number(b.evidence === 'proxy') || Date.parse(b.retrievedAt) - Date.parse(a.retrievedAt));
      let observation = matching[0];
      if (observation && matching.some(other => other.evidence === observation!.evidence && Date.parse(other.retrievedAt) === Date.parse(observation!.retrievedAt) && other.value !== observation!.value)) {
        reasons.push(`Conflicting benchmark evidence: ${rule.benchmark}`);
        observation = undefined;
      }
      const proxy = observation?.evidence === 'proxy';
      if (!observation || proxy) {
        uncertainWeight += rule.weight;
        if (rule.required || rule.minimumNormalizedScore !== undefined) reasons.push(`Required measured evidence missing: ${rule.benchmark}`);
        else if (!policy.allowIncompleteCoverage) reasons.push(`Incomplete benchmark coverage: ${rule.benchmark}`);
      }
      if (observation) {
        const normalized = (observation.value - rule.minimum) / (rule.maximum - rule.minimum);
        const score = rule.higherIsBetter ? normalized : 1 - normalized;
        if (rule.minimumNormalizedScore !== undefined && score < rule.minimumNormalizedScore) reasons.push(`Benchmark minimum not met: ${rule.benchmark}`);
        weighted += score * (rule.weight / totalWeight); coveredWeight += rule.weight;
      }
    }
    const quality = coveredWeight ? clamp(weighted / (coveredWeight / totalWeight)) : null;
    if (quality === null) reasons.push('Quality cannot be established from available evidence');
    else if (quality < policy.minimumQuality) reasons.push('Minimum quality not met');

    const metrics = context.metrics[deployment.id];
    let estimatedCostMicros: number | null = null;
    let estimatedLatencyMs: number | null = null;
    if (!metrics || !fresh(metrics.observedAt, context.now, context.maximumMetricsAgeMs)) reasons.push('Endpoint metrics are missing or stale');
    else {
      if (!Number.isFinite(metrics.estimatedCompletionMs) || metrics.estimatedCompletionMs < 0) reasons.push('Invalid latency estimate');
      else { estimatedLatencyMs = metrics.estimatedCompletionMs; if (estimatedLatencyMs > policy.maxLatencyMs) reasons.push('Latency limit exceeded'); }
      if (unsignedInteger(inputTokens)) {
        try { estimatedCostMicros = estimateCostMicros(inputTokens, request.maxOutputTokens, metrics.inputMicrosPerMillionTokens, metrics.outputMicrosPerMillionTokens); }
        catch { reasons.push('Invalid or unbounded price estimate'); }
      }
      if (estimatedCostMicros !== null && estimatedCostMicros > Math.min(policy.requestBudgetMicros, context.remainingRequestBudgetMicros)) reasons.push('Remaining request budget exceeded');
    }
    const score = quality !== null && estimatedCostMicros !== null && estimatedLatencyMs !== null ? scoreUtilities(policy, quality, estimatedCostMicros, estimatedLatencyMs, totalWeight ? uncertainWeight / totalWeight : 1) : null;
    return { deploymentId: deployment.id, eligible: reasons.length === 0, reasons, quality, estimatedCostMicros, estimatedLatencyMs, score };
  });
  const ranked = candidates.filter(c => c.eligible).sort((a, b) => b.score!.total - a.score!.total || a.estimatedLatencyMs! - b.estimatedLatencyMs! || (a.deploymentId < b.deploymentId ? -1 : a.deploymentId > b.deploymentId ? 1 : 0));
  for (const candidate of ranked.slice(policy.maxCandidates)) { candidate.eligible = false; candidate.reasons.push('Outside configured candidate pool size'); }
  // Preserve every excluded deployment for the trace. Scoring uses fixed policy
  // bounds, never min/max values from competing candidates.
  return candidates.sort((a, b) => Number(b.eligible) - Number(a.eligible) || (b.score?.total ?? -Infinity) - (a.score?.total ?? -Infinity) || (a.deploymentId < b.deploymentId ? -1 : a.deploymentId > b.deploymentId ? 1 : 0));
}
export function createPoolSelector(context: SelectionContext): PoolSelector {
  return { select: input => selectCandidates(input, context).map(({ score: _score, ...candidate }) => candidate) };
}
