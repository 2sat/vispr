import type { Award, Bid, Invitation } from '@vispr/contracts';
export interface Bidder { bid(invitation: Invitation, signal: AbortSignal): Promise<Bid | null> }
// Award/capacity persistence is owned by the platform stream, never by a bidder.
export interface AwardRepository { awardOnce(award: Award): Promise<{ awarded: boolean; existing: Award }> }
