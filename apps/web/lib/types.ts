// View-model types for the Playground and Request trace screens.
// These mirror the spec's core records but only carry what the UI renders.

export type ScenarioId =
  | 'support-triage'
  | 'invoice-extraction'
  | 'code-debugging'
  | 'research-synthesis'
  | 'ui-design';

export type OutputKind = 'text' | 'json' | 'html';

export interface Weights {
  /** Relative weights; the three always sum to 100. */
  quality: number;
  cost: number;
  latency: number;
}

export interface PolicyPreset {
  id: string;
  version: number;
  /** Short plain-language label shown next to the Run button. */
  label: string;
  mode: 'weighted' | 'cheapest-qualified';
  weights: Weights;
  minQuality: number;
  maxSpendUsd: number | null;
  latencyTarget: { metric: 'first-token' | 'completion'; ms: number };
  missingCoverage: 'exclude' | 'penalize';
  onLowConfidence: 'fail' | 'conservative-pool';
  onNoBid: 'fail' | 'fallback';
  onProviderError: 'retry-next-bid' | 'fail';
}

export interface Scenario {
  id: ScenarioId;
  name: string;
  summary: string;
  prompt: string;
  attachments: string[];
  defaultPolicyId: string;
  outputKind: OutputKind;
  /** Caveat about benchmark evidence for this kind of task. */
  evidenceNote: string;
}

export interface Timing {
  classificationMs: number;
  selectionMs: number;
  auctionMs: number;
  /** Measured from request start. */
  firstTokenMs: number;
  totalMs: number;
}

/** Kept separate on purpose: the spec forbids blending these. */
export interface CostBreakdown {
  simulatedQuoteUsd: number | null;
  estimatedUpstreamUsd: number | null;
  usageDerivedUpstreamUsd: number | null;
  actualBillingUsd: number | null;
  runBudgetUsd: number | null;
  runBudgetUsedUsd: number | null;
}

export interface RunSummary {
  runId: string;
  scenarioId: ScenarioId;
  policyId: string;
  winner: { model: string; provider: string };
  bidCount: number;
  timing: Timing;
  usage: { inputTokens: number; outputTokens: number } | null;
  cost: CostBreakdown;
  outputKind: OutputKind;
  output: string;
  /** True when the run came from demo fixtures rather than the live SDK path. */
  illustrative: boolean;
}

export type RunResult =
  | { ok: true; run: RunSummary }
  | { ok: false; error: string };

export interface RunRequest {
  scenarioId: ScenarioId;
  policyId: string;
  prompt: string;
}

// ---- Trace ----

export type BidStrategy = 'fixed' | 'capacity-adjusted' | 'bounded-discount';

/** Normalized 0–1 utilities, computed against fixed per-run bounds. */
export interface Utilities {
  quality: number;
  cost: number;
  latency: number;
  penalty: number;
}

export interface Bid {
  deploymentId: string;
  model: string;
  provider: string;
  arrivedMs: number;
  inputUsdPerMtok: number | null;
  outputUsdPerMtok: number | null;
  strategy: BidStrategy;
  declaredQueueMs: number | null;
  status: 'valid' | 'awarded' | 'rejected';
  rejectReason?: string;
  /** Absent for rejected bids. */
  utilities?: Utilities;
}

export interface ExcludedCandidate {
  model: string;
  deployment: string;
  reason: string;
  /** What would make it eligible; null means a hard requirement. */
  remedy: string | null;
}

export interface TraceView {
  run: RunSummary;
  scenarioName: string;
  policy: PolicyPreset;
  assessment: {
    taskFamilyLabel: string;
    complexity: 'low' | 'medium' | 'high';
    confidence: number;
    confidenceThreshold: number;
    requirements: string[];
    extracted: {
      toolSchemas: number;
      images: number;
      outputFormat: string;
      inputTokensEstimate: number;
      outputTokenCap: number;
    };
  };
  pool: { consideredCount: number; invitedCount: number; excluded: ExcludedCandidate[] };
  auction: { deadlineMs: number; bids: Bid[] };
  versions: {
    catalogSnapshotId: string;
    catalogRefreshedAt: string | null;
    jevModelVersion: string;
    assessmentSchemaVersion: string;
    benchmarkProfile: string;
    idempotencyKey: string;
  };
  auctionStates: string[];
  fallback: string | null;
  storedContent: 'metadata' | 'full';
}
