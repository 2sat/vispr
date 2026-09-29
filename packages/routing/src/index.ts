import type { Assessment, Candidate, CatalogSnapshot, InferenceRequest, Policy } from '@vispr/contracts';
export interface TaskClassifier {
  assess(request: InferenceRequest, context: { currentDeploymentId?: string; unresolvedToolCallIds: string[] }, signal: AbortSignal): Promise<Assessment>;
}
export interface PoolSelector {
  select(input: { request: InferenceRequest; policy: Policy; assessment: Assessment; catalog: CatalogSnapshot }): Candidate[];
}
