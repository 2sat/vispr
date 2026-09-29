import { TraceEventSchema, type TraceEvent } from '@vispr/contracts';
import { sampleEvents, scenarios } from '@vispr/contracts/fixtures';

// Presentation fixtures only. No routing, benchmark evidence or provider calls.
export const designDocument = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#f4efdf;color:#283e26;font-family:Georgia,serif;padding:32px}header{display:flex;justify-content:space-between;font:12px Arial,sans-serif;border-bottom:1px solid #c5cdb3;padding-bottom:16px}main{padding:42px 0}small{font:11px Arial,sans-serif;letter-spacing:2px}h1{font-size:clamp(36px,8vw,58px);line-height:1.05;max-width:480px;margin:18px 0}p{font:16px/1.6 Arial,sans-serif;max-width:440px}.pill{display:inline-block;padding:14px 20px;background:#304d30;color:white;border-radius:30px;font:12px Arial,sans-serif}.bottom{margin-top:44px;border-top:1px solid #c5cdb3;padding-top:18px;font:12px Arial,sans-serif}</style></head><body><header><strong>THE SEED LIBRARY</strong><span>Grown together.</span></header><main><small>SMALL SEEDS. SHARED POSSIBILITIES.</small><h1>A little borrowed.<br>A lot to grow.</h1><p>Borrow seeds, grow something good, and bring a little back. A neighborhood library for the next growing season.</p><span class="pill">Find your first seeds ↗</span><div class="bottom">01 &nbsp; Borrow &nbsp;&nbsp; 02 &nbsp; Grow &nbsp;&nbsp; 03 &nbsp; Share</div></main></body></html>`;
const responses: Record<string, string> = {
  support: 'Category: billing · Duplicate charge\n\nThanks for flagging this. I’m sorry for the confusion. Please share your order number so we can check the two charges and confirm whether a correction is needed.',
  extraction: '{\n  "invoice_number": "INV-204",\n  "amount": 145.00,\n  "currency": "USD"\n}',
  coding: 'The empty array throws because reduce has no initial accumulator. Supply zero:\n\nconst sum = xs => xs.reduce((a, b) => a + b, 0);\n\nThis returns 0 for an empty array and sums non-empty numeric arrays.',
  research: 'The sources report different outcomes in different settings. [A] describes a trial with improved latency and higher cost. [B] describes production with unchanged latency and lower cost.\n\nThe supplied evidence does not establish why the outcomes differ. Neither result alone resolves the other’s findings.',
  design: designDocument,
};
export function fixtureEvents(scenarioId: string, requestId: string, policyVersion: number): TraceEvent[] {
  if (!scenarios.some(s => s.id === scenarioId)) throw new Error('Unknown scenario');
  const baseAssessment = sampleEvents[0];
  if (!baseAssessment || baseAssessment.type !== 'assessment') throw new Error('Missing shared assessment fixture');
  const raw: unknown[] = [
    { type: 'assessment', assessment: { ...baseAssessment.assessment, task: scenarioId, complexity: ['coding', 'research', 'design'].includes(scenarioId) ? 'high' : 'low' } },
    { type: 'candidates', candidates: [
      { deploymentId: 'example-balanced', eligible: true, reasons: ['Illustrative capability match'], quality: .82, estimatedCostMicros: 8000, estimatedLatencyMs: 900 },
      { deploymentId: 'example-fast', eligible: true, reasons: ['Illustrative capability match'], quality: .7, estimatedCostMicros: 4000, estimatedLatencyMs: 350 },
      { deploymentId: 'example-local', eligible: false, reasons: ['Self-hosted endpoint pending connectivity'], quality: null, estimatedCostMicros: null, estimatedLatencyMs: null },
    ] },
    ...['example-balanced', 'example-fast'].map((deploymentId, i) => ({ type: 'bid', bid: { id: `example-bid-${i}`, auctionId: `auction-${requestId}`, deploymentId, simulated: true, inputMicrosPerMillionTokens: i ? 500000 : 1000000, outputMicrosPerMillionTokens: i ? 1500000 : 3000000, queueMs: i ? 20 : 50, tokensPerSecond: i ? 100 : 60, receivedAt: '2026-09-29T20:00:00Z', validUntil: '2026-09-29T20:01:00Z', reservationToken: `example-reservation-${i}` } })),
    { type: 'award', award: { auctionId: `auction-${requestId}`, bidId: 'example-bid-0', deploymentId: 'example-balanced', policyVersion, catalogSnapshotId: 'synthetic-catalog-v1' } },
    { type: 'text_delta', text: responses[scenarioId] ?? '' },
    { type: 'usage', usage: { inputTokens: 120, outputTokens: 80, actualCostMicros: null, reconciliation: 'pending' } },
    { type: 'completed' },
  ];
  return raw.map((event, sequence) => TraceEventSchema.parse({ ...(event as object), requestId, sequence }));
}
export interface RunView { events: TraceEvent[]; output: string; status: 'playing' | 'completed' | 'cancelled' | 'failed'; requestId: string }
export function appendEvent(state: RunView, event: TraceEvent): RunView {
  if (state.status !== 'playing' || event.requestId !== state.requestId || event.sequence !== state.events.length) return state;
  return { ...state, events: [...state.events, event], output: state.output + (event.type === 'text_delta' ? event.text : ''), status: event.type === 'completed' ? 'completed' : event.type === 'error' ? (event.code === 'CANCELLED' ? 'cancelled' : 'failed') : 'playing' };
}
export function cancelRun(state: RunView): RunView {
  return state.status === 'playing' ? { ...state, status: 'cancelled' } : state;
}
