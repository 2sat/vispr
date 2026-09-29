'use client';

import { useState } from 'react';

type TestResult = { response: string; model: string; elapsedMs: number; inputTokens: number | null; outputTokens: number | null; prompt: string };

export function ProviderTest({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    if (pending) return;
    setPending(true); setError(null); setResult(null);
    try {
      const res = await fetch('/api/providers/local/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), signal: AbortSignal.timeout(105000) });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'The test failed. Please try again.'); return; }
      setResult(data);
    } catch { setError('The connection was interrupted. Refresh the page and try again.'); }
    finally { setPending(false); }
  }
  return <section className="card provider-test">
    <div className="provider-section-title"><div><h2>Try your model live</h2><p className="fine">Send a short introduction request to the model on your MacBook.</p></div><button className="btn-primary" type="button" onClick={run} disabled={pending}>{pending ? 'Waiting for your MacBook…' : 'Send test request'}</button></div>
    <div aria-live="polite" aria-busy={pending}>
      {pending && <p className="fine">Vispr is contacting your MacBook and generating a response. This can take a moment if the model needs to load.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {result && <div className="provider-proof"><p className="eyebrow">Live response · {result.model}</p><blockquote>{result.response}</blockquote><p className="fine">{(result.elapsedMs / 1000).toFixed(2)} seconds · {result.inputTokens ?? 'Unavailable'} input tokens · {result.outputTokens ?? 'Unavailable'} output tokens</p><details className="provider-test-prompt"><summary>View test prompt</summary><p className="fine">{result.prompt}</p></details></div>}
      {!pending && !error && !result && <p className="fine">The response comes from your local model. Test requests are separate from marketplace traffic.</p>}
    </div>
  </section>;
}
