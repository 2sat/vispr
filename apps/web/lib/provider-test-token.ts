import { createHmac, timingSafeEqual } from 'node:crypto';

export function issueProviderTestToken(key: string, now = Date.now()) {
  const expires = String(now + 5 * 60_000);
  return `${expires}.${createHmac('sha256', key).update(`provider-test:${expires}`).digest('hex')}`;
}

export function verifyProviderTestToken(token: unknown, key: string, now = Date.now()) {
  if (typeof token !== 'string' || !/^\d{13}\.[a-f0-9]{64}$/.test(token)) return false;
  const [expires, signature] = token.split('.');
  if (Number(expires) <= now || Number(expires) > now + 5 * 60_000) return false;
  const expected = createHmac('sha256', key).update(`provider-test:${expires}`).digest();
  return timingSafeEqual(Buffer.from(signature!, 'hex'), expected);
}
