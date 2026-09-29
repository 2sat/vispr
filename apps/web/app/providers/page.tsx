import type { Metadata } from 'next';
import { AppHeader } from '../../components/AppHeader';
import { providerPreview } from '../../lib/provider-preview';
import proof from '../../lib/local-model-verification.json';

export const metadata: Metadata = { title: 'Your provider workspace · Vispr' };
export const dynamic = 'force-dynamic';

export default async function ProvidersPage() {
  let provider: Awaited<ReturnType<typeof providerPreview>> = null;
  try { provider = await providerPreview(); } catch { /* Show registration availability explicitly. */ }
  const date = (value: string) => new Date(value).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' PT';
  return <>
    <AppHeader active="providers" traceHref="/runs/demo-code-debugging" role="Provider" />
    <main className="provider-workspace">
      <div className="provider-heading">
        <div><p className="eyebrow">Provider console</p><h1>Your compute. In the marketplace.</h1><p className="provider-lead">Manage your model offerings and see how your device connects to Vispr.</p></div>
        <span className="provider-preview-label">Provider workspace preview</span>
      </div>
      {!provider ? <section className="card"><h2>Provider registration unavailable</h2><p className="fine">Your connection is configured, but the provider record could not be loaded. Refresh to check again.</p></section> : <>
        <section className="provider-identity card">
          <div className="provider-device" aria-hidden="true"><svg viewBox="0 0 64 64" fill="none"><rect x="12" y="10" width="40" height="30" rx="3" stroke="currentColor" strokeWidth="2"/><path d="M7 46h50l-4 5H11l-4-5Z" stroke="currentColor" strokeWidth="2"/><path d="M26 46h12" stroke="currentColor" strokeWidth="3"/></svg></div>
          <div className="provider-identity-copy"><div className="provider-title-line"><h2>{provider.name}</h2><span className={`provider-status ${provider.connected ? 'provider-status--online' : 'provider-status--offline'}`}><span aria-hidden="true">●</span> {provider.connected ? 'Connected' : 'Offline'}</span></div><p className="muted">Jack’s provider workspace · Self-hosted on macOS</p><p className="fine">Registered {date(provider.registeredAt)} · Authenticated connection</p></div>
          <a className="btn-outline provider-refresh" href="/providers">Refresh connection <span aria-hidden="true">↻</span></a>
        </section>
        <section className="provider-metrics" aria-label="Provider overview">
          <div className="card"><p className="eyebrow">Model offerings</p><p className="provider-number">1</p><p className="fine">Installed and registered</p></div>
          <div className="card"><p className="eyebrow">Concurrent capacity</p><p className="provider-number">{provider.capacity}<span> request</span></p><p className="fine">Protects your Mac’s resources</p></div>
          <div className="card"><p className="eyebrow">Connection response</p><p className="provider-number">{provider.latencyMs === null ? '—' : provider.latencyMs}<span>{provider.latencyMs === null ? '' : ' ms'}</span></p><p className="fine">Live reachability check · {date(provider.checkedAt)}</p></div>
        </section>
        <div className="provider-columns">
          <section className="card provider-offering"><div className="provider-section-title"><h2>Model offering</h2><span className="chip">Self-hosted</span></div><h3>Qwen 3.5 · 9B</h3><p className="mono muted">{provider.deployment.inferenceModelId}</p><div className="provider-notice"><span aria-hidden="true">◷</span><div><strong>Awaiting streaming connection</strong><p>Your model can answer connection tests. Streaming support is required before it can compete for routed requests.</p></div></div><dl className="kv provider-details"><dt>Availability</dt><dd>{provider.connected ? 'Reachable now' : 'Device unreachable'}</dd><dt>Text completions</dt><dd>Verified</dd><dt>Output limit</dt><dd>2,048 tokens</dd><dt>Streaming</dt><dd>Pending</dd><dt>Tools / vision / structured output</dt><dd>Not verified</dd><dt>Bid pricing</dt><dd>Not configured</dd><dt>Auction participation</dt><dd>Pending activation</dd></dl></section>
          <section className="card provider-verification"><div className="provider-section-title"><h2>Connection verification</h2><span className="provider-status provider-status--online">Passed at setup</span></div><p className="provider-lead">A real request from the hosted Vispr service reached your MacBook and returned a model response.</p><div className="provider-path"><span>Vispr</span><span aria-hidden="true">→</span><span>Secure connection</span><span aria-hidden="true">→</span><span>Your MacBook</span></div><div className="provider-proof"><p className="eyebrow">Model response</p><blockquote>{proof.message.content}</blockquote><p className="fine">{proof.usage.prompt_tokens} input tokens · {proof.usage.completion_tokens} output tokens · {date(proof.checkedAt)}</p></div><p className="fine">This setup test is separate from marketplace traffic. Refresh connection checks current reachability without generating another response.</p></section>
        </div>
        <section className="card provider-requests"><div className="provider-section-title"><h2>Recent routed requests</h2><span className="muted">0 requests</span></div><div className="provider-empty"><span className="provider-empty-icon" aria-hidden="true">↗</span><h3>Your first request will appear here.</h3><p>Once the offering is activated, you’ll see the requests your MacBook serves, token usage, and execution results.</p></div></section>
        <p className="provider-footnote">Live provider record and connection status. This preview shows Jack’s registered offering without exposing account details or credentials. Keep your Mac awake and its model service running to stay connected.</p>
      </>}
    </main>
  </>;
}
