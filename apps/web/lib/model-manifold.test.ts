import { describe, it, expect } from 'vitest';
import { SourceRoutingSchema } from '@vispr/contracts';
import { demoPolicy } from '@vispr/contracts/fixtures';
import { modelSpace, proposeManifold, snapshotId, type ProposalInput } from './model-manifold';
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
