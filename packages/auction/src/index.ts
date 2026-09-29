import type { Award, Bid, Invitation } from '@vispr/contracts';
export interface Bidder { bid(invitation: Invitation, signal: AbortSignal): Promise<Bid | null> }
// Award/capacity persistence is owned by the platform stream, never by a bidder.
export interface AwardRepository { awardOnce(award: Award): Promise<{ awarded: boolean; existing: Award }> }
export { validateBid, rankBids } from './validation';
export type { BidValidation, RankedBid } from './validation';
export { collectAuction, createSimulatedBidder } from './orchestration';
export type { AuctionInput, AuctionResult, RegisteredBidder, BidEvaluation, SimulatedBidderOptions } from './orchestration';
