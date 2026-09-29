import { InvocationSourceSchema } from '@vispr/contracts';
import type { InferenceRequest, TraceEvent } from '@vispr/contracts';
// Transport implementation follows in the platform workstream. No fake live client.
export interface VisprClient {
  stream(request: InferenceRequest, options?: { signal?: AbortSignal }): AsyncIterable<TraceEvent>;
  cancel(requestId: string): Promise<void>;
}

/** Bind a component/agent step to a source without repeating the tag on each call. */
export function withSource(client: VisprClient, source: string): VisprClient {
  const tag = InvocationSourceSchema.parse(source);
  return {
    stream(request, options) { return client.stream({ ...request, source: tag }, options); },
    cancel(requestId) { return client.cancel(requestId); },
  };
}
