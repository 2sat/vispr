import { PoolCriteriaSchema, type PoolCriteria, BidSchema, PolicySchema, type Bid, type Policy } from '@vispr/contracts';
import { estimateCostMicros, scoreUtilities, withinBand, type ScoreBreakdown } from './selection';
export function evaluateOffer(input: {
  bid: Bid; policy: Policy; inputTokens: number; outputTokens: number;
  remainingRequestBudgetMicros: number; quality: number; uncertainty: number;
  observedCompletionMs: number; poolCriteria?: PoolCriteria;
}): { eligible: boolean; reason?: string; utility: number; estimatedLatencyMs: number; estimatedCostMicros: number; score: ScoreBreakdown } {
  const bid = BidSchema.parse(input.bid), policy = PolicySchema.parse(input.policy);
  if (!Number.isSafeInteger(input.remainingRequestBudgetMicros) || input.remainingRequestBudgetMicros < 0) throw new Error('Invalid remaining budget');
  const estimatedCostMicros = estimateCostMicros(input.inputTokens, input.outputTokens, bid.inputMicrosPerMillionTokens, bid.outputMicrosPerMillionTokens);
  // Claims can worsen the estimate; a fast claim alone cannot erase observed latency.
  if (!Number.isFinite(input.observedCompletionMs) || input.observedCompletionMs < 0) throw new Error('Missing observed latency');
  const estimatedLatencyMs = Math.max(input.observedCompletionMs, bid.queueMs + input.outputTokens / bid.tokensPerSecond * 1000);
  const score = scoreUtilities(policy, input.quality, estimatedCostMicros, estimatedLatencyMs, input.uncertainty);
  const criteria = input.poolCriteria ? PoolCriteriaSchema.parse(input.poolCriteria) : undefined;
  const reason = !withinBand(estimatedCostMicros, criteria?.estimatedCostMicros) ? 'Outside source inference-cost band' : !withinBand(estimatedLatencyMs, criteria?.latencyMs) ? 'Outside source latency band' : input.quality < policy.minimumQuality ? 'Minimum quality not met' : input.outputTokens > policy.maxOutputTokens ? 'Output token limit exceeded' : estimatedCostMicros > Math.min(policy.requestBudgetMicros, input.remainingRequestBudgetMicros) ? 'Remaining request budget exceeded' : estimatedLatencyMs > policy.maxLatencyMs ? 'Latency limit exceeded' : undefined;
  return { eligible: !reason, ...(reason ? { reason } : {}), utility: score.total, estimatedLatencyMs, estimatedCostMicros, score };
}
