import { notFound } from 'next/navigation';
import { AppHeader } from '../../../components/AppHeader';
import { RequestTrace } from '../../../components/RequestTrace';
import { getRunTrace } from '../../../lib/vispr-server';

export default async function RunTracePage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const trace = await getRunTrace(runId);
  if (!trace) notFound();
  return (
    <>
      <AppHeader active="trace" traceHref={`/runs/${runId}`} role="Builder" />
      <RequestTrace trace={trace} />
    </>
  );
}
