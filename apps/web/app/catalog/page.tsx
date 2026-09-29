import { AppHeader } from '../../components/AppHeader';
import { ModelExplorer } from '../../components/explorer/ModelExplorer';
import { discoveryModels, discoveryRetrievedAt } from '../../lib/model-discovery';

export default function CatalogPage() {
  return <><AppHeader active="catalog" traceHref="/runs/demo-code-debugging" role="Builder" /><ModelExplorer discovery={discoveryModels} retrievedAt={discoveryRetrievedAt} initialDataset="discovery" /></>;
}
