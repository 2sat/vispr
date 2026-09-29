import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { emptyCatalogState, type CatalogState, type IngestionStore } from './ingestion';

/** Local durable store. All sources serialize on one lock; a crash leaves a lock for operator recovery. */
export class FileCatalogStore implements IngestionStore {
  readonly path: string;
  constructor(path: string) { this.path = path; }
  async read(): Promise<CatalogState> {
    try { return JSON.parse(await readFile(this.path, 'utf8')) as CatalogState; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyCatalogState(); throw error; }
  }
  async transaction<T>(_sourceId: string, action: (state: CatalogState) => Promise<T>): Promise<T> {
    await mkdir(dirname(this.path), { recursive: true });
    const lock = await open(`${this.path}.lock`, 'wx', 0o600);
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      const state = await this.read(), result = await action(state);
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(state)); await file.sync(); } finally { await file.close(); }
      await rename(temporary, this.path);
      const directory = await open(dirname(this.path), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
      return result;
    } finally {
      try {
        await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
      } finally {
        try { await lock.close(); } finally { await unlink(`${this.path}.lock`); }
      }
    }
  }
}
