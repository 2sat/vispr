import type { Deployment, InferenceRequest, Usage } from '@vispr/contracts';
export type ExecutionEvent = { type: 'text_delta'; text: string } | { type: 'tool_delta'; toolCallId: string; argumentsDelta: string; name?: string } | { type: 'usage'; usage: Usage };
export interface ExecutionAdapter {
  execute(input: { deployment: Deployment; request: InferenceRequest; signal: AbortSignal }): AsyncIterable<ExecutionEvent>;
}
