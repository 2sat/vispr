import { BidSchema, InvitationSchema, type Bid, type Invitation } from '@vispr/contracts';
export type BidValidation = { accepted: true; bid: Bid } | { accepted: false; reason: string };
export function validateBid(raw: unknown, invitation: Invitation, receivedAt: number): BidValidation {
  const invite = InvitationSchema.parse(invitation);
  const parsed = BidSchema.safeParse(raw);
  if (!parsed.success) return { accepted: false, reason: 'Malformed bid' };
  const bid = parsed.data;
  if (!Number.isFinite(receivedAt) || !Number.isFinite(new Date(receivedAt).getTime())) return { accepted: false, reason: 'Invalid server receipt time' };
  if (bid.auctionId !== invite.auctionId) return { accepted: false, reason: 'Wrong auction' };
  if (!invite.offeringIds.includes(bid.deploymentId)) return { accepted: false, reason: 'Deployment was not invited' };
  if (receivedAt >= Date.parse(invite.deadline)) return { accepted: false, reason: 'Auction deadline passed' };
  if (Date.parse(bid.validUntil) <= receivedAt) return { accepted: false, reason: 'Bid expired' };
  // Participant timestamps cannot make a late bid timely. Replace with the
  // trusted server timestamp for the persisted bid and trace.
  return { accepted: true, bid: { ...bid, receivedAt: new Date(receivedAt).toISOString() } };
}
export interface RankedBid { bid: Bid; utility: number; estimatedLatencyMs: number }
export function rankBids(bids: readonly RankedBid[]): RankedBid[] {
  for (const entry of bids) BidSchema.parse(entry.bid);
  if (new Set(bids.map(entry => entry.bid.auctionId)).size > 1) throw new Error('Cannot rank bids from different auctions');
  if (bids.some(b => !Number.isFinite(b.utility) || !Number.isFinite(b.estimatedLatencyMs) || b.estimatedLatencyMs < 0)) throw new Error('Invalid bid scoring');
  if (new Set(bids.map(b => b.bid.id)).size !== bids.length || new Set(bids.map(b => b.bid.deploymentId)).size !== bids.length) throw new Error('Duplicate bid or deployment');
  return [...bids].sort((a, b) => b.utility - a.utility || a.estimatedLatencyMs - b.estimatedLatencyMs || (a.bid.deploymentId < b.bid.deploymentId ? -1 : a.bid.deploymentId > b.bid.deploymentId ? 1 : 0));
}
