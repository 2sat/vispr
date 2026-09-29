import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileCatalogStore, artifactSource, artificialAnalysisSource, artificialAnalysisMapping, parseCsv, refreshCatalog, RetryableSourceError, httpSource, type ImportMapping, type AliasMapping } from './index';
const mapping: ImportMapping = { id: 'id', model: 'model', benchmarks: [{ field: 'score', benchmark: 'coding', version: 'v1', min: 0, max: 1 }] };
const aliases: AliasMapping[] = [{ sourceId: 'test', sourceModelId: 'a', modelId: 'canonical/a', reviewed: true }, { sourceId: 'test', sourceModelId: 'b', modelId: 'canonical/b', reviewed: true }];
const source = (records: unknown[]) => artifactSource({ id: 'test', sourceUrl: 'https://example.com/fixture', text: JSON.stringify(records), format: 'json' });
async function withStore(action: (store: FileCatalogStore) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'vispr-catalog-'));
  try { await action(new FileCatalogStore(join(dir, 'state.json'))); } finally { await rm(dir, { recursive: true, force: true }); }
}
const rows = [{ id: '1', model: 'a', score: 0.7 }, { id: '2', model: 'b', score: 0.8 }];
describe('catalog acceptance', () => {
  it('resumes across store instances and reimports without new snapshots', () => withStore(async store => {
    const input = { source: source(rows), store, mapping, aliases, deployments: [], batchSize: 1 };
    expect((await refreshCatalog({ ...input, runId: 'first' })).status).toBe('running');
    expect((await store.read()).snapshots).toHaveLength(0);
    const resumed = await refreshCatalog({ ...input, store: new FileCatalogStore(store.path), runId: 'first' });
    expect(resumed.status).toBe('completed'); expect(resumed.counts.added).toBe(2);
    await refreshCatalog({ ...input, runId: 'second' });
    expect((await refreshCatalog({ ...input, runId: 'second' })).counts.unchanged).toBe(2);
    expect((await store.read()).snapshots).toHaveLength(1);
    expect((await refreshCatalog({ ...input, runId: 'second' })).snapshotId).toBe(resumed.snapshotId);
  }));
  it('quarantines malformed values and unknown aliases without replacing valid data', () => withStore(async store => {
    const input = { store, mapping, aliases, deployments: [] };
    await refreshCatalog({ ...input, source: source(rows), runId: 'good' });
    const before = (await store.read()).snapshots;
    const result = await refreshCatalog({ ...input, source: source([{ id: '3', model: 'unknown', score: 0.5 }, { id: '1', model: 'a', score: 2 }]), runId: 'bad' });
    expect(result.status).toBe('failed'); expect(result.counts.rejected).toBe(2);
    expect((await store.read()).snapshots).toEqual(before);
  }));
  it('marks missing records stale only on complete refresh', () => withStore(async store => {
    const input = { store, mapping, aliases, deployments: [] };
    await refreshCatalog({ ...input, source: source(rows), runId: 'all' });
    await refreshCatalog({ ...input, source: source(rows.slice(0, 1)), runId: 'partial-inventory' });
    const state = await store.read();
    expect(Object.values(state.records).filter(r => r.stale)).toHaveLength(1);
    expect(state.snapshots.at(-1)?.benchmarks).toHaveLength(1);
  }));
  it('rejects concurrent file transactions and overlapping source runs', () => withStore(async store => {
    await store.transaction('test', async () => {
      await expect(new FileCatalogStore(store.path).transaction('other', async () => 1)).rejects.toThrow();
    });
    const input = { store, mapping, aliases, deployments: [], source: source(rows), batchSize: 1 };
    await refreshCatalog({ ...input, runId: 'a' });
    await expect(refreshCatalog({ ...input, runId: 'b' })).rejects.toThrow('resumable run');
  }));
  it('parses quoted CSV and rejects corrupt quoting', () => {
    expect(parseCsv('id,model,score\r\n1,"a,b",0.7\r\n')).toEqual([{ id: '1', model: 'a,b', score: '0.7' }]);
    expect(() => parseCsv('id,id\n1,2')).toThrow();
    expect(() => parseCsv('id\n"a')).toThrow();
  });
  it('uses documented AA fields, keeps raw units and sends conditional auth headers', async () => {
    let headers: HeadersInit | undefined;
    const aa = artificialAnalysisSource('test-only-secret', async (_url, init) => {
      headers = init?.headers;
      return new Response(JSON.stringify({ data: [{ id: 'aa-stable', evaluations: { mmlu_pro: 0.8 }, pricing: { price_1m_input_tokens: 1.1, price_1m_output_tokens: 4.4 }, median_output_tokens_per_second: 100, median_time_to_first_token_seconds: 2 }] }), { headers: { etag: 'v1' } });
    });
    const page = await aa.fetch({ signal: AbortSignal.timeout(1000), etag: 'previous' });
    expect(headers).toEqual({ 'x-api-key': 'test-only-secret', 'if-none-match': 'previous' });
    await withStore(async store => {
      const run = await refreshCatalog({ runId: 'aa', source: { id: aa.id, async fetch() { return page; } }, store, mapping: artificialAnalysisMapping({ mmlu_pro: 'explicit-v1' }), aliases: [{ sourceId: aa.id, sourceModelId: 'aa-stable', modelId: 'canonical/a', reviewed: true }], deployments: [] });
      expect(run.status).toBe('completed');
      const record = Object.values((await store.read()).records)[0]!;
      expect(record.pricing.inputUsdPerMillion).toBe(1.1); expect(record.latency.timeToFirstTokenMs).toBe(2000);
    });
  });
  it('stages paginated sources and preserves snapshots on later page failure', () => withStore(async store => {
    const input = { store, mapping, aliases, deployments: [] };
    await refreshCatalog({ ...input, source: source(rows), runId: 'baseline' });
    const before = (await store.read()).snapshots;
    const paged = { id: 'test', async fetch({ cursor }: { cursor?: string }) {
      if (cursor) throw new Error('source unavailable');
      return { records: [{ id: '3', model: 'a', score: 0.9 }], nextCursor: 'page2', sourceUrl: 'https://example.com/fixture', retrievedAt: new Date().toISOString() };
    } };
    expect((await refreshCatalog({ ...input, source: paged, runId: 'paged' })).status).toBe('running');
    expect((await refreshCatalog({ ...input, source: paged, runId: 'paged' })).status).toBe('failed');
    expect((await store.read()).snapshots).toEqual(before);
  }));
  it('freezes resume inputs and rejects conflicting source identities', () => withStore(async store => {
    const input = { store, mapping, aliases, deployments: [], source: source(rows), batchSize: 1 };
    await refreshCatalog({ ...input, runId: 'frozen' });
    await expect(refreshCatalog({ ...input, runId: 'frozen', aliases: [] })).rejects.toThrow('original mapping');
    await refreshCatalog({ ...input, runId: 'frozen' });
    const duplicate = await refreshCatalog({ ...input, source: source([rows[0], rows[0]]), batchSize: 100, runId: 'duplicate' });
    expect(duplicate.status).toBe('failed'); expect(duplicate.counts.rejected).toBe(1);
  }));
  it('does not publish conditional not-modified refreshes', () => withStore(async store => {
    const input = { store, mapping, aliases, deployments: [] };
    const tagged = { id: 'test', cacheKey: 'stable-feed', async fetch() { return { records: rows, etag: 'v1', sourceUrl: 'https://example.com/fixture', retrievedAt: new Date().toISOString() }; } };
    await refreshCatalog({ ...input, source: tagged, runId: 'tagged' });
    const cached = { id: 'test', cacheKey: 'stable-feed', async fetch({ etag }: { etag?: string }) {
      expect(etag).toBe('v1'); return { records: [], notModified: true, sourceUrl: 'https://example.com/fixture', retrievedAt: new Date().toISOString() };
    } };
    expect((await refreshCatalog({ ...input, source: cached, runId: 'cached' })).status).toBe('completed');
    expect((await store.read()).snapshots).toHaveLength(1);
  }));

  it('refetches instead of using an ETag after alias review changes', () => withStore(async store => {
    let sentEtag: string | undefined;
    const feed = { id: 'test', cacheKey: 'same-feed', async fetch({ etag }: { etag?: string }) {
      sentEtag = etag;
      return { records: rows, etag: 'v1', sourceUrl: 'https://example.com/fixture', retrievedAt: new Date().toISOString() };
    } };
    const input = { store, mapping, aliases, deployments: [], source: feed };
    await refreshCatalog({ ...input, runId: 'before-review' });
    const updated = aliases.map(a => ({ ...a, modelId: `${a.modelId}-reviewed` }));
    expect((await refreshCatalog({ ...input, aliases: updated, runId: 'after-review' })).status).toBe('completed');
    expect(sentEtag).toBeUndefined();
    expect((await store.read()).snapshots.at(-1)?.benchmarks[0]?.modelId).toBe('canonical/a-reviewed');
  }));
  it('keeps transient source failures resumable at their durable cursor', () => withStore(async store => {
    let available = false;
    const feed = { id: 'test', async fetch({ cursor }: { cursor?: string }) {
      if (cursor && !available) throw new RetryableSourceError('offline');
      return { records: cursor ? [rows[1]] : [rows[0]], ...(!cursor ? { nextCursor: 'page2' } : {}), sourceUrl: 'https://example.com/fixture', retrievedAt: new Date().toISOString() };
    } };
    const input = { store, mapping, aliases, deployments: [], source: feed, runId: 'resumable-outage' };
    await refreshCatalog(input);
    const interrupted = await refreshCatalog(input);
    expect(interrupted.status).toBe('running'); expect(interrupted.cursor).toBe('page2'); expect(interrupted.error).toContain('retry');
    available = true;
    const resumed = await refreshCatalog(input);
    expect(resumed.status).toBe('completed'); expect(resumed.error).toBeUndefined();
    expect((await store.read()).snapshots.at(-1)?.benchmarks).toHaveLength(2);
  }));
  it('keeps aborted batches resumable', () => withStore(async store => {
    const input = { store, mapping, aliases, deployments: [], source: source(rows), runId: 'aborted' };
    const interrupted = await refreshCatalog({ ...input, signal: AbortSignal.abort() });
    expect(interrupted.status).toBe('running');
    expect((await refreshCatalog(input)).status).toBe('completed');
  }));
  it('bounds HTTP response bytes while reading and cancels oversized streams', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(1_000_001)); },
      cancel() { cancelled = true; },
    });
    const feed = httpSource({ id: 'huge', url: 'https://example.com/feed', format: 'json', fetcher: async () => new Response(body) });
    await expect(feed.fetch({ signal: AbortSignal.timeout(1000) })).rejects.toThrow('payload exceeds');
    expect(cancelled).toBe(true);
  });

  it('rolls back failed transactions and releases the lock', () => withStore(async store => {
    await expect(store.transaction('test', async state => {
      state.etags.test = 'uncommitted'; throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect((await store.read()).etags).toEqual({});
    await store.transaction('test', async state => { state.etags.test = 'committed'; });
    expect((await store.read()).etags.test).toBe('committed');
  }));
  it('bounds transient HTTP retries without retrying authentication failures', async () => {
    let attempts = 0;
    const feed = httpSource({ id: 'retry', url: 'https://example.com/feed', format: 'json', retries: 1,
      fetcher: async () => { attempts++; return new Response('unavailable', { status: 503 }); } });
    await expect(feed.fetch({ signal: AbortSignal.timeout(2000) })).rejects.toBeInstanceOf(RetryableSourceError);
    expect(attempts).toBe(2);
    attempts = 0;
    const unauthorized = httpSource({ id: 'unauthorized', url: 'https://example.com/feed', format: 'json', retries: 1,
      fetcher: async () => { attempts++; return new Response('unauthorized', { status: 401 }); } });
    await expect(unauthorized.fetch({ signal: AbortSignal.timeout(2000) })).rejects.toThrow('HTTP 401');
    expect(attempts).toBe(1);
  });

});
