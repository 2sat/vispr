import { describe, it, expect } from 'vitest';
import { SourceRoutingSchema } from '@vispr/contracts';
import { demoPolicy } from '@vispr/contracts/fixtures';
import { modelSpace, proposeManifold, snapshotId, spaceSnapshotId, type ReviewedSpace, type ProposalInput } from './model-manifold';
const input: ProposalInput = {
  policyId: demoPolicy.id, policyVersion: demoPolicy.version, snapshotId, source: 'invoice.extract',
  workload: { inputTokens: 1000, maxOutputTokens: 100 },
  criteria: { latencyMs: { max: 100 }, estimatedCostMicros: { max: 1000 }, benchmarks: [{ benchmark: 'extraction', version: 'v1', minimum: 0, maximum: 100, higherIsBetter: true, minimumNormalizedScore: .9, weight: 1 }] },
  rationale: 'Bound invoice extraction cost and completion time, with an independent extraction floor.',
};
describe('static model manifold', () => {
  it('exposes sourced discovery without inventing measured axes', () => {
    const space = modelSpace('app-a', demoPolicy);
    expect(space.models.length).toBeGreaterThan(0);
    expect(space.benchmarkAxes).toEqual([]);
    expect(space.models.every(m => m.completionLatencyMs === null && m.benchmarkObservations.length === 0)).toBe(true);
    expect(space.criteriaSchema).toHaveProperty('properties');
  });
  it('returns a source-bound fixed region, never a certified or activated model list', () => {
    const proposal = proposeManifold('app-a', demoPolicy, input);
    expect(proposal).toMatchObject({ active: false, persisted: false, applicationId: 'app-a', status: 'proposed', eligibleDeploymentIds: [] });
    expect(SourceRoutingSchema.safeParse(proposal.sourceRouting).success).toBe(true);
    expect(proposal.sourceRouting.bindings[0]?.source).toBe('invoice.extract');
    expect(proposal.sourceRouting.pools[0]).not.toHaveProperty('deploymentIds');
    expect(proposal.criteria.benchmarks?.[0]?.required).toBe(true);
    expect(proposal.preview.every(row => ['excluded', 'unverified'].includes(row.status))).toBe(true);
  });
  it('pins policy and catalog versions', () => {
    expect(() => proposeManifold('app-a', demoPolicy, { ...input, snapshotId: 'stale' })).toThrow('snapshot');
    expect(() => proposeManifold('app-a', demoPolicy, { ...input, policyVersion: demoPolicy.version + 1 })).toThrow('Policy');
    expect(() => proposeManifold('app-a', demoPolicy, { ...input, policyId: 'foreign' })).toThrow('Policy');
  });
  it('rejects relaxing policy or dropping required ceilings', () => {
    expect(() => proposeManifold('app-a', demoPolicy, { ...input, criteria: { latencyMs: { max: demoPolicy.maxLatencyMs + 1 }, estimatedCostMicros: { max: 1 } } })).toThrow('relax');
    expect(() => proposeManifold('app-a', demoPolicy, { ...input, criteria: { latencyMs: { max: 1 }, estimatedCostMicros: { max: demoPolicy.requestBudgetMicros + 1 } } })).toThrow('relax');
    expect(() => proposeManifold('app-a', demoPolicy, { ...input, criteria: { latencyMs: { max: 1 } } })).toThrow('ceilings');
    expect(() => proposeManifold('app-a', demoPolicy, { ...input, workload: { ...input.workload, maxOutputTokens: demoPolicy.maxOutputTokens + 1 } })).toThrow('output');
  });
  it('rejects soft axes, reversed bands, fractional money and spoofed app scope', () => {
    const axis = input.criteria.benchmarks![0]!;
    expect(() => proposeManifold('app-a', demoPolicy, { ...input, criteria: { ...input.criteria, benchmarks: [{ ...axis, required: false }] } })).toThrow('optional');
    expect(() => proposeManifold('app-a', demoPolicy, { ...input, criteria: { ...input.criteria, latencyMs: { min: 10, max: 1 } } })).toThrow();
    expect(() => proposeManifold('app-a', demoPolicy, { ...input, criteria: { ...input.criteria, estimatedCostMicros: { max: .5 } } })).toThrow('integer');
    expect(() => proposeManifold('app-a', demoPolicy, { ...input, applicationId: 'app-b' })).toThrow();
  });
  it('is deterministic and binds application, source and request shape into the proposal ID', () => {
    const first = proposeManifold('app-a', demoPolicy, input);
    expect(proposeManifold('app-a', demoPolicy, { ...input, rationale: 'New prose only' }).proposalId).toBe(first.proposalId);
    expect(proposeManifold('app-b', demoPolicy, input).proposalId).not.toBe(first.proposalId);
    expect(proposeManifold('app-a', demoPolicy, { ...input, source: 'other' }).proposalId).not.toBe(first.proposalId);
    expect(proposeManifold('app-a', demoPolicy, { ...input, workload: { ...input.workload, inputTokens: 2000 } }).proposalId).not.toBe(first.proposalId);
  });
});

function reviewedFixture(): ReviewedSpace {
  const now = new Date().toISOString();
  const axis = input.criteria.benchmarks![0]!;
  const deployments = ['high', 'low'].map(id => ({ id, modelId: id, providerId: 'fixture', transport: 'direct' as const, inferenceModelId: id, status: 'active' as const, capabilities: { tools: true, structuredOutput: true, vision: false, streaming: true, contextTokens: 4000, maxOutputTokens: 1500 } }));
  return {
    catalog: { id: 'reviewed-catalog', createdAt: now, deployments, benchmarks: deployments.map(d => ({ modelId: d.modelId, benchmark: axis.benchmark, benchmarkVersion: axis.version, value: d.id === 'high' ? 95 : 80, sourceUrl: 'https://fixture.invalid/benchmark', retrievedAt: now, evidence: 'measured' as const })) },
    config: {
      classifier: { model: 'jev-1.13.0', inputMicrosPerMillionTokens: 42000, contextTokenBound: 64000, maximumStateBytes: 32000, priceSourceUrl: 'https://fixture.invalid/price', priceReviewedAt: now },
      profiles: { extraction: [axis] },
      metrics: Object.fromEntries(deployments.map(d => [d.id, { inputMicrosPerMillionTokens: 100000, outputMicrosPerMillionTokens: 100000, estimatedCompletionMs: 50, observedAt: now, sourceUrl: 'https://fixture.invalid/metrics', bounded: true as const, queueMs: 0, tokensPerSecond: 100, strategy: 'fixed' as const }])),
      conservativePool: { task: 'extraction', deploymentIds: ['high'] }, maximumEvidenceAgeMs: 60000, maximumMetricsAgeMs: 60000, confidenceThreshold: .6,
      sourceRouting: { pools: [{ id: 'existing', criteria: { latencyMs: { max: 300 } } }], bindings: [{ source: 'other.call', poolId: 'existing' }] },
    },
  };
}
it('uses the real selector for reviewed independent axes and preserves other source bindings', () => {
  const reviewed = reviewedFixture();
  const proposal = proposeManifold('app-a', demoPolicy, { ...input, snapshotId: spaceSnapshotId(reviewed) }, reviewed);
  expect(proposal.previewEligibleDeploymentIds).toEqual(['high']);
  expect(proposal.reviewedCandidates.find(c => c.deploymentId === 'low')?.reasons).toContain('Benchmark minimum not met: extraction');
  expect(proposal.sourceRouting.bindings).toContainEqual({ source: 'other.call', poolId: 'existing' });
  expect(proposal.active).toBe(false);
  expect(modelSpace('app-a', demoPolicy, reviewed).benchmarkAxes[0]).toMatchObject({ benchmark: 'extraction', version: 'v1' });
});
it('fails closed on stale reviewed metrics and rejects invented benchmark normalization', () => {
  const reviewed = reviewedFixture();
  for (const metric of Object.values(reviewed.config.metrics)) metric.observedAt = '2000-01-01T00:00:00.000Z';
  const raw = { ...input, snapshotId: spaceSnapshotId(reviewed) };
  expect(proposeManifold('app-a', demoPolicy, raw, reviewed).previewEligibleDeploymentIds).toEqual([]);
  expect(() => proposeManifold('app-a', demoPolicy, { ...raw, criteria: { ...input.criteria, benchmarks: [{ ...input.criteria.benchmarks![0]!, maximum: 1000 }] } }, reviewed)).toThrow('normalization');
  expect(() => proposeManifold('app-a', demoPolicy, input, reviewed)).toThrow('snapshot');
});
