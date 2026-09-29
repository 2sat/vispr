import type { Bid, Weights, Utilities } from './types';

export function fmtMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

export function fmtUsd(v: number | null, empty = '—'): string {
  if (v === null) return empty;
  return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

export function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function fmtRate(v: number | null): string {
  return v === null ? '—' : `$${v.toFixed(2)}`;
}

/** Per-term contributions of the spec's utility formula. */
export function utilityTerms(w: Weights, u: Utilities) {
  const quality = (w.quality / 100) * u.quality;
  const cost = (w.cost / 100) * u.cost;
  const latency = (w.latency / 100) * u.latency;
  return { quality, cost, latency, penalty: u.penalty, total: quality + cost + latency - u.penalty };
}

export type ScoredBid = Bid & { utilities: Utilities; score: ReturnType<typeof utilityTerms> };

/** Valid bids with scores, best first. Ties: lower declared delay, then deployment ID. */
export function rankBids(bids: Bid[], w: Weights): ScoredBid[] {
  return bids
    .filter((b): b is Bid & { utilities: Utilities } => b.status !== 'rejected' && !!b.utilities)
    .map((b) => ({ ...b, score: utilityTerms(w, b.utilities) }))
    .sort(
      (a, b) =>
        b.score.total - a.score.total ||
        (a.declaredQueueMs ?? Infinity) - (b.declaredQueueMs ?? Infinity) ||
        a.deploymentId.localeCompare(b.deploymentId),
    );
}

/** One-sentence explanation of why the winner beat the highest-quality bid. */
export function explainWinner(ranked: ScoredBid[], w: Weights): string {
  const [winner] = ranked;
  if (!winner) return 'No valid bids were received.';
  const topQuality = [...ranked].sort((a, b) => b.utilities.quality - a.utilities.quality)[0] ?? winner;
  const priorities = `quality ${w.quality}, cost ${w.cost}, speed ${w.latency}`;
  if (topQuality.deploymentId === winner.deploymentId) {
    return `${winner.model} had the strongest quality evidence and stayed competitive on cost and speed with priorities set to ${priorities}.`;
  }
  const edges: string[] = [];
  if (winner.utilities.cost > topQuality.utilities.cost) edges.push('bid cheaper');
  if (winner.utilities.latency > topQuality.utilities.latency) edges.push('responds faster');
  const edge = edges.length ? edges.join(' and ') : 'scored better overall';
  return `${topQuality.model} scored higher on quality, but ${winner.model} ${edge} — enough to come out ahead with priorities set to ${priorities}.`;
}
