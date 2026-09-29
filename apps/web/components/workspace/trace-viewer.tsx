import type { TraceEvent } from '@vispr/contracts';
const money = (micros: number) => `$${(micros / 1e6).toFixed(2)}`;
function EventBody({ event }: { event: TraceEvent }) {
  switch (event.type) {
    case 'assessment': return <><p className="trace-primary">{event.assessment.task} <span>· {event.assessment.complexity} complexity</span></p><p>{Math.round(event.assessment.confidence * 100)}% confidence · {event.assessment.continuity} routing</p><small>Assessment fixture, not a Jev call</small></>;
    case 'candidates': return <ul className="candidate-list">{event.candidates.map(candidate => <li key={candidate.deploymentId}><div><strong>{candidate.deploymentId}</strong><span className={candidate.eligible ? 'positive' : 'muted'}>{candidate.eligible ? 'Eligible' : 'Excluded'}</span></div><p>{candidate.reasons.join(' · ')}</p>{candidate.quality !== null && <small>Illustrative quality: {Math.round(candidate.quality * 100)}% · {candidate.estimatedLatencyMs} ms</small>}</li>)}</ul>;
    case 'bid': return <><p className="trace-primary">{event.bid.deploymentId}</p><p>{money(event.bid.inputMicrosPerMillionTokens)} input / {money(event.bid.outputMicrosPerMillionTokens)} output per 1M tokens</p><small>Simulated offer · {event.bid.queueMs} ms queue</small></>;
    case 'award': return <><p className="trace-primary">{event.award.deploymentId}</p><p>Scripted example winner</p><small>Policy v{event.award.policyVersion} · {event.award.catalogSnapshotId}</small></>;
    case 'continuity': return <><p className="trace-primary">{event.deploymentId}</p><p>{event.reason}</p></>;
    case 'text_delta': return <p>Response content received.</p>;
    case 'tool_delta': return <p>Tool {event.name ?? event.toolCallId}: argument fragment received.</p>;
    case 'usage': return <><p>{event.usage.inputTokens} input / {event.usage.outputTokens} output tokens</p><small>Fixture counts · no inference charge</small></>;
    case 'completed': return <p>Example playback complete.</p>;
    case 'error': return <><p className="trace-primary">{event.code}</p><p>{event.message}</p>{event.partial && <small>Partial output retained.</small>}</>;
  }
}
const titles: Record<TraceEvent['type'], string> = { assessment: 'Task assessment', candidates: 'Eligible model pool', bid: 'Provider offer', award: 'Auction award', continuity: 'Session continuity', text_delta: 'Response', tool_delta: 'Tool call', usage: 'Usage', completed: 'Completed', error: 'Request error' };
export function TraceViewer({ events }: { events: TraceEvent[] }) {
  if (!events.length) return <div className="trace-empty"><span className="orbit">◎</span><h3>Every decision, visible.</h3><p>Play an example to inspect its assessment, eligible pool, offers and outcome.</p><div className="trace-steps">Assess <span>→</span> Select <span>→</span> Auction <span>→</span> Respond</div></div>;
  return <ol className="timeline">{events.map(event => <li key={`${event.requestId}-${event.sequence}`}><span className="step-index">{event.sequence + 1}</span><details open={event.type !== 'text_delta' && event.type !== 'usage' && event.type !== 'completed'}><summary>{titles[event.type]}</summary><div className="event-body"><EventBody event={event} /></div></details></li>)}</ol>;
}
