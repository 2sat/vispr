import { readFile } from 'node:fs/promises';
import { artifactSource, artificialAnalysisSource, FileCatalogStore, httpSource, refreshCatalog, type AliasMapping, type ImportMapping } from './index';
import { DeploymentSchema } from '@vispr/contracts';

// Configuration files contain mappings and source metadata only. Keys come from server environment.
async function main() {
  const [configPath, statePath, runId] = process.argv.slice(2);
  if (!configPath || !statePath || !runId) throw new Error('Usage: pnpm --filter @vispr/catalog ingest <config.json> <state.json> <durable-run-id>');
  const config = JSON.parse(await readFile(configPath, 'utf8')) as {
    sourceId: string; sourceUrl: string; format: 'json' | 'csv' | 'artificial-analysis'; file?: string;
    mapping: ImportMapping; aliases: AliasMapping[]; deployments: unknown[]; batchSize?: number;
  };
  const source = config.format === 'artificial-analysis'
    ? artificialAnalysisSource(process.env.ARTIFICIAL_ANALYSIS_API_KEY ?? '')
    : config.file ? artifactSource({ id: config.sourceId, sourceUrl: config.sourceUrl, format: config.format, text: await readFile(config.file, 'utf8') })
    : httpSource({ id: config.sourceId, url: config.sourceUrl, format: config.format });
  const run = await refreshCatalog({ runId, source, store: new FileCatalogStore(statePath), mapping: config.mapping, aliases: config.aliases,
    deployments: config.deployments.map(d => DeploymentSchema.parse(d)), ...(config.batchSize ? { batchSize: config.batchSize } : {}) });
  console.log(JSON.stringify({ id: run.id, status: run.status, counts: run.counts, snapshotId: run.snapshotId, quarantine: run.quarantine, error: run.error }));
  if (run.status === 'failed') process.exitCode = 1;
}
main().catch(() => { console.error('Catalog ingestion failed. Check configuration, source credentials, and store lock.'); process.exitCode = 1; });
