import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { RunRequest, RunSummary } from './types';

export const DEMO_MODEL = 'gpt-4.1-mini-2025-04-14';
export const MAX_PROMPT_CHARS = 8000;

const context: Record<string, string> = {
  'support-triage': 'This is a sample billing ticket. Do not claim you accessed accounts or issued a refund. Draft the reply and categorize the ticket.',
  'invoice-extraction': 'Sample invoice: Northstar Office Supplies, 2026-09-20. Two desk lamps at $35 each and three notebooks at $8 each. Subtotal $94; tax $7.52; total $101.52 USD. InvoiceV2 fields: vendor, invoiceDate, lineItems [{description, quantity, unitPrice}], tax, total, currency.',
  'code-debugging': 'Sample duration.ts: const UNITS = { h: 60, m: 60, s: 1 }; export function parseDuration(s: string) { return [...s.matchAll(/(\\d+)([hms])/g)].reduce((n, m) => n + Number(m[1]) * UNITS[m[2] as keyof typeof UNITS], 0); }\nSample duration.test.ts: expect(parseDuration("1h30m")).toBe(5400).',
  'research-synthesis': 'Three fictional demo reports: [DOC-A] Pilot with 40 users: satisfaction improved 18%, onboarding took 12 minutes. [DOC-B] Pilot with 120 users: satisfaction improved 9%, onboarding took 7 minutes; support load fell 15%. [DOC-C] Pilot with 60 users: satisfaction improved 14%, onboarding took 15 minutes; support load rose 5%. Cite these IDs and distinguish different samples from direct contradictions. Do not invent external sources.',
  'ui-design': 'Sample brief: Vispr is an inference marketplace that matches AI requests to models using quality, cost and speed priorities. Create a clean responsive landing page with a hero, three feature cards, a workflow section and a call to action. Use self-contained HTML and CSS; no scripts, external assets, or network requests.',
};

export function sealDemoData(value: unknown, secret: string): string {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

export function readDemoData<T>(token: string | undefined, secret: string): T | null {
  if (!token || !secret || token.length > 6000) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()) as T; }
  catch { return null; }
}

export function presenterAuthorized(code: string | undefined, session: string | undefined, secret: string): boolean {
  if (secret.length < 12) return false;
  const saved = readDemoData<{ expires: number; presenter: boolean }>(session, secret);
  if (saved?.presenter === true && saved.expires > Date.now()) return true;
  if (typeof code !== 'string' || !code || code.length > 256) return false;
  const supplied = Buffer.from(code);
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function generateDemoResponse(req: RunRequest, fetcher = fetch): Promise<{
  output: string; generation: NonNullable<RunSummary['generation']>;
}> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OpenAI is not configured for this deployment. Use the prepared demo for now.');
  if (typeof req.prompt !== 'string' || !req.prompt.trim() || req.prompt.length > MAX_PROMPT_CHARS) {
    throw new Error('Enter a prompt of up to 8,000 characters.');
  }
  const outputInstruction = req.scenarioId === 'ui-design'
    ? 'Return only a complete HTML document with inline CSS, without Markdown fences. Keep it compact.'
    : req.scenarioId === 'invoice-extraction'
      ? 'Return valid JSON only, without Markdown fences.'
      : 'Return a concise, useful response in plain text. Aim for fewer than 500 words.';
  const started = Date.now();
  const response = await fetcher('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: DEMO_MODEL,
      instructions: `You power the Vispr presentation demo. Follow the user's request using the bundled sample materials. ${outputInstruction}`,
      input: `Bundled sample materials:\n${context[req.scenarioId] ?? ''}\n\nUser request:\n${req.prompt}`,
      max_output_tokens: 1800,
      store: false,
      ...(req.scenarioId === 'invoice-extraction' ? { text: { format: { type: 'json_object' } } } : {}),
    }),
    signal: AbortSignal.timeout(45000),
    redirect: 'error',
    cache: 'no-store',
  });
  if (!response.ok) {
    // Never expose raw provider errors, request bodies, or credentials to the browser.
    const failure = await response.json().catch(() => null) as { error?: { code?: string; type?: string } } | null;
    const exhausted = failure?.error?.code === 'insufficient_quota' || failure?.error?.type === 'insufficient_quota';
    const detail = response.status === 401 ? 'The OpenAI key was rejected.'
      : response.status === 429 && exhausted ? 'OpenAI API quota is exhausted. Add API credits or raise the project quota, then try again. ChatGPT subscriptions do not include API credits.'
      : response.status === 429 ? 'OpenAI is rate-limiting requests. Wait a moment and try again, or use the prepared demo.'
      : 'OpenAI could not complete this request. Try the prepared demo.';
    throw new Error(detail);
  }
  const data = await response.json() as {
    id: string; model: string; status: string;
    output: { type: string; content?: { type: string; text?: string }[] }[];
    usage?: { input_tokens: number; output_tokens: number; input_tokens_details?: { cached_tokens?: number } };
  };
  if (data.status !== 'completed') throw new Error('The response reached its output limit. Ask for a shorter response or use the prepared demo.');
  const output = data.output.filter(item => item.type === 'message')
    .flatMap(item => item.content ?? []).filter(part => part.type === 'output_text')
    .map(part => part.text ?? '').join('\n').replace(/^```(?:html|json)?\s*\n?|\n?```$/g, '').trim();
  if (!output || !data.usage) throw new Error('OpenAI returned no usable response. Try the prepared demo.');
  if (req.scenarioId === 'invoice-extraction') {
    try { JSON.parse(output); } catch { throw new Error('OpenAI returned invalid JSON. Use the prepared demo.'); }
  }
  const { input_tokens: inputTokens, output_tokens: outputTokens } = data.usage;
  const cached = Math.min(inputTokens, data.usage.input_tokens_details?.cached_tokens ?? 0);
  return {
    output,
    generation: {
      model: data.model, provider: 'OpenAI', responseId: data.id,
      elapsedMs: Date.now() - started, inputTokens, outputTokens,
      // GPT-4.1 mini list rates: $0.40 input, $0.10 cached input, $1.60 output / Mtok.
      estimatedCostUsd: ((inputTokens - cached) * 0.4 + cached * 0.1 + outputTokens * 1.6) / 1e6,
    },
  };
}
