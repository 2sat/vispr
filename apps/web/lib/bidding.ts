import type { BidPolicy, BidQuote, ConnectionStatus, ProviderDeployment } from './types';

/**
 * What an adapter would quote on its next invitation. Shared by the provider
 * console preview and the simulated bidding adapters so both agree.
 * Floors always win.
 */
export function quoteBid(
  policy: BidPolicy,
  state: { available: boolean; status: ConnectionStatus; inFlight: number },
): BidQuote {
  if (!state.available) return { bids: false, reason: 'Paused — this offering won’t be invited.' };
  if (state.status === 'unreachable') return { bids: false, reason: 'Unreachable — no bids until a connection check passes.' };

  let multiplier = 1;
  let reason: string;
  switch (policy.strategy) {
    case 'fixed':
      reason = 'List rates on every invitation.';
      break;
    case 'bounded-discount':
      multiplier = 1 - clamp(policy.maxDiscountPct, 0, 50) / 100;
      reason = `${policy.maxDiscountPct}% off list rates.`;
      break;
    case 'capacity-adjusted': {
      const capacity = Math.max(1, policy.capacity);
      const utilization = Math.min(state.inFlight, capacity) / capacity;
      if (utilization >= 1) return { bids: false, reason: 'At capacity — sits out until a slot frees.' };
      multiplier = 1 + (clamp(policy.surchargeAtFullPct, 0, 100) / 100) * utilization;
      reason = `${Math.round(utilization * 100)}% of capacity in use → +${Math.round((multiplier - 1) * 100)}% on list rates.`;
      break;
    }
  }

  const rawIn = policy.inputUsdPerMtok * multiplier;
  const rawOut = policy.outputUsdPerMtok * multiplier;
  const inputUsdPerMtok = Math.max(policy.floorInputUsdPerMtok, rawIn);
  const outputUsdPerMtok = Math.max(policy.floorOutputUsdPerMtok, rawOut);
  const heldAtFloor = inputUsdPerMtok > rawIn || outputUsdPerMtok > rawOut;
  return { bids: true, inputUsdPerMtok, outputUsdPerMtok, heldAtFloor, reason: heldAtFloor ? `${reason} Held at your floor.` : reason };
}

export function validateBidPolicy(p: BidPolicy): string | null {
  const rates = [p.inputUsdPerMtok, p.outputUsdPerMtok, p.floorInputUsdPerMtok, p.floorOutputUsdPerMtok];
  if (rates.some((r) => !Number.isFinite(r) || r < 0)) return 'Rates and floors must be zero or more.';
  if (!Number.isInteger(p.capacity) || p.capacity < 1) return 'Capacity must be a whole number of at least 1.';
  if (p.maxDiscountPct < 0 || p.maxDiscountPct > 50) return 'Max discount must be between 0% and 50%.';
  if (p.surchargeAtFullPct < 0 || p.surchargeAtFullPct > 100) return 'Surcharge must be between 0% and 100%.';
  if (p.simulatedDelayMs < 0) return 'Simulated delay can’t be negative.';
  return null;
}

/** Plain-language warnings shown on the connection card. */
export function deploymentWarnings(d: ProviderDeployment, auctionDeadlineMs = 300): string[] {
  const out: string[] = [];
  if (d.status === 'unreachable' && d.endpoint && isLoopbackUrl(d.endpoint)) {
    out.push('This endpoint points at a loopback address. The hosted Vispr service can’t reach your machine — run Vispr locally, or expose an authenticated endpoint and update the URL.');
  } else if (d.status === 'unreachable') {
    out.push('The last connection check failed. This offering won’t be invited until a check passes.');
  }
  if (d.status === 'degraded' && !d.features.tools) {
    out.push('Tool calls were not detected on the last check, so requests that declare tools won’t be routed here.');
  }
  const late = d.recentAuctions.filter((a) => a.outcome === 'late').length;
  if (late > 0 && d.bidPolicy.simulatedDelayMs > auctionDeadlineMs / 2) {
    out.push(`${late} recent bid${late > 1 ? 's' : ''} missed the ${auctionDeadlineMs} ms deadline — lower the simulated delay to stay in time.`);
  }
  return out;
}

function isLoopbackUrl(raw: string): boolean {
  try {
    const h = new URL(raw).hostname;
    return h === 'localhost' || h.endsWith('.localhost') || h.startsWith('127.') || h === '[::1]';
  } catch {
    return false;
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
