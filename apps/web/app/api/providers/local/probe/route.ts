import { timingSafeEqual } from 'node:crypto';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: Request) {
  const key = process.env.SELF_HOSTED_API_KEY;
  const base = process.env.SELF_HOSTED_BASE_URL;
  if (!key || !base) return Response.json({ error: 'Local provider not configured' }, { status: 503 });
  const supplied = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${key}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const url = new URL(`${base.replace(/\/$/, '')}/chat/completions`);
    if (url.protocol !== 'https:') throw new Error('HTTPS required');
    const upstream = await fetch(url, {
      method: 'POST', redirect: 'error', cache: 'no-store',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.SELF_HOSTED_MODEL_ID ?? 'qwen3.5:9b', messages: [{ role: 'user', content: 'Reply with exactly: Vispr local model connected.' }], max_tokens: 64, stream: false }),
      signal: AbortSignal.timeout(95000),
    });
    if (!upstream.ok) return Response.json({ error: 'Local provider rejected probe', upstreamStatus: upstream.status }, { status: 502 });
    const result = await upstream.json();
    return Response.json({ connected: true, model: result.model, message: result.choices?.[0]?.message, usage: result.usage, streaming: false });
  } catch { return Response.json({ error: 'Local provider unreachable or timed out' }, { status: 502 }); }
}
