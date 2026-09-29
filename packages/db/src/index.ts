// Database monetary values are bigint micro-USD. Keep database arithmetic exact.
export interface SpendReservation { id: string; applicationId: string; requestId: string; amountMicros: bigint; status: 'reserved' | 'settled' | 'uncertain' | 'released' }
export const MICRO_USD_PER_USD = 1_000_000n;
