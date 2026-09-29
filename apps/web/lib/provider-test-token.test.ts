import { describe, it, expect } from 'vitest';
import { issueProviderTestToken, verifyProviderTestToken } from './provider-test-token';

describe('provider test access', () => {
  const now = 1790722800000;
  it('accepts a fresh workspace token without exposing the provider key', () => {
    const token = issueProviderTestToken('private-provider-key', now);
    expect(token).not.toContain('private-provider-key');
    expect(verifyProviderTestToken(token, 'private-provider-key', now + 1000)).toBe(true);
  });
  it('rejects expired, forged, malformed and wrong-key tokens', () => {
    const token = issueProviderTestToken('secret', now);
    expect(verifyProviderTestToken(token, 'secret', now + 300000)).toBe(false);
    expect(verifyProviderTestToken(token, 'another-secret', now)).toBe(false);
    expect(verifyProviderTestToken(token.slice(0, -1) + (token.endsWith('0') ? '1' : '0'), 'secret', now)).toBe(false);
    expect(verifyProviderTestToken({}, 'secret', now)).toBe(false);
  });
});
