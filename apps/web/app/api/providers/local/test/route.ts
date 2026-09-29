import { verifyProviderTestToken } from '../../../../../lib/provider-test-token';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: Request) {
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  const key = process.env.SELF_HOSTED_API_KEY;
  const base = process.env.SELF_HOSTED_BASE_URL;
  if (!key || !base) return reply({ error: 'Your local provider is not configured.' }, 503);
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) return reply({ error: 'Open the provider workspace to send a test.' }, 403);
  let input;
  try { input = await request.json(); } catch { return reply({ error: 'Invalid test request.' }, 400); }
  if (!verifyProviderTestToken(input?.token, key)) return reply({ error: 'This test session expired. Refresh the page and try again.' }, 401);
  const prompt = 'In one short sentence, introduce yourself as the model running on Jack’s MacBook and say you are ready to serve requests.';
  const start = performance.now();
  try {
    const url = new URL(`${base.replace(/\/$/, '')}/chat/completions`);
    if (url.protocol !== 'https:' || !(process.env.VISPR_DIRECT_ALLOWED_ORIGINS ?? '').split(',').includes(url.origin)) return reply({ error: 'Your provider connection is not approved.' }, 503);
    const upstream = await fetch(url, {
      method: 'POST', redirect: 'error', cache: 'no-store',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.SELF_HOSTED_MODEL_ID ?? 'qwen3.5:9b', messages: [{ role: 'user', content: prompt }], max_tokens: 128, reasoning_effort: 'none', stream: false }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(95000)]),
    });
    if (!upstream.ok) return reply({ error: upstream.status === 429 ? 'Your MacBook is busy. Try again in a moment.' : 'Your MacBook could not complete the test. Check that the model and connection are running.' }, upstream.status === 429 ? 429 : 502);
    const result = await upstream.json();
    const response = result.choices?.[0]?.message?.content;
    if (typeof response !== 'string' || !response.trim()) return reply({ error: 'The model returned an empty response. Please try again.' }, 502);
    return reply({ response, model: result.model, elapsedMs: Math.round(performance.now() - start), inputTokens: result.usage?.prompt_tokens ?? null, outputTokens: result.usage?.completion_tokens ?? null, prompt });
  } catch { return reply({ error: 'Your MacBook is unreachable or the test timed out. Check the connection and try again.' }, 502); }
}
