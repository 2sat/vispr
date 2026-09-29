import { describe, expect, it } from 'vitest';
import { TraceEventSchema } from '@vispr/contracts';
import { scenarios } from '@vispr/contracts/fixtures';
import { appendEvent, cancelRun, designDocument, fixtureEvents, type RunView } from './fixture-run';
const initial = (): RunView => ({ requestId: 'test', events: [], output: '', status: 'playing' });
describe('UI trace playback', () => {
  it('renders every scenario from valid shared protocol events', () => {
    for (const scenario of scenarios) {
      const events = fixtureEvents(scenario.id, 'test', 1);
      expect(events.every(event => TraceEventSchema.safeParse(event).success)).toBe(true);
      const result = events.reduce(appendEvent, initial());
      expect(result.status).toBe('completed');
      expect(result.output.length).toBeGreaterThan(20);
      expect(result.events).toHaveLength(events.length);
    }
  });
  it('ignores duplicate, out-of-order and other-request events', () => {
    const events = fixtureEvents('support', 'test', 1);
    const first = appendEvent(initial(), events[0]!);
    expect(appendEvent(first, events[0]!)).toBe(first);
    expect(appendEvent(initial(), events[2]!)).toEqual(initial());
    expect(appendEvent(initial(), { ...events[0]!, requestId: 'other' })).toEqual(initial());
  });
  it('retains partial output and ignores late events after cancellation', () => {
    const events = fixtureEvents('support', 'test', 1);
    const partial = events.slice(0, 6).reduce(appendEvent, initial());
    expect(partial.output).not.toBe('');
    const stopped = cancelRun(partial);
    expect(stopped.status).toBe('cancelled');
    expect(appendEvent(stopped, events[6]!)).toBe(stopped);
    expect(stopped.output).toBe(partial.output);
  });
  it('retains partial output on a provider failure', () => {
    const partial = fixtureEvents('coding', 'test', 1).slice(0, 6).reduce(appendEvent, initial());
    const failed = appendEvent(partial, { requestId: 'test', sequence: 6, type: 'error', code: 'PROVIDER_FAILED', message: 'Example failure', partial: true });
    expect(failed.status).toBe('failed');
    expect(failed.output).toBe(partial.output);
  });
  it('rejects unknown scenarios and keeps design preview network/script free', () => {
    expect(() => fixtureEvents('unknown', 'test', 1)).toThrow('Unknown scenario');
    expect(designDocument).toContain("default-src 'none'");
    expect(designDocument).not.toContain('<script');
  });
});
