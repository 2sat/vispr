import type { CatalogSnapshot } from '@vispr/contracts';
export interface CatalogSource {
  readonly id: string;
  fetch(input: { cursor?: string; signal: AbortSignal }): Promise<{ records: unknown[]; nextCursor?: string; sourceUrl: string; retrievedAt: string }>;
}
export interface CatalogRepository {
  getSnapshot(id?: string): Promise<CatalogSnapshot | null>;
  publish(snapshot: CatalogSnapshot, sourceRunId: string): Promise<void>;
}
