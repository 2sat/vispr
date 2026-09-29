import { resolveSourcePool } from './source-routing';
import { AssessmentSchema, PolicySchema, InferenceRequestSchema, type Assessment, type CatalogSnapshot, type InferenceRequest, type Policy, type SourceRouting } from '@vispr/contracts';
import { ClassificationError, throwIfAborted, type ClassificationContext } from './classification';
import type { AssessmentResult } from './cache';
import { selectCandidates, type ScoredCandidate, type SelectionContext } from './selection';
import { decideContinuity, type ContinuityDecision } from './continuity';
export interface AssessmentProvider { assess(input: { applicationId: string; request: InferenceRequest; context: ClassificationContext; cacheEnabled: boolean; signal: AbortSignal }): Promise<AssessmentResult> }
export interface RouteResult {
  assessment: Assessment | null;
  classification: AssessmentResult | null;
  source: 'live' | 'exact_cache' | 'tool_cycle_state' | 'fallback';
  failure: string | null;
  candidates: ScoredCandidate[];
  continuity: ContinuityDecision;
  poolMs: number;
  sourcePool: { source: string; poolId: string } | null;
}
export async function routeRequest(input: {
  applicationId: string; request: InferenceRequest; policy: Policy; catalog: CatalogSnapshot;
  context: ClassificationContext; service: AssessmentProvider; selection: SelectionContext;
  remainingBudget(): Promise<number>;
  now?: () => number;
  sourceRouting?: SourceRouting;
  cacheEnabled: boolean; confidenceThreshold: number; signal: AbortSignal;
  conservativePool: { task: Assessment['task']; deploymentIds: readonly string[] };
  toolCycle?: { locked: boolean; previousAssessment: Assessment };
}): Promise<RouteResult> {
  throwIfAborted(input.signal); PolicySchema.parse(input.policy); InferenceRequestSchema.parse(input.request);
  if (!Number.isFinite(input.confidenceThreshold) || input.confidenceThreshold < 0 || input.confidenceThreshold > 1) throw new Error('Invalid confidence threshold');
  // Apply before every path, including tool locks, cache hits and fallback.
  const scoped = resolveSourcePool(input.request.source, input.sourceRouting, input.catalog);
  input = { ...input, catalog: scoped.catalog, selection: { ...input.selection, ...(scoped.criteria ? { poolCriteria: scoped.criteria, selection: { paretoOnly: true, ...input.selection.selection } } : {}) } };
  let assessment: Assessment | null = null, classification: AssessmentResult | null = null;
  let source: RouteResult['source'] = 'fallback', failure: string | null = null;
  // Caller supplies authenticated, session-bound lock state; this API is server-only.
  // Skip only a matching tool result, never a new user instruction or a lock whose
  // current deployment has stopped satisfying the request's requirements.
  const lastMessage = input.request.messages.at(-1);
  if (input.toolCycle?.locked && lastMessage?.role === 'tool' && input.context.unresolvedToolCallIds.includes(lastMessage.toolCallId) && input.context.currentDeploymentId && input.policy.continuity !== 'fresh') {
    const previous = AssessmentSchema.parse(input.toolCycle.previousAssessment);
    const deployment = input.catalog.deployments.find(d => d.id === input.context.currentDeploymentId);
    if (deployment && previous.continuity === 'tool_cycle') {
      const budget = await input.remainingBudget();
      throwIfAborted(input.signal);
      const check = selectCandidates({ request: input.request, policy: input.policy, assessment: previous, catalog: { ...input.catalog, deployments: [deployment] } }, { ...input.selection, now: (input.now ?? Date.now)(), remainingRequestBudgetMicros: budget });
      if (check[0]?.eligible) { assessment = previous; source = 'tool_cycle_state'; }
    }
  }
  if (!assessment) {
    try {
      classification = await input.service.assess({ applicationId: input.applicationId, request: input.request, context: input.context, cacheEnabled: input.cacheEnabled, signal: input.signal });
      assessment = AssessmentSchema.parse(classification.assessment); source = classification.source;
    } catch (error) {
      throwIfAborted(input.signal);
      if (!(error instanceof ClassificationError)) throw error; // Ledger/configuration failures must not silently fall back.
      failure = error.code;
    }
  }
  throwIfAborted(input.signal);
  const started = performance.now();
  const confident = assessment !== null && assessment.confidence >= input.confidenceThreshold && assessment.continuityConfidence >= input.confidenceThreshold;
  const effectiveAssessment = confident ? assessment : null;
  const remainingRequestBudgetMicros = await input.remainingBudget();
  const selection = { ...input.selection, now: (input.now ?? Date.now)(), remainingRequestBudgetMicros, fallbackTask: input.conservativePool.task };
  throwIfAborted(input.signal);
  const allowed = new Set(input.conservativePool.deploymentIds);
  const catalog = confident ? input.catalog : { ...input.catalog, deployments: input.catalog.deployments.filter(d => allowed.has(d.id)) };
  let candidates = selectCandidates({ request: input.request, policy: input.policy, assessment: effectiveAssessment, catalog }, selection);
  const current = input.catalog.deployments.find(d => d.id === input.context.currentDeploymentId);
  // Continuity requires hard eligibility, not ranking in the capped auction pool.
  const currentCandidate = current ? selectCandidates({ request: input.request, policy: input.policy, assessment: effectiveAssessment, catalog: { ...input.catalog, deployments: [current] } }, selection)[0] : undefined;
  const continuity = decideContinuity({ mode: input.policy.continuity, assessment, confidenceThreshold: input.confidenceThreshold, ...(input.context.currentDeploymentId ? { currentDeploymentId: input.context.currentDeploymentId } : {}), currentDeploymentQualifies: currentCandidate?.eligible ?? false, toolCycleLocked: source === 'tool_cycle_state' });
  if (continuity.action === 'retain' && currentCandidate) candidates = [currentCandidate];
  return { assessment, classification, source, failure, candidates, continuity, sourcePool: scoped.sourcePool, poolMs: performance.now() - started };
}
