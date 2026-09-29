import { describe, expect, it } from 'vitest';
import { explore, illustrativeModels, sortModels, type ExplorerBands } from './model-explorer';
const bands: ExplorerBands = { maxCost: .02, maxLatency: 5, benchmarks: { coding: 60, reasoning: 60, design: 55 } };
describe('explorer model space', () => {
  it('preserves benchmark tradeoffs and identifies a fully dominated model', () => {
    const rows = explore(illustrativeModels, bands, 1000, 500);
    expect(rows.find(r => r.id === 'studio')!.status).toBe('frontier');
    expect(rows.find(r => r.id === 'reasoner')!.status).toBe('frontier');
    expect(rows.find(r => r.id === 'legacy')!.dominatedBy).toContain('Balanced');
  });
  it('changes the frontier with the selected benchmark dimensions', () => {
    const rows = explore(illustrativeModels, { ...bands, benchmarks: { coding: 0 } }, 1000, 500);
    expect(rows.find(r => r.id === 'studio')!.dominatedBy).toContain('Balanced');
  });
  it('recomputes request costs with token counts and enforces context capacity', () => {
    const rows = explore(illustrativeModels, bands, 1000, 500);
    expect(rows.find(r => r.id === 'balanced')!.cost).toBe(.003);
    const changed = explore(illustrativeModels, bands, 64000, 500).find(r => r.id === 'balanced')!;
    expect(changed.reasons).toContain('Above task-cost ceiling'); expect(changed.reasons).toContain('Request exceeds context window');
  });
  it('does not use unknown evidence as zero or qualify it for the frontier', () => {
    const unknown = { ...illustrativeModels[0]!, id: 'unknown', coding: null, latency: null };
    const rows = explore([unknown, ...illustrativeModels], bands, 1000, 500);
    expect(rows[0]!.status).toBe('excluded'); expect(rows[0]!.reasons).toContain('Code correctness: no versioned evidence');
    expect(sortModels(rows, 'coding').at(-1)!.id).toBe('unknown');
  });
  it('accepts inclusive limits and does not let excluded models dominate', () => {
    const rows = explore(illustrativeModels, { maxCost: .003, maxLatency: 1.5, benchmarks: { coding: 85 } }, 1000, 500);
    expect(rows.find(r => r.id === 'balanced')!.status).toBe('frontier');
    expect(rows.filter(r => r.status === 'frontier')).toHaveLength(1);
  });
  it('sorting a projection does not mutate full-dimensional decisions', () => {
    const rows = explore(illustrativeModels, bands, 1000, 500), before = structuredClone(rows);
    sortModels(rows, 'design'); expect(rows).toEqual(before);
    expect(() => explore(illustrativeModels, bands, NaN, 500)).toThrow('Invalid explorer inputs');
  });
});
