import type { ClassificationContext } from './classification';
import type { Assessment, Candidate, CatalogSnapshot, InferenceRequest, Policy } from '@vispr/contracts';
export interface TaskClassifier {
  assess(request: InferenceRequest, context: ClassificationContext, signal: AbortSignal): Promise<Assessment>;
}
export interface PoolSelector {
  select(input: { request: InferenceRequest; policy: Policy; assessment: Assessment; catalog: CatalogSnapshot }): Candidate[];
}
export { selectCandidates, createPoolSelector, estimateCostMicros, scoreUtilities } from './selection';
export type { SelectionContext, BenchmarkRule, EndpointMetrics, ScoredCandidate, ScoreBreakdown, BenchmarkAxis } from './selection';
export { decideContinuity } from './continuity';
export type { ContinuityDecision } from './continuity';

export { JevClassifier, ClassificationError, parseJevResponse, JEV_QUESTIONS, JEV_REVISION } from './classification';
export type { ClassificationContext, AttemptReport, DetailedClassifier, ClassifiedAssessment, JevOptions } from './classification';
export { AssessmentService, MemoryAssessmentCache, assessmentCacheKey } from './cache';
export type { AssessmentCache, AssessmentCacheEntry, AssessmentResult } from './cache';
export { evaluateOffer } from './offer-scoring';
export { routeRequest } from './engine';
export type { RouteResult, AssessmentProvider } from './engine';

export { resolveSourcePool, SourceRoutingError } from './source-routing';
