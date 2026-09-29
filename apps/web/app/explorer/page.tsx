import { AppHeader } from '../../components/AppHeader';
import { ModelExplorer } from '../../components/explorer/ModelExplorer';
import discovery from '../../../../docs/data/demo-pool-discovery.json';
import type { ExplorerModel } from '../../lib/model-explorer';

export default function ExplorerPage() {
  const models: ExplorerModel[] = discovery.models.map(model => ({
    id: model.id, name: model.name, provider: model.id.split('/')[0]!,
    inputUsdPerMillion: Number(model.pricing.prompt) * 1e6,
    outputUsdPerMillion: Number(model.pricing.completion) * 1e6,
    context: model.context_length, latency: null, coding: null, reasoning: null, design: null,
    provenance: 'OpenRouter discovery snapshot. Advertised starting rates; provider tiers and extra charges may differ. Benchmark versions and full completion latency are not verified.',
    sourceUrl: `https://openrouter.ai/${model.id}`,
  }));
  return <><AppHeader active="explorer" traceHref="/runs/demo-code-debugging" role="Builder" /><ModelExplorer discovery={models} retrievedAt={discovery.retrievedAt} /></>;
}
