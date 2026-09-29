// Demo fixtures. Every value here is ILLUSTRATIVE — layout data, not measured results.
// They are served only when VISPR_DEMO_FIXTURES=1 and the UI labels them as such.

import type { FeatureSet, PolicyPreset, ProviderAuction, ProviderDeployment, RunSummary, Scenario, ScenarioId, TraceView } from './types';

const basePolicy = {
  version: 3,
  maxSpendUsd: null,
  missingCoverage: 'exclude',
  onLowConfidence: 'fail',
  onProviderError: 'retry-next-bid',
} as const;

export const policies: PolicyPreset[] = [
  { ...basePolicy, id: 'fast-support', label: 'Speed & cost', mode: 'weighted', weights: { quality: 20, cost: 40, latency: 40 }, minQuality: 0.4, latencyTarget: { metric: 'first-token', ms: 1_000 }, onNoBid: 'fallback' },
  { ...basePolicy, id: 'strict-extraction', label: 'Quality', mode: 'weighted', weights: { quality: 60, cost: 30, latency: 10 }, minQuality: 0.6, latencyTarget: { metric: 'completion', ms: 20_000 }, onNoBid: 'fail' },
  { ...basePolicy, id: 'quality-first', label: 'Quality', mode: 'weighted', weights: { quality: 75, cost: 15, latency: 10 }, minQuality: 0.6, latencyTarget: { metric: 'completion', ms: 30_000 }, onNoBid: 'fail' },
  { ...basePolicy, id: 'deep-read', label: 'Quality', mode: 'weighted', weights: { quality: 75, cost: 10, latency: 15 }, minQuality: 0.65, latencyTarget: { metric: 'completion', ms: 60_000 }, onNoBid: 'fail' },
  { ...basePolicy, id: 'design-proto', label: 'Quality', mode: 'weighted', weights: { quality: 70, cost: 15, latency: 15 }, minQuality: 0.6, latencyTarget: { metric: 'completion', ms: 45_000 }, onNoBid: 'fallback' },
  { ...basePolicy, id: 'cheapest-qualified', label: 'Lowest cost', mode: 'cheapest-qualified', weights: { quality: 0, cost: 100, latency: 0 }, minQuality: 0.6, latencyTarget: { metric: 'completion', ms: 30_000 }, onNoBid: 'fail' },
];

export const scenarios: Scenario[] = [
  {
    id: 'support-triage', name: 'Support triage', summary: 'Categorize a ticket and draft a reply',
    prompt: 'Categorize this customer ticket and draft a concise reply:\n“I was charged twice for my March invoice and can’t find a refund option in settings.”',
    attachments: ['ticket #[ID]'], defaultPolicyId: 'fast-support', outputKind: 'text',
    evidenceNote: 'Instruction-following scores are routing proxies, not a support-quality measurement.',
  },
  {
    id: 'invoice-extraction', name: 'Invoice extraction', summary: 'Invoice text into a JSON schema',
    prompt: 'Convert the attached invoice text into the InvoiceV2 JSON schema: vendor, invoice date, line items, tax, total.',
    attachments: ['invoice-sample.txt', 'schema: InvoiceV2'], defaultPolicyId: 'strict-extraction', outputKind: 'json',
    evidenceNote: 'Models without extraction evidence are excluded, not assumed.',
  },
  {
    id: 'code-debugging', name: 'Code debugging', summary: 'Diagnose a failing function, propose a patch',
    prompt: 'parseDuration("1h30m") returns 90 instead of 5400.\nDiagnose the failing function and propose a patch.',
    attachments: ['duration.ts', 'duration.test.ts'], defaultPolicyId: 'quality-first', outputKind: 'text',
    evidenceNote: 'A self-hosted quantized model only has proxy evidence, so it was excluded.',
  },
  {
    id: 'research-synthesis', name: 'Research synthesis', summary: 'Compare documents and cite disagreements',
    prompt: 'Compare the three attached reports and cite every point where they disagree. Use the bundled citation IDs.',
    attachments: ['[DOC-A]', '[DOC-B]', '[DOC-C]'], defaultPolicyId: 'deep-read', outputKind: 'text',
    evidenceNote: 'Models below the estimated context need are filtered out first.',
  },
  {
    id: 'ui-design', name: 'UI design & prototyping', summary: 'Product brief to a responsive landing page',
    prompt: 'Turn this product brief into a responsive landing page. Standalone HTML/CSS only.',
    attachments: ['brief.md'], defaultPolicyId: 'design-proto', outputKind: 'html',
    evidenceNote: 'No aesthetic benchmark exists; coding scores are labeled as proxies.',
  },
];

const noCost = {
  simulatedQuoteUsd: null, estimatedUpstreamUsd: null, usageDerivedUpstreamUsd: null,
  actualBillingUsd: null, runBudgetUsd: null, runBudgetUsedUsd: null,
};

const sampleOutput: Record<ScenarioId, Pick<RunSummary, 'winner' | 'bidCount' | 'output'>> = {
  'support-triage': {
    winner: { model: 'gpt-mini', provider: 'OpenAI' }, bidCount: 4,
    output: 'Category: Billing › Duplicate charge   Priority: High\n\nHi [Name], thanks for flagging this — I can see two charges for your March invoice. I’ve opened a refund for the duplicate…',
  },
  'invoice-extraction': {
    winner: { model: 'gemini-pro', provider: 'Google' }, bidCount: 3,
    output: '{\n  "vendor": "[Vendor name]",\n  "invoiceDate": "[YYYY-MM-DD]",\n  "lineItems": [{ "description": "[Item]", "quantity": 2, "unitPrice": "[0.00]" }],\n  "tax": "[0.00]",\n  "total": "[0.00]"\n}',
  },
  'code-debugging': {
    winner: { model: 'gemini-pro', provider: 'Google' }, bidCount: 3,
    output: 'Diagnosis: the unit table maps "h" to 60 instead of 3600, so hours are converted as minutes.\n\n- const UNITS = { h: 60, m: 60, s: 1 };\n+ const UNITS = { h: 3600, m: 60, s: 1 };\n\nAdd a regression test for "1h30m" → 5400 and "2h" → 7200…',
  },
  'research-synthesis': {
    winner: { model: 'claude-sonnet', provider: 'Anthropic' }, bidCount: 3,
    output: 'Disagreement 1 — [topic]: [DOC-A §2] states [claim], while [DOC-C §4] reports [contrary claim].\n\nDisagreement 2 — [topic]: [DOC-B §1] and [DOC-A §5] differ on [measure]…',
  },
  'ui-design': {
    winner: { model: 'claude-sonnet', provider: 'Anthropic' }, bidCount: 4,
    output: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui;margin:0;background:#fffdf8;color:#17191e}nav,main{max-width:960px;margin:auto;padding:24px}nav{display:flex;justify-content:space-between}h1{font-size:clamp(28px,5vw,48px);margin:0 0 12px}a.cta{display:inline-block;padding:10px 18px;background:#17191e;color:#fff;border-radius:6px;text-decoration:none}</style></head><body><nav><b>[Product name]</b><span>Features · Pricing · Sign in</span></nav><main><h1>[Headline from the product brief]</h1><p>[Supporting line from the brief]</p><a class="cta" href="#">Primary CTA</a></main></body></html>',
  },
};

export function fixtureRun(scenarioId: ScenarioId, policyId: string): RunSummary {
  const scenario = scenarios.find((s) => s.id === scenarioId)!;
  const isTraced = scenarioId === 'code-debugging';
  return {
    runId: isTraced ? 'demo-code-debugging' : `demo-${scenarioId}`,
    scenarioId,
    policyId,
    ...sampleOutput[scenarioId],
    timing: { classificationMs: 412, selectionMs: 38, auctionMs: 300, firstTokenMs: 1_900, totalMs: 14_200 },
    usage: isTraced ? { inputTokens: 6_100, outputTokens: 1_200 } : null,
    cost: noCost,
    outputKind: scenario.outputKind,
    illustrative: true,
  };
}

export const demoTrace: TraceView = {
  run: fixtureRun('code-debugging', 'quality-first'),
  scenarioName: 'Code debugging',
  policy: policies.find((p) => p.id === 'quality-first')!,
  assessment: {
    taskFamilyLabel: 'Code debugging',
    complexity: 'high',
    confidence: 0.86,
    confidenceThreshold: 0.7,
    requirements: ['multi-step reasoning', 'patch output'],
    extracted: { toolSchemas: 1, images: 0, outputFormat: 'text', inputTokensEstimate: 6_100, outputTokenCap: 1_500 },
  },
  pool: {
    consideredCount: 7,
    invitedCount: 4,
    excluded: [
      { model: 'qwen-coder-q4', deployment: 'operator vLLM', reason: 'Quantized build; its benchmark scores are inherited from full-precision weights, so they count only as a proxy', remedy: 'Turn on “allow missing coverage” — joins with an uncertainty penalty' },
      { model: 'small-flash', deployment: 'Google', reason: 'Coding quality 0.51, below the policy minimum of 0.60', remedy: 'Lower the minimum quality in the policy' },
      { model: 'legacy-chat', deployment: 'OpenAI-compatible', reason: 'Endpoint probe found no tool-call support; this request declares a tool', remedy: null },
    ],
  },
  auction: {
    deadlineMs: 300,
    bids: [
      { deploymentId: 'dep-openai-mini', model: 'gpt-mini', provider: 'OpenAI', arrivedMs: 84, inputUsdPerMtok: null, outputUsdPerMtok: null, strategy: 'fixed', declaredQueueMs: null, status: 'valid', utilities: { quality: 0.74, cost: 0.9, latency: 0.4, penalty: 0 } },
      { deploymentId: 'dep-anthropic-sonnet', model: 'claude-sonnet', provider: 'Anthropic', arrivedMs: 142, inputUsdPerMtok: null, outputUsdPerMtok: null, strategy: 'capacity-adjusted', declaredQueueMs: null, status: 'valid', utilities: { quality: 0.82, cost: 0.55, latency: 0.6, penalty: 0 } },
      { deploymentId: 'dep-google-pro', model: 'gemini-pro', provider: 'Google', arrivedMs: 205, inputUsdPerMtok: null, outputUsdPerMtok: null, strategy: 'bounded-discount', declaredQueueMs: null, status: 'awarded', utilities: { quality: 0.78, cost: 0.8, latency: 0.7, penalty: 0 } },
      { deploymentId: 'dep-hosted-opencoder', model: 'open-coder', provider: 'Hosted open-model', arrivedMs: 341, inputUsdPerMtok: null, outputUsdPerMtok: null, strategy: 'fixed', declaredQueueMs: null, status: 'rejected', rejectReason: 'arrived after deadline' },
    ],
  },
  versions: {
    catalogSnapshotId: '[cs-id]',
    catalogRefreshedAt: null,
    jevModelVersion: '[pinned version]',
    assessmentSchemaVersion: 'v2',
    benchmarkProfile: 'coding-v4',
    idempotencyKey: '[key]',
  },
  auctionStates: ['created', 'bidding', 'awarded', 'executing', 'completed'],
  fallback: null,
  storedContent: 'metadata',
};

// ---- Provider console fixtures (operator-entered demo config, not vendor pricing) ----

const allFeatures: FeatureSet = { streaming: true, tools: true, 'structured-output': true, images: true };
const auction = (arrivedMs: number, outcome: ProviderAuction['outcome']): ProviderAuction => ({
  auctionId: 'auc-[id]', at: null, arrivedMs, quotedInputUsdPerMtok: null, quotedOutputUsdPerMtok: null, outcome,
});

export const providerDeployments: ProviderDeployment[] = [
  {
    offeringId: 'off-google-pro', model: 'gemini-pro', modelVersion: '[model version]', kind: 'google', hostLabel: 'Google API',
    endpoint: null, secretRef: 'secret://providers/google', contextTokens: null, outputTokens: null,
    status: 'connected', lastCheckedAt: null, features: allFeatures, available: true, inFlight: 3,
    bidPolicy: { strategy: 'bounded-discount', inputUsdPerMtok: 1, outputUsdPerMtok: 5, floorInputUsdPerMtok: 0.8, floorOutputUsdPerMtok: 4, maxDiscountPct: 20, surchargeAtFullPct: 30, capacity: 8, simulatedDelayMs: 40 },
    recentAuctions: [auction(205, 'won'), auction(188, 'lost'), auction(212, 'won'), auction(317, 'late'), auction(196, 'won')],
  },
  {
    offeringId: 'off-anthropic-sonnet', model: 'claude-sonnet', modelVersion: '[model version]', kind: 'anthropic', hostLabel: 'Anthropic API',
    endpoint: null, secretRef: 'secret://providers/anthropic', contextTokens: null, outputTokens: null,
    status: 'connected', lastCheckedAt: null, features: allFeatures, available: true, inFlight: 4,
    bidPolicy: { strategy: 'capacity-adjusted', inputUsdPerMtok: 2, outputUsdPerMtok: 10, floorInputUsdPerMtok: 2, floorOutputUsdPerMtok: 10, maxDiscountPct: 10, surchargeAtFullPct: 30, capacity: 6, simulatedDelayMs: 60 },
    recentAuctions: [auction(142, 'lost'), auction(150, 'won'), auction(139, 'won'), auction(161, 'lost')],
  },
  {
    offeringId: 'off-hosted-opencoder', model: 'open-coder', modelVersion: '[model version]', kind: 'hosted-open', hostLabel: 'Hosted open-model',
    endpoint: 'https://inference.example.com/v1', secretRef: 'secret://providers/hosted', contextTokens: null, outputTokens: null,
    status: 'degraded', lastCheckedAt: null, features: { ...allFeatures, tools: false, images: false }, available: true, inFlight: 1,
    bidPolicy: { strategy: 'fixed', inputUsdPerMtok: 0.5, outputUsdPerMtok: 1.5, floorInputUsdPerMtok: 0.5, floorOutputUsdPerMtok: 1.5, maxDiscountPct: 10, surchargeAtFullPct: 20, capacity: 4, simulatedDelayMs: 180 },
    recentAuctions: [auction(341, 'late'), auction(290, 'lost'), auction(305, 'late')],
  },
  {
    offeringId: 'off-local-qwen', model: 'qwen-coder-q4', modelVersion: '[model version] · 4-bit', kind: 'openai-compatible', hostLabel: 'Mock vLLM',
    endpoint: 'https://qwen.example.com/v1', secretRef: 'secret://providers/mock-vllm', contextTokens: null, outputTokens: null,
    status: 'connected', lastCheckedAt: null, features: { streaming: true, tools: true, 'structured-output': true, images: false }, available: true, inFlight: 0,
    bidPolicy: { strategy: 'fixed', inputUsdPerMtok: 0.2, outputUsdPerMtok: 0.6, floorInputUsdPerMtok: 0.2, floorOutputUsdPerMtok: 0.6, maxDiscountPct: 10, surchargeAtFullPct: 20, capacity: 2, simulatedDelayMs: 0 },
    recentAuctions: [],
  },
];
