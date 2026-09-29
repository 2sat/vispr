import { z } from 'zod';

export const CONTRACT_VERSION = '0.1.0' as const;
const id = z.string().min(1).max(200);
export const MoneyMicros = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const Weights = z.strictObject({ quality: z.number().min(0).max(1), cost: z.number().min(0).max(1), latency: z.number().min(0).max(1) })
  .refine(w => Math.abs(w.quality + w.cost + w.latency - 1) < 1e-9, 'Weights must sum to 1');
export const PolicySchema = z.strictObject({
  id, version: z.number().int().positive(), weights: Weights,
  requestBudgetMicros: MoneyMicros.positive(), dailyBudgetMicros: MoneyMicros.positive(),
  maxOutputTokens: z.number().int().positive(), maxLatencyMs: z.number().positive(),
  minimumQuality: z.number().min(0).max(1), allowIncompleteCoverage: z.boolean(),
  uncertaintyPenalty: z.number().min(0).max(1), maxCandidates: z.number().int().min(1).max(100),
  auctionDeadlineMs: z.number().int().min(1).max(10000),
  bidVisibility: z.enum(['dark', 'workload']), continuity: z.enum(['auto', 'fresh', 'retain']),
  retainPayloads: z.boolean(),
}).refine(p => p.requestBudgetMicros <= p.dailyBudgetMicros, 'Request budget exceeds daily budget');
export type Policy = z.infer<typeof PolicySchema>;

export const CapabilitySchema = z.strictObject({
  tools: z.boolean(), structuredOutput: z.boolean(), vision: z.boolean(), streaming: z.boolean(),
  contextTokens: z.number().int().positive(), maxOutputTokens: z.number().int().positive(),
});
export const DeploymentSchema = z.strictObject({
  id, modelId: id, providerId: id, transport: z.enum(['openrouter', 'direct']),
  inferenceModelId: id, providerSlug: id.optional(), status: z.enum(['pending', 'active', 'disabled']),
  capabilities: CapabilitySchema,
}).refine(d => d.transport !== 'openrouter' || Boolean(d.providerSlug), 'OpenRouter offerings require a pinned provider');
export type Deployment = z.infer<typeof DeploymentSchema>;
export const BenchmarkObservationSchema = z.strictObject({
  modelId: id, benchmark: id, benchmarkVersion: id, value: z.number().finite(),
  sourceUrl: z.url(), retrievedAt: z.iso.datetime(), evidence: z.enum(['measured', 'proxy']),
});
export const CatalogSnapshotSchema = z.strictObject({
  id, createdAt: z.iso.datetime(), deployments: z.array(DeploymentSchema), benchmarks: z.array(BenchmarkObservationSchema),
});
export type CatalogSnapshot = z.infer<typeof CatalogSnapshotSchema>;

const ToolCall = z.strictObject({ id, name: id, arguments: z.string() });
const Content = z.array(z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text'), text: z.string() }),
  z.strictObject({ type: z.literal('image_url'), url: z.url() }),
])).min(1);
export const MessageSchema = z.discriminatedUnion('role', [
  z.strictObject({ role: z.literal('system'), content: z.string() }),
  z.strictObject({ role: z.literal('user'), content: z.union([z.string(), Content]) }),
  z.strictObject({ role: z.literal('assistant'), content: z.string(), toolCalls: z.array(ToolCall).optional() }),
  z.strictObject({ role: z.literal('tool'), content: z.string(), toolCallId: id }),
]);
export const InferenceRequestSchema = z.strictObject({
  policyId: id, sessionId: id.optional(), idempotencyKey: id,
  messages: z.array(MessageSchema).min(1), maxOutputTokens: z.number().int().positive(),
  tools: z.array(z.strictObject({ name: id, description: z.string(), parameters: z.record(z.string(), z.unknown()) })).optional(),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
});
export type InferenceRequest = z.infer<typeof InferenceRequestSchema>;
export const AssessmentSchema = z.strictObject({
  task: z.enum(['support', 'extraction', 'coding', 'research', 'design', 'other']),
  complexity: z.enum(['low', 'medium', 'high']), confidence: z.number().min(0).max(1),
  continuity: z.enum(['fresh', 'retain', 'tool_cycle']), continuityConfidence: z.number().min(0).max(1),
  modelVersion: id, questionVersion: id,
});
export type Assessment = z.infer<typeof AssessmentSchema>;
export const CandidateSchema = z.strictObject({ deploymentId: id, eligible: z.boolean(), reasons: z.array(z.string()), quality: z.number().min(0).max(1).nullable(), estimatedCostMicros: MoneyMicros.nullable(), estimatedLatencyMs: z.number().nonnegative().nullable() });
export type Candidate = z.infer<typeof CandidateSchema>;

const InvitationBase = { auctionId: id, offeringIds: z.array(id).min(1), deadline: z.iso.datetime(), protocolVersion: z.literal(CONTRACT_VERSION) };
export const InvitationSchema = z.discriminatedUnion('visibility', [
  z.strictObject({ ...InvitationBase, visibility: z.literal('dark') }),
  z.strictObject({ ...InvitationBase, visibility: z.literal('workload'), workload: z.strictObject({ inputTokenBucket: z.number().int().nonnegative(), outputTokenBucket: z.number().int().nonnegative(), estimatedDurationMs: z.number().nonnegative().optional() }) }),
]);
export type Invitation = z.infer<typeof InvitationSchema>;
export const BidSchema = z.strictObject({
  id, auctionId: id, deploymentId: id, simulated: z.literal(true),
  inputMicrosPerMillionTokens: MoneyMicros, outputMicrosPerMillionTokens: MoneyMicros,
  queueMs: z.number().nonnegative(), tokensPerSecond: z.number().positive(),
  receivedAt: z.iso.datetime(), validUntil: z.iso.datetime(), reservationToken: id,
}).refine(b => Date.parse(b.validUntil) > Date.parse(b.receivedAt), 'Bid must be valid when received');
export type Bid = z.infer<typeof BidSchema>;
export const AwardSchema = z.strictObject({ auctionId: id, bidId: id, deploymentId: id, policyVersion: z.number().int().positive(), catalogSnapshotId: id });
export type Award = z.infer<typeof AwardSchema>;
export const UsageSchema = z.strictObject({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(), actualCostMicros: MoneyMicros.nullable(), generationId: id.optional(), reconciliation: z.enum(['pending', 'settled']) })
  .refine(u => u.reconciliation !== 'settled' || u.actualCostMicros !== null, 'Settled usage requires known cost');
export type Usage = z.infer<typeof UsageSchema>;
export const ErrorCodeSchema = z.enum(['UNAUTHORIZED', 'INVALID_REQUEST', 'BUDGET_EXCEEDED', 'CLASSIFIER_UNAVAILABLE', 'NO_ELIGIBLE_MODELS', 'NO_BIDS', 'PROVIDER_FAILED', 'CANCELLED', 'NOT_CONFIGURED']);
const EventBase = { requestId: id, sequence: z.number().int().nonnegative() };
export const TraceEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...EventBase, type: z.literal('assessment'), assessment: AssessmentSchema }),
  z.strictObject({ ...EventBase, type: z.literal('candidates'), candidates: z.array(CandidateSchema) }),
  z.strictObject({ ...EventBase, type: z.literal('bid'), bid: BidSchema }),
  z.strictObject({ ...EventBase, type: z.literal('award'), award: AwardSchema }),
  z.strictObject({ ...EventBase, type: z.literal('continuity'), deploymentId: id, reason: z.string() }),
  z.strictObject({ ...EventBase, type: z.literal('text_delta'), text: z.string() }),
  z.strictObject({ ...EventBase, type: z.literal('tool_delta'), toolCallId: id, name: z.string().optional(), argumentsDelta: z.string() }),
  z.strictObject({ ...EventBase, type: z.literal('usage'), usage: UsageSchema }),
  z.strictObject({ ...EventBase, type: z.literal('completed') }),
  z.strictObject({ ...EventBase, type: z.literal('error'), code: ErrorCodeSchema, message: z.string(), partial: z.boolean() }),
]);
export type TraceEvent = z.infer<typeof TraceEventSchema>;
