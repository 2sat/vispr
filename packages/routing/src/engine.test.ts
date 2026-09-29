import { describe, expect, it, vi } from 'vitest';
import { SourceRoutingSchema, type Assessment, type CatalogSnapshot } from '@vispr/contracts';
import { demoPolicy, sampleRequest } from '@vispr/contracts/fixtures';
import { routeRequest, type AssessmentProvider } from './engine';
import { AssessmentService, MemoryAssessmentCache } from './cache';
import { ClassificationError, type DetailedClassifier } from './classification';
import { selectCandidates, type SelectionContext } from './selection';
import { evaluateOffer } from './offer-scoring';
const now = Date.parse('2026-09-29T20:00:00Z');
const assessment: Assessment = { task: 'coding', complexity: 'high', confidence: .9, continuity: 'fresh', continuityConfidence: .9, modelVersion: 'model-v1', questionVersion: 'q1' };
function setup() {
  const catalog: CatalogSnapshot = { id: 's', createdAt: new Date(now).toISOString(), deployments: ['a', 'b'].map(id => ({ id, modelId: 'm', providerId: id, transport: 'direct', inferenceModelId: 'm', status: 'active', capabilities: { tools: true, vision: false, structuredOutput: true, streaming: true, contextTokens: 10000, maxOutputTokens: 2000 } })), benchmarks: [{ modelId: 'm', benchmark: 'coding', benchmarkVersion: 'v1', value: .8, sourceUrl: 'https://example.com/fixture', retrievedAt: new Date(now).toISOString(), evidence: 'measured' }] };
  const selection: SelectionContext = { now, maximumEvidenceAgeMs: 1000, maximumMetricsAgeMs: 1000, remainingRequestBudgetMicros: 250000, estimateInputTokens: () => 100, profiles: { coding: [{ benchmark: 'coding', version: 'v1', weight: 1, minimum: 0, maximum: 1, higherIsBetter: true }] }, metrics: Object.fromEntries(['a', 'b'].map(id => [id, { inputMicrosPerMillionTokens: 1000000, outputMicrosPerMillionTokens: 3000000, estimatedCompletionMs: id === 'a' ? 500 : 1000, observedAt: new Date(now).toISOString() }])) };
  const service: AssessmentProvider = { assess: vi.fn().mockResolvedValue({ assessment, source: 'live', cache: 'disabled', attempts: [], timings: { keyMs: 0, lookupMs: 0, classificationMs: 1, totalMs: 1 } }) };
  return { applicationId: 'app', request: structuredClone(sampleRequest), policy: structuredClone(demoPolicy), catalog, context: { unresolvedToolCallIds: [] as string[], capabilityContextDigest: 'c1' }, service, selection, cacheEnabled: false, confidenceThreshold: .7, signal: new AbortController().signal, conservativePool: { task: 'coding' as const, deploymentIds: ['b'] }, remainingBudget: async () => 250000, now: () => now };
}
describe('routing service integration', () => {
  it('uses the conservative configured pool on a classifier outage without fabricating an assessment', async () => {
    const input = setup(); vi.mocked(input.service.assess).mockRejectedValue(new ClassificationError('HTTP_ERROR', 'unavailable'));
    const result = await routeRequest(input);
    expect(result.assessment).toBeNull(); expect(result.source).toBe('fallback'); expect(result.continuity.action).toBe('conservative_pool'); expect(result.candidates.map(c => c.deploymentId)).toEqual(['b']);
  });
  it('does not turn platform ledger errors into routing fallbacks', async () => {
    const input = setup(); vi.mocked(input.service.assess).mockRejectedValue(new Error('ledger denied'));
    await expect(routeRequest(input)).rejects.toThrow('ledger denied');
  });
  it('rechecks remaining spend after classification', async () => {
    const input = setup(); input.remainingBudget = async () => 1;
    expect((await routeRequest(input)).candidates.every(c => !c.eligible)).toBe(true);
  });
  it('retains an eligible current model on uncertainty even outside the capped pool', async () => {
    const input = setup(); input.policy.maxCandidates = 1;
    vi.mocked(input.service.assess).mockResolvedValue({ assessment: { ...assessment, confidence: .2 }, source: 'live', cache: 'disabled', attempts: [], timings: { keyMs: 0, lookupMs: 0, classificationMs: 1, totalMs: 1 } });
    const result = await routeRequest({ ...input, context: { ...input.context, currentDeploymentId: 'a' } });
    expect(result.continuity.action).toBe('retain'); expect(result.candidates[0]!.deploymentId).toBe('a');
  });
  it('reclassifies changed requests despite an old tool-cycle lock', async () => {
    const input = setup(); input.request.messages = [{ role: 'user', content: [{ type: 'image_url', url: 'https://example.com/image' }] }];
    const result = await routeRequest({ ...input, context: { ...input.context, currentDeploymentId: 'a', unresolvedToolCallIds: ['tool'] }, toolCycle: { locked: true, previousAssessment: assessment } });
    expect(input.service.assess).toHaveBeenCalledTimes(1); expect(result.source).toBe('live'); expect(result.continuity.action).toBe('auction'); expect(result.candidates.every(c => !c.eligible)).toBe(true);
  });
  it('skips classification only for a qualifying established tool result', async () => {
    const input = setup(); input.request.messages = [{ role: 'tool', content: 'result', toolCallId: 'tool' }];
    const result = await routeRequest({ ...input, context: { ...input.context, currentDeploymentId: 'a', unresolvedToolCallIds: ['tool'] }, toolCycle: { locked: true, previousAssessment: { ...assessment, continuity: 'tool_cycle' } } });
    expect(input.service.assess).not.toHaveBeenCalled(); expect(result.source).toBe('tool_cycle_state'); expect(result.continuity.action).toBe('retain');
  });
  it('rebuilds eligibility from current endpoint data even on a cache hit', async () => {
    const input = setup();
    const classifier: DetailedClassifier = { model: assessment.modelVersion, revision: assessment.questionVersion, assess: vi.fn(), assessDetailed: vi.fn().mockResolvedValue({ assessment, attempts: [] }) };
    input.service = new AssessmentService(classifier, new MemoryAssessmentCache()); input.cacheEnabled = true;
    expect((await routeRequest(input)).candidates[0]!.eligible).toBe(true);
    input.catalog.deployments.forEach(d => { d.status = 'disabled'; });
    const cached = await routeRequest(input);
    expect(cached.source).toBe('exact_cache'); expect(cached.candidates.every(c => !c.eligible)).toBe(true); expect(classifier.assessDetailed).toHaveBeenCalledTimes(1);
  });
  it('filters a Pareto frontier and score band using fixed utilities', () => {
    const input = setup(); input.selection.selection = { paretoOnly: true };
    const candidates = selectCandidates({ ...input, assessment }, input.selection);
    expect(candidates.find(c => c.deploymentId === 'b')!.reasons).toContain('Dominated on benchmark axes, cost, latency and uncertainty');
    input.selection.selection = { scoreBand: 0 };
    expect(selectCandidates({ ...input, assessment }, input.selection).find(c => c.deploymentId === 'b')!.reasons).toContain('Outside configured score band');
  });
  it('rechecks bid rates and does not let fast provider claims erase observed latency', () => {
    const input = setup();
    const bid = { id: 'bid', auctionId: 'auction', deploymentId: 'a', simulated: true as const, inputMicrosPerMillionTokens: 1000000, outputMicrosPerMillionTokens: 3000000, queueMs: 0, tokensPerSecond: 100000, receivedAt: new Date(now).toISOString(), validUntil: new Date(now + 1000).toISOString(), reservationToken: 'r' };
    const scored = evaluateOffer({ bid, policy: input.policy, inputTokens: 100, outputTokens: 1500, remainingRequestBudgetMicros: 100, quality: .8, uncertainty: 0, observedCompletionMs: 500 });
    expect(scored.estimatedLatencyMs).toBe(500); expect(scored.reason).toBe('Remaining request budget exceeded');
  });
});

describe('source-tagged routing', () => {
  const sourceRouting = { pools: [{ id: 'design-models', deploymentIds: ['b'] }], bindings: [{ source: 'design.preview', poolId: 'design-models' }] };
  it('bounds selection and prevents continuity from retaining outside the source pool', async () => {
    const input = setup(); input.request.source = 'design.preview'; input.policy.continuity = 'retain';
    const result = await routeRequest({ ...input, sourceRouting, context: { ...input.context, currentDeploymentId: 'a' } });
    expect(result.sourcePool).toEqual({ source: 'design.preview', poolId: 'design-models' });
    expect(result.candidates.map(c => c.deploymentId)).toEqual(['b']);
    expect(result.continuity.action).not.toBe('retain');
  });
  it('rejects unmapped sources before classification and leaves untagged calls unchanged', async () => {
    const input = setup(); input.request.source = 'typo';
    await expect(routeRequest({ ...input, sourceRouting })).rejects.toThrow('Unmapped invocation source');
    await expect(routeRequest(input)).rejects.toThrow('Unmapped invocation source');
    expect(input.service.assess).not.toHaveBeenCalled();
    delete input.request.source;
    expect((await routeRequest({ ...input, sourceRouting })).candidates.map(c => c.deploymentId)).toEqual(['a', 'b']);
  });
  it('cannot widen a source pool during classifier outage or bypass hard eligibility', async () => {
    const input = setup(); input.request.source = 'design.preview';
    vi.mocked(input.service.assess).mockRejectedValue(new ClassificationError('HTTP_ERROR', 'unavailable'));
    const result = await routeRequest({ ...input, sourceRouting, conservativePool: { task: 'coding', deploymentIds: ['a'] } });
    expect(result.candidates).toEqual([]);
    input.catalog.deployments[1]!.status = 'disabled';
    expect((await routeRequest({ ...input, sourceRouting })).candidates.every(c => !c.eligible)).toBe(true);
  });
  it('does not reuse a tool lock outside the tagged pool', async () => {
    const input = setup(); input.request.source = 'design.preview'; input.request.messages = [{ role: 'tool', toolCallId: 'tool', content: 'result' }];
    const result = await routeRequest({ ...input, sourceRouting, context: { ...input.context, currentDeploymentId: 'a', unresolvedToolCallIds: ['tool'] }, toolCycle: { locked: true, previousAssessment: { ...assessment, continuity: 'tool_cycle' } } });
    expect(input.service.assess).toHaveBeenCalledOnce();
    expect(result.candidates.map(c => c.deploymentId)).toEqual(['b']);
  });
  it('reapplies edited pool membership on a cache hit', async () => {
    const input = setup(); input.request.source = 'design.preview'; input.cacheEnabled = true;
    const classifier: DetailedClassifier = { model: assessment.modelVersion, revision: assessment.questionVersion, assess: vi.fn(), assessDetailed: vi.fn().mockResolvedValue({ assessment, attempts: [] }) };
    input.service = new AssessmentService(classifier, new MemoryAssessmentCache());
    expect((await routeRequest({ ...input, sourceRouting })).candidates.map(c => c.deploymentId)).toEqual(['b']);
    const changed = { ...sourceRouting, pools: [{ id: 'design-models', deploymentIds: ['a'] }] };
    const result = await routeRequest({ ...input, sourceRouting: changed });
    expect(result.source).toBe('exact_cache'); expect(result.candidates.map(c => c.deploymentId)).toEqual(['a']);
  });
  it('validates app configuration and never expands a pool with missing deployments', async () => {
    expect(SourceRoutingSchema.safeParse({ ...sourceRouting, bindings: [...sourceRouting.bindings, ...sourceRouting.bindings] }).success).toBe(false);
    expect(SourceRoutingSchema.safeParse({ ...sourceRouting, pools: [] }).success).toBe(false);
    const input = setup(); input.request.source = 'design.preview';
    expect((await routeRequest({ ...input, sourceRouting: { ...sourceRouting, pools: [{ id: 'design-models', deploymentIds: ['missing'] }] } })).candidates).toEqual([]);
  });
});

it('resolves a source by dynamic bands and rechecks new metrics on cached assessment', async () => {
  const input = setup(); input.request.source = 'fast'; input.cacheEnabled = true;
  const classifier: DetailedClassifier = { model: assessment.modelVersion, revision: assessment.questionVersion, assess: vi.fn(), assessDetailed: vi.fn().mockResolvedValue({ assessment, attempts: [] }) };
  input.service = new AssessmentService(classifier, new MemoryAssessmentCache());
  const sourceRouting = { pools: [{ id: 'interactive', criteria: { latencyMs: { max: 600 }, contextTokens: { min: 10000 } } }], bindings: [{ source: 'fast', poolId: 'interactive' }] };
  const result = await routeRequest({ ...input, sourceRouting });
  expect(result.candidates.filter(c => c.eligible).map(c => c.deploymentId)).toEqual(['a']);
  input.selection.metrics = { ...input.selection.metrics, a: { ...input.selection.metrics.a!, estimatedCompletionMs: 700 } };
  const cached = await routeRequest({ ...input, sourceRouting });
  expect(cached.source).toBe('exact_cache'); expect(cached.candidates.every(c => !c.eligible)).toBe(true);
});

it('rechecks source cost and latency bands against final offers', () => {
  const input = setup();
  const bid = { id: 'bid', auctionId: 'auction', deploymentId: 'a', simulated: true as const, inputMicrosPerMillionTokens: 1000000, outputMicrosPerMillionTokens: 3000000, queueMs: 0, tokensPerSecond: 100000, receivedAt: new Date(now).toISOString(), validUntil: new Date(now + 1000).toISOString(), reservationToken: 'r' };
  const offer = { bid, policy: input.policy, inputTokens: 100, outputTokens: 1500, remainingRequestBudgetMicros: 250000, quality: .8, uncertainty: 0, observedCompletionMs: 500 };
  expect(evaluateOffer({ ...offer, poolCriteria: { estimatedCostMicros: { max: 4599 } } }).eligible).toBe(false);
  expect(evaluateOffer({ ...offer, poolCriteria: { latencyMs: { max: 499 } } }).eligible).toBe(false);
});
