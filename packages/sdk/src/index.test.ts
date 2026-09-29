import { expect, it, vi } from 'vitest';
import { sampleRequest } from '@vispr/contracts/fixtures';
import { withSource, type VisprClient } from './index';

it('binds a source without mutating requests and preserves options and client methods', async () => {
  const events = (async function* () {})();
  const client: VisprClient = { stream: vi.fn(function(this: VisprClient) { expect(this).toBe(client); return events; }), cancel: vi.fn(async function(this: VisprClient) { expect(this).toBe(client); }) };
  const bound = withSource(client, 'design.preview');
  const request = { ...sampleRequest, source: 'other' }, options = { signal: new AbortController().signal };
  expect(bound.stream(request, options)).toBe(events);
  expect(client.stream).toHaveBeenCalledWith({ ...request, source: 'design.preview' }, options);
  expect(request.source).toBe('other');
  await bound.cancel('request'); expect(client.cancel).toHaveBeenCalledWith('request');
  expect(() => withSource(client, 'bad tag')).toThrow();
});
