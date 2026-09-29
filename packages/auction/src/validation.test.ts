import { describe, expect, it } from 'vitest';
import type { Bid, Invitation } from '@vispr/contracts';
import { rankBids, validateBid } from './validation';
const receivedAt = Date.parse('2026-09-29T20:00:00Z');
const invitation: Invitation = { auctionId: 'a', offeringIds: ['d'], protocolVersion: '0.1.0', visibility: 'dark', deadline: '2026-09-29T20:00:01Z' };
const bid: Bid = { id: 'b', auctionId: 'a', deploymentId: 'd', simulated: true, inputMicrosPerMillionTokens: 100, outputMicrosPerMillionTokens: 200, queueMs: 10, tokensPerSecond: 50, receivedAt: '2026-09-29T19:59:59Z', validUntil: '2026-09-29T20:00:02Z', reservationToken: 'r' };
describe('auction boundaries', () => {
  it('uses the server receipt time rather than participant claims', () => {
    const accepted = validateBid(bid, invitation, receivedAt);
    expect(accepted.accepted).toBe(true);
    if (accepted.accepted) expect(accepted.bid.receivedAt).toBe(new Date(receivedAt).toISOString());
    expect(validateBid(bid, invitation, receivedAt + 1000)).toEqual({ accepted: false, reason: 'Auction deadline passed' });
  });
  it('rejects wrong auctions, uninvited offerings, expired and malformed bids', () => {
    expect(validateBid({ ...bid, auctionId: 'other' }, invitation, receivedAt).accepted).toBe(false);
    expect(validateBid({ ...bid, deploymentId: 'other' }, invitation, receivedAt).accepted).toBe(false);
    expect(validateBid({ ...bid, validUntil: new Date(receivedAt).toISOString() }, invitation, receivedAt).accepted).toBe(false);
    expect(validateBid({ ...bid, queueMs: -1 }, invitation, receivedAt).accepted).toBe(false);
  });
  it('breaks equal-utility ties by latency and stable deployment ID', () => {
    const bids = [{ bid, utility: .8, estimatedLatencyMs: 100 }, { bid: { ...bid, id: 'c', deploymentId: 'c' }, utility: .8, estimatedLatencyMs: 100 }];
    expect(rankBids(bids)[0]!.bid.deploymentId).toBe('c');
    expect(rankBids([{ ...bids[0]!, estimatedLatencyMs: 50 }, bids[1]!])[0]!.bid.deploymentId).toBe('d');
    expect(bids[0]!.bid.deploymentId).toBe('d');
    expect(() => rankBids([bids[0]!, bids[0]!])).toThrow('Duplicate');
  });
});

describe('pre-push auction boundaries', () => {
  it('accepts the last millisecond before deadline, but rejects expiry at receipt', () => {
    expect(validateBid(bid, invitation, receivedAt + 999).accepted).toBe(true);
    expect(validateBid({ ...bid, validUntil: new Date(receivedAt).toISOString() }, invitation, receivedAt).accepted).toBe(false);
    expect(validateBid(bid, invitation, 1e100)).toEqual({ accepted: false, reason: 'Invalid server receipt time' });
  });
  it('does not rank bids across auction identities', () => {
    expect(() => rankBids([
      { bid, utility: .8, estimatedLatencyMs: 10 },
      { bid: { ...bid, id: 'other', deploymentId: 'other', auctionId: 'other' }, utility: .9, estimatedLatencyMs: 5 },
    ])).toThrow('different auctions');
    expect(() => rankBids([{ bid, utility: NaN, estimatedLatencyMs: 10 }])).toThrow('Invalid bid scoring');
  });
});
