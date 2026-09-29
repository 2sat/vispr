import type { CatalogSnapshot } from '@vispr/contracts';
import type { SourcePage } from './connectors';
export interface CatalogSource {
  readonly id: string;
  /** Stable source/feed identity. Required for conditional cache reuse. */
  readonly cacheKey?: string;
  fetch(input: { cursor?: string; etag?: string; signal: AbortSignal }): Promise<SourcePage>;
}
export interface CatalogRepository {
  getSnapshot(id?: string): Promise<CatalogSnapshot | null>;
  publish(snapshot: CatalogSnapshot, sourceRunId: string): Promise<void>;
}
export * from './connectors';
export * from './ingestion';
export * from './file-store';
