export const axes = {
  cost: { label: 'Task cost', unit: 'USD / request', better: 'lower' },
  latency: { label: 'Completion latency', unit: 'seconds', better: 'lower' },
  coding: { label: 'Code correctness', unit: 'score / 100', better: 'higher' },
  reasoning: { label: 'Reasoning', unit: 'score / 100', better: 'higher' },
  design: { label: 'Interface design', unit: 'score / 100', better: 'higher' },
  context: { label: 'Context window', unit: 'tokens', better: 'higher' },
} as const;
export type Axis = keyof typeof axes;
export type Benchmark = 'coding' | 'reasoning' | 'design';
export interface ExplorerModel {
  id: string; name: string; provider: string;
  inputUsdPerMillion: number; outputUsdPerMillion: number;
  latency: number | null; coding: number | null; reasoning: number | null; design: number | null; context: number;
  provenance: string; sourceUrl?: string;
}
export interface ExplorerBands { maxCost: number; maxLatency: number; benchmarks: Partial<Record<Benchmark, number>> }
export type EvaluatedModel = ExplorerModel & { cost: number; reasons: string[]; status: 'frontier' | 'dominated' | 'excluded'; dominatedBy: string[] };
export function explore(models: ExplorerModel[], bands: ExplorerBands, inputTokens: number, outputTokens: number): EvaluatedModel[] {
  if (![inputTokens, outputTokens].every(n => Number.isSafeInteger(n) && n >= 0) || ![bands.maxCost, bands.maxLatency, ...Object.values(bands.benchmarks)].every(n => Number.isFinite(n) && n >= 0)) throw new Error('Invalid explorer inputs');
  const dimensions: Axis[] = ['cost', 'latency', ...Object.keys(bands.benchmarks) as Benchmark[]];
  const rows: EvaluatedModel[] = models.map(model => {
    const cost = (model.inputUsdPerMillion * inputTokens + model.outputUsdPerMillion * outputTokens) / 1e6;
    const reasons: string[] = [];
    if (cost > bands.maxCost) reasons.push('Above task-cost ceiling');
    if (model.latency === null) reasons.push('Completion latency not verified');
    else if (model.latency > bands.maxLatency) reasons.push('Above latency ceiling');
    for (const key of Object.keys(bands.benchmarks) as Benchmark[]) {
      if (model[key] === null) reasons.push(`${axes[key].label}: no versioned evidence`);
      else if (model[key]! < bands.benchmarks[key]!) reasons.push(`${axes[key].label}: below minimum`);
    }
    if (inputTokens + outputTokens > model.context) reasons.push('Request exceeds context window');
    return { ...model, cost, reasons, status: reasons.length ? 'excluded' : 'frontier', dominatedBy: [] };
  });
  const eligible = rows.filter(row => !row.reasons.length);
  for (const row of eligible) {
    row.dominatedBy = eligible.filter(other => other.id !== row.id && dimensions.every(axis => axes[axis].better === 'higher' ? other[axis]! >= row[axis]! : other[axis]! <= row[axis]!) && dimensions.some(axis => other[axis] !== row[axis])).map(other => other.name);
    if (row.dominatedBy.length) row.status = 'dominated';
  }
  return rows;
}
export function sortModels(rows: EvaluatedModel[], axis: Axis): EvaluatedModel[] {
  return [...rows].sort((a, b) => {
    const av = a[axis], bv = b[axis];
    if (av === null || bv === null) return av === bv ? a.id.localeCompare(b.id) : av === null ? 1 : -1;
    return (axes[axis].better === 'higher' ? bv - av : av - bv) || a.id.localeCompare(b.id);
  });
}
export const illustrativeModels: ExplorerModel[] = [
  { id: 'swift', name: 'Swift', provider: 'Illustrative endpoint', inputUsdPerMillion: .2, outputUsdPerMillion: 1, latency: .7, coding: 70, reasoning: 60, design: 62, context: 32000 },
  { id: 'studio', name: 'Studio', provider: 'Illustrative endpoint', inputUsdPerMillion: 2, outputUsdPerMillion: 8, latency: 2.1, coding: 82, reasoning: 75, design: 94, context: 128000 },
  { id: 'reasoner', name: 'Reasoner', provider: 'Illustrative endpoint', inputUsdPerMillion: 3, outputUsdPerMillion: 12, latency: 4.2, coding: 89, reasoning: 96, design: 69, context: 128000 },
  { id: 'balanced', name: 'Balanced', provider: 'Illustrative endpoint', inputUsdPerMillion: 1, outputUsdPerMillion: 4, latency: 1.5, coding: 85, reasoning: 83, design: 80, context: 64000 },
  { id: 'economy', name: 'Economy', provider: 'Illustrative endpoint', inputUsdPerMillion: .1, outputUsdPerMillion: .4, latency: 1, coding: 62, reasoning: 65, design: 57, context: 16000 },
  { id: 'legacy', name: 'Legacy', provider: 'Illustrative endpoint', inputUsdPerMillion: 1.5, outputUsdPerMillion: 5, latency: 2, coding: 75, reasoning: 70, design: 70, context: 32000 },
].map(model => ({ ...model, provenance: 'Synthetic values for interaction design. Not real model evaluations.' }));
