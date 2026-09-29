import { AppHeader } from '../../components/AppHeader';
import { ProviderConsole } from '../../components/ProviderConsole';
import { listDeployments, probeEndpoint, saveDeployment } from '../../lib/vispr-server';

// Operator data changes per request; never prerender it at build time.
export const dynamic = 'force-dynamic';

export default async function ProvidersPage() {
  const deployments = await listDeployments();
  return (
    <>
      <AppHeader active="providers" traceHref="/runs/demo-code-debugging" role="Operator" />
      {deployments ? (
        <ProviderConsole
          deployments={deployments}
          illustrative={process.env.VISPR_DEMO_FIXTURES === '1'}
          saveDeployment={saveDeployment}
          probeEndpoint={probeEndpoint}
        />
      ) : (
        <p className="card page-error">Provider data isn’t available: the database isn’t connected yet. Set VISPR_DEMO_FIXTURES=1 for illustrative data.</p>
      )}
    </>
  );
}
