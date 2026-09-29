import { createHash } from 'node:crypto';
import type { CatalogSource } from './index';

export interface BenchmarkMapping { field: string; benchmark: string; version: string; min: number; max: number }
export interface ImportMapping {
  id: string; model: string; benchmarks: BenchmarkMapping[];
  configuration?: string; inputPrice?: string; outputPrice?: string;
  tokensPerSecond?: string; timeToFirstTokenSeconds?: string;
}
export interface SourcePage {
  records: unknown[]; nextCursor?: string; sourceUrl: string; retrievedAt: string;
  contentHash?: string; etag?: string; notModified?: boolean;
}
/** RFC 4180 quoted fields, including embedded newlines. Reject malformed input. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === '"' && field === '' && !closed) quoted = true;
    else if (c === ',' || c === '\n' || c === '\r') {
      row.push(field); field = ''; closed = false;
      if (c !== ',') { if (c === '\r' && text[i + 1] === '\n') i++; rows.push(row); row = []; }
    } else { if (closed || c === '"') throw new Error('Malformed CSV quoting'); field += c; }
  }
  if (quoted) throw new Error('Unterminated CSV field');
  if (field || row.length || closed) { row.push(field); rows.push(row); }
  const headers = rows.shift();
  if (!headers?.length || headers.some(h => !h) || new Set(headers).size !== headers.length) throw new Error('Invalid CSV headers');
  return rows.filter(r => !(r.length === 1 && r[0] === '')).map(r => {
    if (r.length !== headers.length) throw new Error('CSV column count mismatch');
    return Object.fromEntries(headers.map((h, i) => [h, r[i]!]));
  });
}
export class RetryableSourceError extends Error {}
const MAX_PAYLOAD_BYTES = 5_000_000;
async function readBoundedBody(response: Response): Promise<string> {
  if (!response.body) throw new Error('Source response has no body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PAYLOAD_BYTES) { await reader.cancel(); throw new Error('Source payload exceeds batch limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}
export function artifactSource(input: { id: string; sourceUrl: string; text: string; format: 'json' | 'csv' }): CatalogSource {
  if (Buffer.byteLength(input.text) > MAX_PAYLOAD_BYTES) throw new Error('Source payload exceeds batch limit');
  return { id: input.id, cacheKey: createHash('sha256').update(input.sourceUrl).update(input.format).update(input.text).digest('hex'), async fetch() {
    const records: unknown = input.format === 'csv' ? parseCsv(input.text) : JSON.parse(input.text);
    if (!Array.isArray(records)) throw new Error('Import must contain an array');
    return { records, sourceUrl: input.sourceUrl, retrievedAt: new Date().toISOString() };
  } };
}
export function httpSource(input: {
  id: string; url: string; format: 'json' | 'csv' | 'artificial-analysis';
  apiKey?: string; fetcher?: typeof fetch; retries?: number;
}): CatalogSource {
  const url = new URL(input.url);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Source requires credential-free HTTPS URL');
  if (input.format === 'artificial-analysis' && (!input.apiKey || url.origin !== 'https://artificialanalysis.ai')) throw new Error('Artificial Analysis requires a server key and official origin');
  return { id: input.id, cacheKey: `${url.href}|${input.format}`, async fetch({ signal, etag }) {
    const headers: Record<string, string> = {};
    if (input.apiKey) headers['x-api-key'] = input.apiKey;
    if (etag) headers['if-none-match'] = etag;
    const retries = input.retries ?? 2;
    if (!Number.isInteger(retries) || retries < 0 || retries > 5) throw new Error('Invalid retry limit');
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      const response = await (input.fetcher ?? fetch)(url, { headers, signal, redirect: 'error' }).catch(() => {
        signal.throwIfAborted();
        throw new RetryableSourceError('Source network unavailable');
      });
      if (response.status === 304) return { records: [], notModified: true, sourceUrl: url.href, retrievedAt: new Date().toISOString() };
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        await response.body?.cancel();
        await new Promise<void>((resolve, reject) => {
          const abort = () => { clearTimeout(timer); reject(signal.reason); };
          const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 100 * 2 ** attempt);
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        }); continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429 || response.status >= 500) throw new RetryableSourceError(`Source HTTP ${response.status}`);
        throw new Error(`Source HTTP ${response.status}`);
      }
      const text = await readBoundedBody(response);
      const payload: unknown = input.format === 'csv' ? parseCsv(text) : JSON.parse(text);
      const records: unknown = input.format === 'artificial-analysis' ? (payload as { data?: unknown }).data : payload;
      if (!Array.isArray(records)) throw new Error('Source response must contain a records array');
      const tag = response.headers.get('etag');
      return { records, sourceUrl: url.href, retrievedAt: new Date().toISOString(), ...(tag ? { etag: tag } : {}) };
    }
  } };
}
export function artificialAnalysisSource(apiKey: string, fetcher?: typeof fetch): CatalogSource {
  return httpSource({ id: 'artificial-analysis', url: 'https://artificialanalysis.ai/api/v2/data/llms/models', format: 'artificial-analysis', apiKey, ...(fetcher ? { fetcher } : {}) });
}
