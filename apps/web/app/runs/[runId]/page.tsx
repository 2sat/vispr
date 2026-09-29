import { notFound } from 'next/navigation';
import { AppHeader } from '../../../components/AppHeader';
import { RequestTrace } from '../../../components/RequestTrace';
import { getRunTrace } from '../../../lib/vispr-server';

export default async function RunTracePage({ params, searchParams }: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ policy?: string | string[] }>;
}) {
  const { runId } = await params;
  const { policy } = await searchParams;
  const trace = await getRunTrace(runId, typeof policy === 'string' ? policy : undefined);
  if (!trace) notFound();
  return (
    <>
      <AppHeader active="trace" traceHref={`/runs/${runId}?policy=${encodeURIComponent(trace.policy.id)}`} role="Builder" />
      <RequestTrace trace={trace} />
    </>
  );
}
