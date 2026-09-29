import { describe, expect, it } from 'vitest';
import type { Assessment, CatalogSnapshot, Deployment } from '@vispr/contracts';
import { demoPolicy, sampleRequest } from '@vispr/contracts/fixtures';
import { selectCandidates, estimateCostMicros, type SelectionContext } from './selection';
import { decideContinuity } from './continuity';
const now = Date.parse('2026-09-29T20:00:00Z');
const assessment: Assessment = { task: 'coding', complexity: 'high', confidence: .9, continuity: 'fresh', continuityConfidence: .9, modelVersion: 'fixture', questionVersion: 'v1' };
const deployment: Deployment = { id: 'a', modelId: 'model-a', providerId: 'host-a', transport: 'direct', inferenceModelId: 'model-a', status: 'active', capabilities: { tools: true, vision: true, structuredOutput: true, streaming: true, contextTokens: 10000, maxOutputTokens: 2000 } };
function setup() {
  const catalog: CatalogSnapshot = { id: 'snapshot', createdAt: new Date(now).toISOString(), deployments: [structuredClone(deployment)], benchmarks: [{ modelId: 'model-a', benchmark: 'coding', benchmarkVersion: 'v1', value: 80, sourceUrl: 'https://example.com/fixture', retrievedAt: new Date(now).toISOString(), evidence: 'measured' }] };
  const context: SelectionContext = { now, maximumEvidenceAgeMs: 10000, maximumMetricsAgeMs: 10000, remainingRequestBudgetMicros: 250000, estimateInputTokens: () => 100, metrics: { a: { inputMicrosPerMillionTokens: 1000000, outputMicrosPerMillionTokens: 3000000, estimatedCompletionMs: 500, observedAt: new Date(now).toISOString() } }, profiles: { coding: [{ benchmark: 'coding', version: 'v1', weight: 1, minimum: 0, maximum: 100, higherIsBetter: true }] } };
  return { input: { catalog, policy: structuredClone(demoPolicy), request: structuredClone(sampleRequest), assessment }, context };
}
describe('eligibility and scoring', () => {
  it('normalizes task evidence and exposes fixed-bound utility terms', () => {
    const { input, context } = setup(); const result = selectCandidates(input, context)[0]!;
    expect(result.eligible).toBe(true); expect(result.quality).toBe(.8); expect(result.estimatedCostMicros).toBe(4600);
    expect(result.score?.total).toBeCloseTo(.6 * .8 + .25 * (1 - 4600 / input.policy.requestBudgetMicros) + .15 * (1 - 500 / 30000));
  });
  it('filters image, schema, tool history, context and output requirements', () => {
    const { input, context } = setup();
    input.catalog.deployments[0]!.capabilities = { tools: false, vision: false, structuredOutput: false, streaming: false, contextTokens: 50, maxOutputTokens: 100 };
    input.request.messages = [{ role: 'user', content: [{ type: 'image_url', url: 'https://example.com/image.png' }] }, { role: 'tool', content: 'result', toolCallId: 'call-1' }];
    input.request.outputSchema = { type: 'object' };
    const result = selectCandidates(input, context)[0]!;
    expect(result.eligible).toBe(false); expect(result.reasons).toEqual(expect.arrayContaining(['Streaming is unsupported', 'Image input is unsupported', 'Tool protocol is unsupported', 'Structured output is unsupported', 'Context capacity is insufficient', 'Output token limit exceeded']));
  });
  it('requires the incomplete-coverage toggle and penalizes missing optional evidence', () => {
    const { input, context } = setup();
    context.profiles = { coding: [...context.profiles.coding!, { benchmark: 'reasoning', version: 'v1', weight: 1, minimum: 0, maximum: 1, higherIsBetter: true }] };
    expect(selectCandidates(input, context)[0]!.eligible).toBe(false);
    input.policy.allowIncompleteCoverage = true;
    const result = selectCandidates(input, context)[0]!;
    expect(result.eligible).toBe(true); expect(result.score?.uncertaintyPenalty).toBe(.075);
    context.profiles = { coding: context.profiles.coding!.map(rule => ({ ...rule, required: true })) };
    expect(selectCandidates(input, context)[0]!.eligible).toBe(false);
  });
  it('does not let proxy evidence satisfy a required benchmark minimum', () => {
    const { input, context } = setup(); input.policy.allowIncompleteCoverage = true;
    input.catalog.benchmarks[0]!.evidence = 'proxy';
    context.profiles = { coding: context.profiles.coding!.map(rule => ({ ...rule, minimumNormalizedScore: .5 })) };
    expect(selectCandidates(input, context)[0]!.reasons).toContain('Required measured evidence missing: coding');
  });
  it('rejects stale, wrong-version and absent benchmark evidence', () => {
    for (const mutate of [
      (s: ReturnType<typeof setup>) => { s.input.catalog.benchmarks[0]!.retrievedAt = '2020-01-01T00:00:00Z'; },
      (s: ReturnType<typeof setup>) => { s.input.catalog.benchmarks[0]!.benchmarkVersion = 'v2'; },
      (s: ReturnType<typeof setup>) => { s.input.catalog.benchmarks = []; },
    ]) { const s = setup(); mutate(s); s.input.policy.allowIncompleteCoverage = true; expect(selectCandidates(s.input, s.context)[0]!.eligible).toBe(false); }
  });
  it('respects remaining budget after classification and stale endpoint metrics', () => {
    const { input, context } = setup(); context.remainingRequestBudgetMicros = 4599;
    expect(selectCandidates(input, context)[0]!.reasons).toContain('Remaining request budget exceeded');
    context.metrics = { a: { ...context.metrics.a!, observedAt: '2020-01-01T00:00:00Z' } };
    expect(selectCandidates(input, context)[0]!.reasons).toContain('Endpoint metrics are missing or stale');
  });
  it('caps the pool deterministically without changing another candidate score', () => {
    const { input, context } = setup(); const score = selectCandidates(input, context)[0]!.score;
    input.catalog.deployments.push({ ...deployment, id: 'b' }); context.metrics = { ...context.metrics, b: context.metrics.a! }; input.policy.maxCandidates = 1;
    const candidates = selectCandidates(input, context);
    expect(candidates[0]!.deploymentId).toBe('a'); expect(candidates[0]!.score).toEqual(score);
    expect(candidates[1]!.reasons).toContain('Outside configured candidate pool size');
  });
  it('rounds micro-USD conservatively using integer arithmetic', () => {
    expect(estimateCostMicros(1, 0, 1, 0)).toBe(1);
    expect(() => estimateCostMicros(-1, 0, 1, 0)).toThrow();
    expect(() => estimateCostMicros(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toThrow();
  });
});
describe('continuity', () => {
  const base = { mode: 'auto' as const, assessment, confidenceThreshold: .7, currentDeploymentId: 'a', currentDeploymentQualifies: true, toolCycleLocked: false };
  it('retains a qualifying deployment on uncertainty or outage', () => {
    expect(decideContinuity({ ...base, assessment: null }).action).toBe('retain');
    expect(decideContinuity({ ...base, assessment: { ...assessment, confidence: .2 } }).action).toBe('retain');
  });
  it('does not retain an ineligible deployment even during a tool lock', () => {
    expect(decideContinuity({ ...base, assessment: null, currentDeploymentQualifies: false, toolCycleLocked: true }).action).toBe('conservative_pool');
  });
  it('honors tool cycles, fresh task assessments and explicit app overrides', () => {
    expect(decideContinuity({ ...base, toolCycleLocked: true }).action).toBe('retain');
    expect(decideContinuity(base).action).toBe('auction');
    expect(decideContinuity({ ...base, mode: 'fresh', toolCycleLocked: true }).action).toBe('auction');
  });
});

describe('pre-push boundary review', () => {
  it('rounds input and output charges independently', () => {
    expect(estimateCostMicros(1, 1, 1, 1)).toBe(2);
  });
  it('does not apply a different application policy by accident', () => {
    const { input, context } = setup(); input.request.policyId = 'another-policy';
    expect(() => selectCandidates(input, context)).toThrow('does not match');
  });
  it('accepts exact cost/latency/context limits and rejects one unit over', () => {
    const { input, context } = setup();
    input.catalog.deployments[0]!.capabilities.contextTokens = 1600;
    context.remainingRequestBudgetMicros = 4600;
    input.policy.maxLatencyMs = 500;
    expect(selectCandidates(input, context)[0]!.eligible).toBe(true);
    context.estimateInputTokens = () => 101;
    expect(selectCandidates(input, context)[0]!.eligible).toBe(false);
  });
  it('rejects future evidence and invalid token/price/latency estimates', () => {
    const original = setup(); original.input.catalog.benchmarks[0]!.retrievedAt = new Date(now + 1).toISOString();
    expect(selectCandidates(original.input, original.context)[0]!.eligible).toBe(false);
    for (const estimate of [-1, NaN, Infinity, .5]) {
      const { input, context } = setup(); context.estimateInputTokens = () => estimate;
      expect(selectCandidates(input, context)[0]!.eligible).toBe(false);
    }
    for (const field of ['inputMicrosPerMillionTokens', 'outputMicrosPerMillionTokens', 'estimatedCompletionMs'] as const) {
      const { input, context } = setup(); context.metrics = { a: { ...context.metrics.a!, [field]: NaN } };
      expect(selectCandidates(input, context)[0]!.eligible).toBe(false);
    }
  });
  it('rejects ambiguous benchmark scores regardless of source ordering', () => {
    const { input, context } = setup(); input.catalog.benchmarks.push({ ...input.catalog.benchmarks[0]!, value: 10, retrievedAt: '2026-09-29T20:00:00Z', sourceUrl: 'https://example.com/conflict' });
    const forward = selectCandidates(input, context)[0]!;
    input.catalog.benchmarks.reverse();
    expect(selectCandidates(input, context)[0]).toEqual(forward);
    expect(forward.reasons).toContain('Conflicting benchmark evidence: coding');
  });
  it('handles lower-is-better profiles and rejects numeric overflow', () => {
    const { input, context } = setup();
    context.profiles = { coding: context.profiles.coding!.map(rule => ({ ...rule, higherIsBetter: false })) };
    expect(selectCandidates(input, context)[0]!.quality).toBeCloseTo(.2);
    context.profiles = { coding: [
      { ...context.profiles.coding![0]!, weight: Number.MAX_VALUE },
      { ...context.profiles.coding![0]!, benchmark: 'another', weight: Number.MAX_VALUE },
    ] };
    expect(() => selectCandidates(input, context)).toThrow('overflow');
  });
  it('is stable under reordered deployment inputs and does not mutate callers', () => {
    const { input, context } = setup(); input.catalog.deployments.push({ ...deployment, id: 'B' });
    context.metrics = { ...context.metrics, B: context.metrics.a! }; input.policy.maxCandidates = 1;
    const before = structuredClone(input);
    const first = selectCandidates(input, context);
    expect(input).toEqual(before);
    input.catalog.deployments.reverse();
    expect(selectCandidates(input, context)).toEqual(first);
  });
});

describe('multidimensional pool criteria', () => {
  it('keeps benchmark tradeoffs on the frontier even when one aggregate is better', () => {
    const { input, context } = setup();
    input.policy.minimumQuality = 0; context.selection = { paretoOnly: true };
    input.catalog.deployments.push({ ...deployment, id: 'b', modelId: 'model-b' });
    context.metrics = { ...context.metrics, b: context.metrics.a! };
    context.profiles = { coding: [...context.profiles.coding!, { benchmark: 'reasoning', version: 'v1', weight: 1, minimum: 0, maximum: 100, higherIsBetter: true }] };
    input.catalog.benchmarks.push(
      { ...input.catalog.benchmarks[0]!, benchmark: 'reasoning', value: 60 },
      { ...input.catalog.benchmarks[0]!, modelId: 'model-b', value: 50 },
      { ...input.catalog.benchmarks[0]!, modelId: 'model-b', benchmark: 'reasoning', value: 80 },
    );
    const result = selectCandidates(input, context);
    expect(result.every(c => c.eligible)).toBe(true);
    expect(result[0]!.benchmarkAxes.map(a => a.normalizedScore)).toEqual([.8, .6]);
    input.catalog.benchmarks.at(-1)!.value = 50;
    expect(selectCandidates(input, context).find(c => c.deploymentId === 'b')!.eligible).toBe(false);
  });
  it('applies inclusive bands and independent measured benchmark gates', () => {
    const { input, context } = setup();
    context.poolCriteria = { latencyMs: { min: 500, max: 500 }, estimatedCostMicros: { max: 4600 }, contextTokens: { min: 10000 }, maxOutputTokens: { min: 2000 }, requiredCapabilities: ['tools'], benchmarks: [{ ...context.profiles.coding![0]!, minimumNormalizedScore: .8, maximumNormalizedScore: .9 }] };
    expect(selectCandidates(input, context)[0]!.eligible).toBe(true);
    input.catalog.benchmarks[0]!.value = 79;
    expect(selectCandidates(input, context)[0]!.reasons).toContain('Benchmark minimum not met: coding');
    input.catalog.benchmarks[0]!.value = 95;
    expect(selectCandidates(input, context)[0]!.reasons).toContain('Benchmark maximum exceeded: coding');
    input.catalog.benchmarks[0]!.evidence = 'proxy'; input.policy.allowIncompleteCoverage = true;
    expect(selectCandidates(input, context)[0]!.reasons).toContain('Required measured evidence missing: coding');
  });
  it('fails closed on missing axes and conflicting normalization and bands', () => {
    const { input, context } = setup();
    context.poolCriteria = { benchmarks: [{ ...context.profiles.coding![0]!, benchmark: 'unmeasured' }] };
    input.policy.allowIncompleteCoverage = true;
    expect(selectCandidates(input, context)[0]!.reasons).toContain('Required measured evidence missing: unmeasured');
    context.poolCriteria = { benchmarks: [{ ...context.profiles.coding![0]!, maximum: 1 }] };
    expect(() => selectCandidates(input, context)).toThrow('Conflicting benchmark normalization');
    context.poolCriteria = { latencyMs: { min: 500, max: 499 } };
    expect(() => selectCandidates(input, context)).toThrow();
  });
  it('normalizes lower-is-better axes and rejects stale band metrics', () => {
    const { input, context } = setup(); input.policy.minimumQuality = 0;
    context.profiles = { coding: [{ ...context.profiles.coding![0]!, higherIsBetter: false }] };
    context.poolCriteria = { benchmarks: [{ ...context.profiles.coding![0]!, minimumNormalizedScore: .3 }], latencyMs: { max: 1000 } };
    const result = selectCandidates(input, context)[0]!;
    expect(result.benchmarkAxes[0]!.normalizedScore).toBeCloseTo(.2);
    expect(result.eligible).toBe(false);
    context.metrics = { a: { ...context.metrics.a!, observedAt: '2020-01-01T00:00:00Z' } };
    expect(selectCandidates(input, context)[0]!.reasons).toContain('Outside source latency band');
  });
});
