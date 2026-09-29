import { AppHeader } from '../../components/AppHeader';
import { ProductFlow } from '../../components/product-flow/ProductFlow';
export default function ProductFlowPage() {
  return <><AppHeader active="flow" traceHref="/runs/demo-code-debugging" role="Builder" /><ProductFlow /></>;
}
