import { describe, expect, it, vi } from 'vitest';
import { sampleRequest } from '@vispr/contracts/fixtures';
import { JevClassifier, JEV_QUESTIONS, JEV_REVISION, parseJevResponse, type JevOptions } from './classification';
const model = 'jev-1.13.0';
const context = { unresolvedToolCallIds: [], capabilityContextDigest: 'c1' };
const signal = () => new AbortController().signal;
function response() {
  const choice = (labels: readonly string[], selected: string) => ({ type: 'choice', choice: selected, confidence: .9, probabilities: Object.fromEntries(labels.map(label => [label, label === selected ? 1 : 0])) });
  return { model, answers: { task: choice(Object.keys(JEV_QUESTIONS.task.criteria), 'support'), complexity: choice(Object.keys(JEV_QUESTIONS.complexity.criteria), 'low'), continuity: choice(Object.keys(JEV_QUESTIONS.continuity.criteria), 'fresh') }, usage: { input_tokens: 100, output_tokens: 30 } };
}
function options(overrides: Partial<JevOptions> = {}): JevOptions {
  return { apiKey: 'test-not-a-real-key', model, fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json(response())), authorizeAttempt: vi.fn().mockResolvedValue(undefined), recordAttempt: vi.fn().mockResolvedValue(undefined), ...overrides };
}
describe('batched Jev adapter', () => {
  it('submits all three independent judgments in one authorized request', async () => {
    const config = options(); const result = await new JevClassifier(config).assessDetailed(sampleRequest, context, signal());
    expect(config.fetch).toHaveBeenCalledTimes(1); expect(config.authorizeAttempt).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(config.fetch!).mock.calls[0]!;
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    const payload = JSON.parse(init!.body as string);
    expect(Object.keys(payload.questions)).toEqual(['complexity', 'continuity', 'task']);
    expect(payload.state).not.toHaveProperty('idempotencyKey');
    expect(result.assessment).toMatchObject({ task: 'support', complexity: 'low', continuity: 'fresh', questionVersion: JEV_REVISION });
    expect(result.attempts[0]).toMatchObject({ status: 'success', dispatched: true, usage: { inputTokens: 100, outputTokens: 30 } });
    expect(config.recordAttempt).toHaveBeenCalledTimes(1);
  });
  it('does not transmit image data to a text-only classifier', async () => {
    const config = options();
    await new JevClassifier(config).assess({ ...sampleRequest, messages: [{ role: 'user', content: [{ type: 'text', text: 'Design from this reference' }, { type: 'image_url', url: 'https://private.example/image.png' }] }] }, context, signal());
    const payload = vi.mocked(config.fetch!).mock.calls[0]![1]!.body as string;
    expect(payload).not.toContain('private.example'); expect(payload).toContain('pixelsUnavailableToClassifier');
  });
  it('requires a pinned model and validates state before authorization', async () => {
    expect(() => new JevClassifier(options({ model: 'jev-latest' }))).toThrow('exact Jev');
    const config = options({ maximumStateBytes: 10 });
    await expect(new JevClassifier(config).assess(sampleRequest, context, signal())).rejects.toMatchObject({ code: 'STATE_TOO_LARGE' });
    expect(config.authorizeAttempt).not.toHaveBeenCalled(); expect(config.fetch).not.toHaveBeenCalled();
  });
  it('retries only explicitly enabled overloads and authorizes/accounts every attempt', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(Response.json(response()));
    const config = options({ fetch: fetcher, maxAttempts: 2, retryDelayMs: 0 });
    const result = await new JevClassifier(config).assessDetailed(sampleRequest, context, signal());
    expect(result.attempts.map(a => a.status)).toEqual(['http_error', 'success']); expect(config.authorizeAttempt).toHaveBeenCalledTimes(2); expect(config.recordAttempt).toHaveBeenCalledTimes(2);
  });
  it('does not retry ambiguous transport failures or unauthorized responses', async () => {
    for (const fetcher of [vi.fn<typeof fetch>().mockRejectedValue(new Error('secret upstream detail')), vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 401 }))]) {
      const config = options({ fetch: fetcher, maxAttempts: 3 });
      await expect(new JevClassifier(config).assess(sampleRequest, context, signal())).rejects.not.toThrow('secret upstream detail');
      expect(fetcher).toHaveBeenCalledTimes(1); expect(config.recordAttempt).toHaveBeenCalledTimes(1);
    }
  });
  it('times out a fetcher that ignores abort and records uncertain billing', async () => {
    const config = options({ timeoutMs: 10, fetch: vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {})) });
    await expect(new JevClassifier(config).assess(sampleRequest, context, signal())).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(config.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({ status: 'aborted', dispatched: true, usage: null }));
  });
  it('honors cancellation before dispatch and propagates budget/accounting failures', async () => {
    const controller = new AbortController(); controller.abort(new Error('caller-cancelled'));
    const config = options(); await expect(new JevClassifier(config).assess(sampleRequest, context, controller.signal)).rejects.toThrow('caller-cancelled'); expect(config.fetch).not.toHaveBeenCalled();
    const denied = options({ authorizeAttempt: vi.fn().mockRejectedValue(new Error('budget denied')) });
    await expect(new JevClassifier(denied).assess(sampleRequest, context, signal())).rejects.toThrow('budget denied'); expect(denied.fetch).not.toHaveBeenCalled();
    await expect(new JevClassifier(options({ recordAttempt: vi.fn().mockRejectedValue(new Error('ledger unavailable')) })).assess(sampleRequest, context, signal())).rejects.toThrow('ledger unavailable');
  });
  it('rejects incomplete/mismatched answers and retains reported usage', async () => {
    const invalid = response(); invalid.answers.task.probabilities = { support: .1 };
    const config = options({ fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json(invalid)) });
    await expect(new JevClassifier(config).assess(sampleRequest, context, signal())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(config.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({ status: 'invalid_response', usage: { inputTokens: 100, outputTokens: 30 } }));
    expect(() => parseJevResponse({ ...response(), model: 'jev-other' }, model)).toThrow('revision');
    expect(() => parseJevResponse({ ...response(), answers: {} }, model)).toThrow();
  });
});
