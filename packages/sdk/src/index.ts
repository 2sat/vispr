import type { InferenceRequest, TraceEvent } from '@vispr/contracts';
// Transport implementation follows in the platform workstream. No fake live client.
export interface VisprClient {
  stream(request: InferenceRequest, options?: { signal?: AbortSignal }): AsyncIterable<TraceEvent>;
  cancel(requestId: string): Promise<void>;
}
