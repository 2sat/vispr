import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';

const key = readFileSync(new URL('../.local-model/key', import.meta.url), 'utf8').trim();
const model = 'qwen3.5:9b';
let busy = false;
createServer(async (req, res) => {
  const supplied = Buffer.from(req.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${key}`);
  const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply(401, { error: 'Unauthorized' });
  const path = req.url;
  if (!((req.method === 'GET' && path === '/v1/models') || (req.method === 'POST' && path === '/v1/chat/completions'))) return reply(404, { error: 'Not found' });
  if (busy) return reply(429, { error: 'Local model busy' });
  busy = true;
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    let body;
    if (req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 65536) return reply(413, { error: 'Request too large' }); }
      let input;
      try { input = JSON.parse(raw); } catch { return reply(400, { error: 'Invalid JSON' }); }
      if (input.model !== model || !Array.isArray(input.messages)) return reply(400, { error: 'Unsupported model or messages' });
      if (input.stream) return reply(400, { error: 'This temporary tunnel supports non-streaming requests only' });
      const cap = input.max_tokens ?? 512;
      if (!Number.isInteger(cap) || cap < 1 || cap > 2048) return reply(400, { error: 'max_tokens must be 1–2048' });
      body = JSON.stringify({ ...input, reasoning_effort: input.reasoning_effort ?? 'none', max_tokens: cap, stream: false });
    }
    const upstream = await fetch(`http://127.0.0.1:11434${path}`, { method: req.method, headers: { 'content-type': 'application/json' }, body, signal: controller.signal });
    const data = await upstream.text();
    res.writeHead(upstream.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(data);
  } catch { if (!res.destroyed) reply(502, { error: 'Local model unavailable or timed out' }); }
  finally { busy = false; clearTimeout(timeout); }
}).listen(11435, '127.0.0.1', () => console.log('Authenticated local model gateway on 127.0.0.1:11435'));
