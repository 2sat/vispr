import { describe, expect, it, vi } from 'vitest';
import type { Bid, Invitation } from '@vispr/contracts';
import { collectAuction, createSimulatedBidder, type AuctionInput, type SimulatedBidderOptions } from './orchestration';
const config: SimulatedBidderOptions = { deploymentId: 'd', strategy: 'fixed', inputRate: 100, outputRate: 200, inputFloor: 90, outputFloor: 180, capacity: 10, active: 0, queueMs: 10, tokensPerSecond: 50 };
const invitation = (): Invitation => ({ auctionId: 'a', offeringIds: ['d'], protocolVersion: '0.1.0', visibility: 'dark', deadline: new Date(Date.now() + 1000).toISOString() });
const input = (): AuctionInput => ({ auctionId: 'a', deadline: Date.now() + 100, registrations: [{ participantId: 'p', deploymentId: 'd', bidder: createSimulatedBidder(config) }], visibility: 'dark', signal: new AbortController().signal, evaluate: () => ({ eligible: true, utility: .8, estimatedLatencyMs: 100 }) });
describe('simulated strategies', () => {
  it('supports fixed, discounted and capacity-adjusted prices with floors', async () => {
    const bid = (options: Partial<SimulatedBidderOptions>) => createSimulatedBidder({ ...config, ...options }).bid(invitation(), new AbortController().signal);
    expect((await bid({}))!.inputMicrosPerMillionTokens).toBe(100);
    expect((await bid({ strategy: 'discount', discountFraction: .5 }))!.inputMicrosPerMillionTokens).toBe(90);
    expect((await bid({ strategy: 'capacity', active: 8, premiumFraction: .5 }))!.inputMicrosPerMillionTokens).toBe(140);
    expect((await bid({}))!.reservationToken).toMatch(/^simulated-only:/);
  });
  it('abstains at capacity and respects abort/deadline', async () => {
    expect(await createSimulatedBidder({ ...config, active: 10 }).bid(invitation(), new AbortController().signal)).toBeNull();
    const controller = new AbortController(); controller.abort();
    expect(await createSimulatedBidder(config).bid(invitation(), controller.signal)).toBeNull();
    expect(await createSimulatedBidder(config).bid({ ...invitation(), deadline: '2020-01-01T00:00:00Z' }, new AbortController().signal)).toBeNull();
  });
});
describe('bounded auction collection', () => {
  it('passes only dark invitation fields and evaluates returned bids', async () => {
    const request = input(); const observed = vi.spyOn(request.registrations[0]!.bidder, 'bid');
    const result = await collectAuction(request);
    expect(result.ranked).toHaveLength(1); expect(result.rejected).toEqual([]);
    expect(Object.keys(observed.mock.calls[0]![0]).sort()).toEqual(['auctionId', 'deadline', 'offeringIds', 'protocolVersion', 'visibility']);
  });
  it('runs bidders concurrently and ignores a hanging or late bidder', async () => {
    const request = input(); request.deadline = Date.now() + 15;
    let finish: ((bid: Bid | null) => void) | undefined;
    const hanging = { bid: vi.fn(() => new Promise<Bid | null>(resolve => { finish = resolve; })) };
    request.registrations = [...request.registrations, { participantId: 'late', deploymentId: 'late', bidder: hanging }];
    const result = await collectAuction(request);
    expect(result.ranked).toHaveLength(1); expect(result.rejected[0]!.reason).toContain('deadline');
    finish?.(null); await Promise.resolve(); expect(result.ranked).toHaveLength(1);
  });
  it('does not let a bidder mutate its invitation to authorize another offering', async () => {
    const request = input();
    request.registrations = [{ participantId: 'evil', deploymentId: 'd', bidder: { async bid(invite, signal) { invite.offeringIds.push('spoofed'); return createSimulatedBidder({ ...config, deploymentId: 'spoofed' }).bid(invite, signal); } } }];
    const result = await collectAuction(request);
    expect(result.ranked).toHaveLength(0); expect(result.rejected[0]!.reason).toBe('Deployment was not invited');
  });
  it('removes offers that fail refreshed budget checks or expire before ranking', async () => {
    const request = input(); request.evaluate = () => ({ eligible: false, reason: 'Budget exhausted', utility: 0, estimatedLatencyMs: 100 });
    expect((await collectAuction(request)).rejected[0]!.reason).toBe('Budget exhausted');
    const expires = input(); let time = Date.now(); expires.now = () => time; expires.deadline = time + 1000;
    expires.registrations = [{ participantId: 'p', deploymentId: 'd', bidder: { async bid(invite, signal) { const bid = await createSimulatedBidder({ ...config, validityMs: 1, now: () => time }).bid(invite, signal); return bid; } } }, { participantId: 'later', deploymentId: 'later', bidder: { async bid() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); time += 10; return null; } } }];
    const result = await collectAuction(expires);
    expect(result.ranked).toHaveLength(0); expect(result.rejected.some(r => /expired/i.test(r.reason))).toBe(true);
  });
  it('propagates caller cancellation and isolates bidder failures', async () => {
    const request = input(); request.registrations = [{ participantId: 'p', deploymentId: 'd', bidder: { bid: async () => { throw new Error('private error'); } } }];
    expect((await collectAuction(request)).rejected[0]!.reason).toBe('Bidder failed');
    const controller = new AbortController(); controller.abort(new Error('stop'));
    await expect(collectAuction({ ...input(), signal: controller.signal })).rejects.toThrow('stop');
  });
});
