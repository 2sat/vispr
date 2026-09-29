import { createHash, randomUUID } from 'node:crypto';
import { BenchmarkObservationSchema, CatalogSnapshotSchema, type CatalogSnapshot, type Deployment } from '@vispr/contracts';
import type { CatalogSource } from './index';
import { RetryableSourceError, type ImportMapping, type SourcePage } from './connectors';

export interface AliasMapping { sourceId: string; sourceModelId: string; modelId: string; reviewed: true }
export interface NormalizedRecord {
  key: string; modelId: string; configuration: string;
  benchmarks: CatalogSnapshot['benchmarks'];
  pricing: { inputUsdPerMillion: number | null; outputUsdPerMillion: number | null };
  latency: { tokensPerSecond: number | null; timeToFirstTokenMs: number | null; provenance: 'public'; workload: string };
  sourceUrl: string; retrievedAt: string; stale: boolean;
}
export interface IngestionRun {
  id: string; sourceId: string; adapterVersion: string; status: 'running' | 'completed' | 'failed';
  startedAt: string; inputHash: string; cursors: string[]; cursor?: string; page?: SourcePage; offset: number;
  staged: Record<string, NormalizedRecord>; hashes: string[];
  counts: { added: number; changed: number; unchanged: number; rejected: number };
  quarantine: { recordIndex: number; reason: string; sourceModelId?: string }[];
  etag?: string; error?: string; snapshotId?: string;
}
export interface CatalogState {
  runs: Record<string, IngestionRun>; records: Record<string, NormalizedRecord>;
  snapshots: CatalogSnapshot[]; etags: Record<string, string>; etagInputs: Record<string, string>;
}
export const emptyCatalogState = (): CatalogState => ({ runs: {}, records: {}, snapshots: [], etags: {}, etagInputs: {} });
/** Must lock the source AND serialize publication across sources. Commit state only on success. */
export interface IngestionStore {
  transaction<T>(sourceId: string, action: (state: CatalogState) => Promise<T>): Promise<T>;
}
export const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Record must be an object');
  return value as Record<string, unknown>;
}
function field(row: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((v, key) => v === undefined || v === null ? undefined : object(v)[key], row);
}
function identity(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Missing stable identity');
  return value;
}
function number(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw new Error('Invalid numeric value or range');
  return n;
}
export const artificialAnalysisMapping = (versions: Record<string, string>): ImportMapping => ({
  id: 'id', model: 'id', inputPrice: 'pricing.price_1m_input_tokens', outputPrice: 'pricing.price_1m_output_tokens',
  tokensPerSecond: 'median_output_tokens_per_second', timeToFirstTokenSeconds: 'median_time_to_first_token_seconds',
  benchmarks: Object.entries(versions).map(([benchmark, version]) => ({ field: `evaluations.${benchmark}`, benchmark, version, min: 0, max: benchmark.endsWith('_index') ? 100 : 1 })),
});
export function normalizeRecord(raw: unknown, sourceId: string, page: SourcePage, mapping: ImportMapping, aliases: AliasMapping[]): NormalizedRecord {
  const row = object(raw), recordId = identity(field(row, mapping.id)), sourceModelId = identity(field(row, mapping.model));
  const matches = aliases.filter(a => a.sourceId === sourceId && a.sourceModelId === sourceModelId && a.reviewed === true);
  if (matches.length !== 1) throw new Error(`Alias requires review: ${sourceModelId}`);
  const modelId = identity(matches[0]!.modelId);
  const configuration = mapping.configuration ? identity(field(row, mapping.configuration)) : 'unspecified';
  const benchmarks: CatalogSnapshot['benchmarks'] = [];
  for (const b of mapping.benchmarks) {
    if (!b.version || !Number.isFinite(b.min) || !Number.isFinite(b.max) || b.min > b.max) throw new Error('Invalid benchmark configuration');
    const value = number(field(row, b.field), b.min, b.max);
    if (value !== null) benchmarks.push(BenchmarkObservationSchema.parse({ modelId, benchmark: b.benchmark, benchmarkVersion: b.version, value, sourceUrl: page.sourceUrl, retrievedAt: page.retrievedAt, evidence: 'measured' }));
  }
  new URL(page.sourceUrl);
  if (!Number.isFinite(Date.parse(page.retrievedAt))) throw new Error('Invalid retrieval timestamp');
  const get = (path?: string) => path ? number(field(row, path), 0) : null;
  const seconds = get(mapping.timeToFirstTokenSeconds), speed = get(mapping.tokensPerSecond);
  if (speed === 0) throw new Error('Throughput must be positive');
  return { key: JSON.stringify([sourceId, recordId, configuration]), modelId, configuration, benchmarks,
    pricing: { inputUsdPerMillion: get(mapping.inputPrice), outputUsdPerMillion: get(mapping.outputPrice) },
    latency: { tokensPerSecond: speed, timeToFirstTokenMs: seconds === null ? null : seconds * 1000, provenance: 'public', workload: 'source measurement; not deployment telemetry' },
    sourceUrl: page.sourceUrl, retrievedAt: page.retrievedAt, stale: false };
}
function semantic(record: NormalizedRecord): unknown {
  return { ...record, retrievedAt: undefined, benchmarks: record.benchmarks.map(b => ({ ...b, retrievedAt: undefined })) };
}
export async function refreshCatalog(input: {
  runId: string; source: CatalogSource; store: IngestionStore; mapping: ImportMapping;
  aliases: AliasMapping[]; deployments: Deployment[]; batchSize?: number; signal?: AbortSignal;
}): Promise<IngestionRun> {
  const batchSize = input.batchSize ?? 100;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10000) throw new Error('Invalid batch size');
  const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000);
  for (const id of [input.runId, input.source.id]) {
    if (!id || id.length > 200 || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error('Invalid run/source ID');
  }
  return input.store.transaction(input.source.id, async state => {
    state.etagInputs ??= {};
    const inputHash = hash({ cacheKey: input.source.cacheKey, mapping: input.mapping, aliases: input.aliases, deployments: input.deployments });
    let run = state.runs[input.runId];
    if (run && run.inputHash !== inputHash) throw new Error('Resume requires the original mapping, aliases and inventory');
    if (run && run.sourceId !== input.source.id) throw new Error('Run ID belongs to another source');
    if (run && run.status !== 'running') return structuredClone(run);
    if (Object.values(state.runs).some(r => r.id !== input.runId && r.sourceId === input.source.id && r.status === 'running')) throw new Error('Source already has a resumable run');
    run ??= state.runs[input.runId] = { id: input.runId, sourceId: input.source.id, adapterVersion: 'catalog/1', status: 'running', startedAt: new Date().toISOString(), inputHash, cursors: [], offset: 0, staged: {}, hashes: [], counts: { added: 0, changed: 0, unchanged: 0, rejected: 0 }, quarantine: [] };
    try {
      delete run.error;
      signal.throwIfAborted();
      if (!run.page) {
        const etag = input.source.cacheKey && state.etagInputs[input.source.id] === inputHash ? state.etags[input.source.id] : undefined;
        run.page = await input.source.fetch({ signal, ...(run.cursor ? { cursor: run.cursor } : {}), ...(!run.cursor && etag ? { etag } : {}) });
        run.hashes.push(hash(run.page.records));
        if (run.page.etag) run.etag = run.page.etag;
      }
      const page = run.page;
      if (page.notModified && (run.cursor || Object.keys(run.staged).length || !input.source.cacheKey || state.etagInputs[input.source.id] !== inputHash || !state.etags[input.source.id])) throw new Error('Unexpected not-modified response');
      if (page.notModified) {
        const previous = state.snapshots.at(-1);
        if (!previous) throw new Error('Not-modified response without published snapshot');
        if (hash(previous.deployments) !== hash(input.deployments)) {
          const snapshot = CatalogSnapshotSchema.parse({ ...previous, id: randomUUID(), createdAt: new Date().toISOString(), deployments: input.deployments });
          state.snapshots.push(snapshot); run.snapshotId = snapshot.id;
        } else run.snapshotId = previous.id;
        run.status = 'completed'; delete run.page; return structuredClone(run);
      }
      const end = Math.min(run.offset + batchSize, page.records.length);
      for (; run.offset < end; run.offset++) {
        signal.throwIfAborted();
        try {
          const record = normalizeRecord(page.records[run.offset], input.source.id, page, input.mapping, input.aliases);
          if (run.staged[record.key]) throw new Error('Duplicate source identity/configuration');
          run.staged[record.key] = record;
        } catch (error) { run.counts.rejected++; run.quarantine.push({ recordIndex: run.offset, reason: error instanceof Error ? error.message : 'Invalid record' }); }
      }
      if (run.offset < page.records.length) return structuredClone(run);
      delete run.page; run.offset = 0;
      if (page.nextCursor) {
        if (run.cursors.includes(page.nextCursor)) throw new Error('Source cursor did not advance');
        run.cursors.push(page.nextCursor);
        run.cursor = page.nextCursor; return structuredClone(run);
      }
      // A rejected or empty refresh cannot replace the last good catalog.
      if (run.counts.rejected || !Object.keys(run.staged).length) throw new Error('Refresh contains rejected rows or no records');
      const candidate = structuredClone(state.records);
      for (const [key, previous] of Object.entries(candidate)) {
        if (JSON.parse(key)[0] === input.source.id && !run.staged[key]) candidate[key] = { ...previous, stale: true };
      }
      for (const [key, record] of Object.entries(run.staged)) {
        const previous = state.records[key];
        if (!previous) run.counts.added++;
        else if (hash(semantic(previous)) === hash(semantic(record))) run.counts.unchanged++;
        else run.counts.changed++;
        candidate[key] = record;
      }
      const changed = hash(Object.entries(candidate).sort().map(([k, r]) => [k, semantic(r)])) !== hash(Object.entries(state.records).sort().map(([k, r]) => [k, semantic(r)]));
      const previous = state.snapshots.at(-1);
      if (changed || !previous || hash(previous.deployments) !== hash(input.deployments)) {
        // Shared v0.1 contract cannot represent configuration: omit ambiguous evidence rather than conflate evaluations.
        const records = Object.values(candidate).filter(r => !r.stale);
        const groups = new Map<string, typeof records[number]['benchmarks']>();
        for (const r of records) for (const b of r.benchmarks) {
          const key = JSON.stringify([b.modelId, b.benchmark, b.benchmarkVersion]);
          groups.set(key, [...(groups.get(key) ?? []), b]);
        }
        const snapshot = CatalogSnapshotSchema.parse({ id: randomUUID(), createdAt: new Date().toISOString(), deployments: input.deployments, benchmarks: [...groups.values()].filter(g => g.length === 1).flat() });
        state.snapshots.push(snapshot); run.snapshotId = snapshot.id;
      } else run.snapshotId = previous.id;
      state.records = candidate;
      if (run.etag) { state.etags[input.source.id] = run.etag; state.etagInputs[input.source.id] = inputHash; }
      else { delete state.etags[input.source.id]; delete state.etagInputs[input.source.id]; }
      run.status = 'completed';
    } catch (error) {
      if (signal.aborted || error instanceof RetryableSourceError) {
        run.error = 'Refresh interrupted; retry the same run ID to resume. Last valid snapshot retained.';
      } else {
        run.status = 'failed'; run.error = 'Refresh failed; last valid snapshot retained. Review quarantined rows or source availability.'; delete run.page;
      }
    }
    return structuredClone(run);
  });
}
