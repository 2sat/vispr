import { describe, expect, it } from 'vitest';
import { BidSchema, DeploymentSchema, InvitationSchema, PolicySchema, UsageSchema } from './index';
import { demoPolicy, scenarios, sampleRequest, sampleEvents } from './fixtures';
describe('cross-workstream boundary invariants', () => {
  it('validates all scenario policies and request/event fixtures', () => {
    for (const scenario of scenarios) expect(PolicySchema.safeParse({ ...demoPolicy, weights: scenario.weights }).success).toBe(true);
    expect(sampleRequest.messages).toHaveLength(1); expect(sampleEvents).toHaveLength(1);
  });
  it('rejects invalid weights and conflicting spend limits', () => {
    expect(PolicySchema.safeParse({ ...demoPolicy, weights: { quality: .8, cost: .8, latency: .2 } }).success).toBe(false);
    expect(PolicySchema.safeParse({ ...demoPolicy, requestBudgetMicros: 20000000 }).success).toBe(false);
  });
  it('rejects prompt disclosure on a dark auction invitation', () => {
    const dark = { auctionId: 'a', offeringIds: ['d'], deadline: '2026-09-29T23:00:00Z', protocolVersion: '0.1.0', visibility: 'dark' };
    expect(InvitationSchema.safeParse(dark).success).toBe(true);
    expect(InvitationSchema.safeParse({ ...dark, prompt: 'private' }).success).toBe(false);
    expect(InvitationSchema.safeParse({ ...dark, workload: { inputTokenBucket: 10, outputTokenBucket: 10 } }).success).toBe(false);
  });
  it('requires provider pinning for hosted offerings', () => {
    const deployment = { id: 'd', modelId: 'm', providerId: 'p', inferenceModelId: 'model', transport: 'openrouter', status: 'active', capabilities: { tools: false, structuredOutput: false, vision: false, streaming: true, contextTokens: 8000, maxOutputTokens: 2000 } };
    expect(DeploymentSchema.safeParse(deployment).success).toBe(false);
    expect(DeploymentSchema.safeParse({ ...deployment, providerSlug: 'provider' }).success).toBe(true);
  });
  it('rejects expired-on-arrival bids and unknown settled costs', () => {
    expect(BidSchema.safeParse({ id:'b', auctionId:'a', deploymentId:'d', simulated:true, inputMicrosPerMillionTokens:100, outputMicrosPerMillionTokens:200, queueMs:0, tokensPerSecond:50, receivedAt:'2026-09-29T23:00:00Z', validUntil:'2026-09-29T22:00:00Z', reservationToken:'r' }).success).toBe(false);
    expect(UsageSchema.safeParse({ inputTokens: 10, outputTokens: 10, actualCostMicros: null, reconciliation: 'settled' }).success).toBe(false);
  });
});
