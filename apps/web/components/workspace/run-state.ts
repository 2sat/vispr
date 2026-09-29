import type { TraceEvent } from '@vispr/contracts';
export interface RunView { events: TraceEvent[]; output: string; status: 'playing' | 'completed' | 'cancelled' | 'failed'; requestId: string }
export function appendEvent(state: RunView, event: TraceEvent): RunView {
  if (state.status !== 'playing' || event.requestId !== state.requestId || event.sequence !== state.events.length) return state;
  return { ...state, events: [...state.events, event], output: state.output + (event.type === 'text_delta' ? event.text : ''), status: event.type === 'completed' ? 'completed' : event.type === 'error' ? (event.code === 'CANCELLED' ? 'cancelled' : 'failed') : 'playing' };
}
