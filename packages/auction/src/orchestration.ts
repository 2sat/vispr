import { BidSchema, InvitationSchema, type Bid, type Invitation } from '@vispr/contracts';
import type { Bidder } from './index';
import { rankBids, validateBid, type RankedBid } from './validation';
export interface RegisteredBidder { participantId: string; deploymentId: string; bidder: Bidder }
export interface BidEvaluation { eligible: boolean; reason?: string; utility: number; estimatedLatencyMs: number }
export interface AuctionResult {
  ranked: RankedBid[];
  rejected: { participantId: string; deploymentId: string; reason: string }[];
  durationMs: number;
}
export interface AuctionInput {
  auctionId: string;
  deadline: number;
  registrations: readonly RegisteredBidder[];
  visibility: 'dark' | 'workload';
  workload?: { inputTokenBucket: number; outputTokenBucket: number; estimatedDurationMs?: number };
  signal: AbortSignal;
  now?: () => number;
  evaluate(bid: Bid): BidEvaluation;
}
export async function collectAuction(input: AuctionInput): Promise<AuctionResult> {
  const now = input.now ?? Date.now, started = now();
  if (!Number.isFinite(input.deadline) || !Number.isFinite(new Date(input.deadline).getTime()) || input.deadline <= started || input.deadline - started > 10000) throw new Error('Auction deadline must be within the next 10 seconds');
  if (input.signal.aborted) throw input.signal.reason;
  if (new Set(input.registrations.map(r => r.deploymentId)).size !== input.registrations.length || input.registrations.some(r => !r.participantId.trim() || !r.deploymentId.trim())) throw new Error('Registrations require unique authorized deployments');
  const controller = new AbortController();
  const signal = AbortSignal.any([input.signal, controller.signal]);
  const timeout = setTimeout(() => controller.abort(new Error('Auction deadline passed')), input.deadline - started);
  const accepted: { registration: RegisteredBidder; bid: Bid }[] = [];
  const rejected: AuctionResult['rejected'] = [];
  try {
    await Promise.all(input.registrations.map(async registration => {
      const invitation = InvitationSchema.parse({ auctionId: input.auctionId, offeringIds: [registration.deploymentId], deadline: new Date(input.deadline).toISOString(), protocolVersion: '0.1.0', visibility: input.visibility, ...(input.visibility === 'workload' ? { workload: input.workload } : {}) });
      // Race even a misbehaving adapter that ignores abort. Late results cannot
      // append to accepted bids after this awaited wrapper has completed.
      const outcome = await new Promise<{ bid?: Bid | null; failure?: string }>(resolve => {
        const onAbort = () => { signal.removeEventListener('abort', onAbort); resolve({ failure: 'Bidder deadline or cancellation' }); };
        Promise.resolve().then(() => signal.aborted ? null : registration.bidder.bid(structuredClone(invitation), signal)).then(bid => { signal.removeEventListener('abort', onAbort); resolve({ bid }); }, () => { signal.removeEventListener('abort', onAbort); resolve({ failure: 'Bidder failed' }); });
        if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
      });
      let reason = outcome.failure;
      if (!reason && !outcome.bid) reason = 'Bidder abstained';
      if (!reason && outcome.bid) {
        const validated = validateBid(outcome.bid, invitation, now());
        if (validated.accepted) accepted.push({ registration, bid: validated.bid });
        else reason = validated.reason;
      }
      if (reason) rejected.push({ participantId: registration.participantId, deploymentId: registration.deploymentId, reason });
    }));
    if (input.signal.aborted) throw input.signal.reason;
    const evaluated: RankedBid[] = [];
    for (const { registration, bid } of accepted) {
      let reason: string | undefined;
      if (Date.parse(bid.validUntil) <= now()) reason = 'Bid expired before ranking';
      else {
        const evaluation = input.evaluate(bid);
        if (evaluation.eligible) evaluated.push({ bid, utility: evaluation.utility, estimatedLatencyMs: evaluation.estimatedLatencyMs });
        else reason = evaluation.reason ?? 'Offer violates current policy';
      }
      if (reason) rejected.push({ participantId: registration.participantId, deploymentId: registration.deploymentId, reason });
    }
    return { ranked: rankBids(evaluated), rejected: rejected.sort((a, b) => a.deploymentId < b.deploymentId ? -1 : a.deploymentId > b.deploymentId ? 1 : 0), durationMs: now() - started };
  } finally { clearTimeout(timeout); controller.abort(); }
}
export interface SimulatedBidderOptions {
  deploymentId: string;
  strategy: 'fixed' | 'capacity' | 'discount';
  inputRate: number;
  outputRate: number;
  inputFloor: number;
  outputFloor: number;
  capacity: number;
  active: number;
  discountFraction?: number;
  premiumFraction?: number;
  delayMs?: number;
  validityMs?: number;
  queueMs: number;
  tokensPerSecond: number;
  now?: () => number;
}
export function createSimulatedBidder(options: SimulatedBidderOptions): Bidder {
  for (const n of [options.inputRate, options.outputRate, options.inputFloor, options.outputFloor, options.capacity, options.active, options.delayMs ?? 0, options.validityMs ?? 30000, options.queueMs]) if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid simulated bid configuration');
  if (!options.deploymentId.trim() || options.active > options.capacity || (options.validityMs ?? 30000) === 0 || !Number.isFinite(options.tokensPerSecond) || options.tokensPerSecond <= 0) throw new Error('Invalid simulated bid configuration');
  for (const fraction of [options.discountFraction ?? .1, options.premiumFraction ?? .5]) if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) throw new Error('Invalid strategy fraction');
  return {
    async bid(raw: Invitation, signal: AbortSignal): Promise<Bid | null> {
      const invitation = InvitationSchema.parse(raw), now = options.now ?? Date.now;
      if (signal.aborted || now() >= Date.parse(invitation.deadline) || !invitation.offeringIds.includes(options.deploymentId) || options.active >= options.capacity) return null;
      if (options.delayMs) await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, options.delayMs);
        if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
      });
      if (signal.aborted || now() >= Date.parse(invitation.deadline)) return null;
      const factor = options.strategy === 'discount' ? 1 - (options.discountFraction ?? .1) : options.strategy === 'capacity' ? 1 + (options.active / options.capacity) * (options.premiumFraction ?? .5) : 1;
      const receivedAt = now();
      return BidSchema.parse({ id: `simulated:${invitation.auctionId}:${options.deploymentId}`, auctionId: invitation.auctionId, deploymentId: options.deploymentId, simulated: true, inputMicrosPerMillionTokens: Math.max(options.inputFloor, Math.ceil(options.inputRate * factor)), outputMicrosPerMillionTokens: Math.max(options.outputFloor, Math.ceil(options.outputRate * factor)), queueMs: options.queueMs, tokensPerSecond: options.tokensPerSecond, receivedAt: new Date(receivedAt).toISOString(), validUntil: new Date(receivedAt + (options.validityMs ?? 30000)).toISOString(), reservationToken: `simulated-only:${invitation.auctionId}:${options.deploymentId}` });
    },
  };
}
