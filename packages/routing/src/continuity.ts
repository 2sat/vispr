import type { Assessment, Policy } from '@vispr/contracts';
export type ContinuityDecision = { action: 'retain'; deploymentId: string; reason: string } | { action: 'auction' | 'conservative_pool'; reason: string };
export function decideContinuity(input: {
  mode: Policy['continuity']; assessment: Assessment | null; confidenceThreshold: number;
  currentDeploymentId?: string; currentDeploymentQualifies: boolean; toolCycleLocked: boolean;
}): ContinuityDecision {
  if (!Number.isFinite(input.confidenceThreshold) || input.confidenceThreshold < 0 || input.confidenceThreshold > 1) throw new Error('Invalid confidence threshold');
  const canRetain = Boolean(input.currentDeploymentId) && input.currentDeploymentQualifies;
  const retain = (reason: string): ContinuityDecision => ({ action: 'retain', deploymentId: input.currentDeploymentId!, reason });
  const confident = input.assessment !== null && input.assessment.confidence >= input.confidenceThreshold && input.assessment.continuityConfidence >= input.confidenceThreshold;
  if (input.mode === 'fresh') return { action: confident ? 'auction' : 'conservative_pool', reason: 'Application requires fresh selection' };
  if (canRetain && (input.mode === 'retain' || input.toolCycleLocked)) return retain(input.toolCycleLocked ? 'Established tool cycle' : 'Application requires continuity');
  if (!confident) return canRetain ? retain('Uncertain or unavailable classification; current deployment still qualifies') : { action: 'conservative_pool', reason: 'Uncertain or unavailable classification; no qualifying current deployment' };
  if (canRetain && input.assessment!.continuity !== 'fresh') return retain(`Classifier chose ${input.assessment!.continuity}`);
  return { action: 'auction', reason: canRetain ? 'Classifier identified an independent task' : 'Fresh eligible deployment required' };
}
