import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEMO_MODEL, generateDemoResponse, readDemoData, sealDemoData } from './openai-demo';

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', () => ({ cookies: async () => ({
  get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined,
  set: (name: string, value: string) => jar.set(name, value),
}) }));
import { getRunTrace, runScenario } from './vispr-server';

const secret = 'sk-fixture-only';
const request = { scenarioId: 'code-debugging' as const, policyId: 'quality-first', prompt: 'Fix the duration conversion.' };
const generated = {
  id: 'resp_fixture', model: DEMO_MODEL, status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text: 'Use 3600 seconds per hour.' }] }],
  usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 40 } },
};
beforeEach(() => { jar.clear(); vi.stubEnv('VISPR_DEMO_FIXTURES', '1'); vi.stubEnv('OPENAI_API_KEY', 'sk-fixture-only'); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('changes the prepared winner with the policy and preserves it in the trace', async () => {
  const quality = await runScenario(request);
  const cheap = await runScenario({ ...request, policyId: 'cheapest-qualified' });
  expect(quality.ok && quality.run.winner.model).toBe('gemini-pro');
  expect(cheap.ok && cheap.run.winner.model).toBe('gpt-mini');
  if (!cheap.ok) throw new Error('Prepared run failed');
  const trace = await getRunTrace(cheap.run.runId, cheap.run.policyId);
  expect(trace?.policy.id).toBe('cheapest-qualified');
  expect(trace?.run.winner).toEqual(cheap.run.winner);
  expect(trace?.auction.bids.find(b => b.status === 'awarded')?.model).toBe('gpt-mini');
  expect(await getRunTrace(cheap.run.runId, 'unknown-policy')).toBeNull();
});

it('generates an OpenAI response without a presenter code', async () => {
  vi.stubEnv('VISPR_DEMO_ACCESS_CODE', '');
  const fetcher = vi.fn(async () => Response.json(generated));
  vi.stubGlobal('fetch', fetcher);
  const result = await runScenario({ ...request, live: true });
  expect(result.ok).toBe(true);
  expect(fetcher).toHaveBeenCalledOnce();
});

it('rejects forged trace metadata', () => {
  const token = sealDemoData({ expires: Date.now() + 10000 }, secret);
  expect(readDemoData(token, 'different-secret')).toBeNull();
  expect(readDemoData(token + '.forged', secret)).toBeNull();
});

it('bounds paid generation, uses sample context, and reports actual usage separately', async () => {
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json(generated));
  const result = await generateDemoResponse(request, fetcher);
  const body = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
  expect(body).toMatchObject({ model: DEMO_MODEL, max_output_tokens: 1800, store: false });
  expect(body.input).toContain('duration.ts');
  expect(result.generation).toMatchObject({ inputTokens: 100, outputTokens: 20, estimatedCostUsd: 0.00006 });
  expect(JSON.stringify(result)).not.toContain('sk-fixture-only');
});

it('retains signed trace metadata without storing prompt or response', async () => {
  vi.stubGlobal('fetch', async () => Response.json(generated));
  const result = await runScenario({ ...request, live: true });
  expect(result.ok).toBe(true); if (!result.ok) return;
  expect(result.run.output).toBe('Use 3600 seconds per hour.');
  expect(result.run.illustrative).toBe(true);
  const stored = readDemoData<{ run: { output: string } }>(jar.get('vispr-demo-code-debugging'), secret);
  expect(stored?.run.output).toBe('');
  expect(JSON.stringify(stored)).not.toContain(request.prompt);
  const trace = await getRunTrace(result.run.runId);
  expect(trace?.run.generation?.responseId).toBe('resp_fixture');
  expect(trace?.run.winner).toEqual(result.run.winner);
});

it('rejects oversized prompts before calling OpenAI', async () => {
  const fetcher = vi.fn();
  await expect(generateDemoResponse({ ...request, prompt: 'x'.repeat(8001) }, fetcher)).rejects.toThrow('8,000');
  expect(fetcher).not.toHaveBeenCalled();
});

it('never returns provider error payloads or silently substitutes canned output', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ error: 'sensitive provider detail' }, { status: 429 }));
  const result = await runScenario({ ...request, live: true });
  expect(result).toMatchObject({ ok: false }); expect(JSON.stringify(result)).not.toContain('sensitive provider detail');
});

it('distinguishes exhausted account quota from temporary rate limiting', async () => {
  await expect(generateDemoResponse(request, async () => Response.json({ error: { code: 'insufficient_quota' } }, { status: 429 }))).rejects.toThrow('Add API credits');
  await expect(generateDemoResponse(request, async () => Response.json({ error: { code: 'rate_limit_exceeded' } }, { status: 429 }))).rejects.toThrow('rate-limiting');
});

it('provides a labeled illustrative trace for all five prepared scenarios', async () => {
  for (const id of ['support-triage', 'invoice-extraction', 'code-debugging', 'research-synthesis', 'ui-design']) {
    expect((await getRunTrace(`demo-${id}`))?.run.scenarioId).toBe(id);
  }
});
