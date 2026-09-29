import { createHash, randomBytes } from "node:crypto";
export interface SpendReservation {
  id: string;
  applicationId: string;
  requestId: string;
  amountMicros: bigint;
  status: "reserved" | "settled" | "uncertain" | "released";
}
export const MICRO_USD_PER_USD = 1_000_000n;
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
export function issueApiKey() {
  const key = `vispr_${randomBytes(32).toString("base64url")}`;
  return { key, hash: hashApiKey(key), prefix: key.slice(0, 14) };
}
/** Server-only PostgREST transport. Never import into a client component. */
export class Database {
  constructor(
    readonly url: string,
    private readonly secret: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetcher(`${this.url}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: this.secret,
        ...(this.secret.startsWith("sb_secret_")
          ? {}
          : { Authorization: `Bearer ${this.secret}` }),
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...init.headers,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      const body = await response.text();
      if (body.includes("BUDGET_EXCEEDED")) throw new Error("BUDGET_EXCEEDED");
      if (response.status === 409) throw new Error("IDEMPOTENCY_CONFLICT");
      throw new Error("Database operation failed");
    }
    const body = await response.text();
    return (body ? JSON.parse(body) : null) as T;
  }
  rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    return this.call(`rpc/${name}`, {
      method: "POST",
      body: JSON.stringify(args),
    });
  }
}
