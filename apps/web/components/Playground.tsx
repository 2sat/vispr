'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Disclosure } from './Disclosure';
import { fmtMs, fmtTokens, fmtUsd } from '../lib/format';
import type { PolicyPreset, RunRequest, RunResult, RunSummary, Scenario, ScenarioId } from '../lib/types';

interface PlaygroundProps {
  scenarios: Scenario[];
  policies: PolicyPreset[];
  initialScenarioId: ScenarioId;
  /** Server action; keeps SDK credentials off the client. */
  runScenario: (req: RunRequest) => Promise<RunResult>;
  openaiConfigured?: boolean;
}

export function Playground({ scenarios, policies, initialScenarioId, runScenario, openaiConfigured = false }: PlaygroundProps) {
  const initial = scenarios.find((s) => s.id === initialScenarioId) ?? scenarios[0];
  if (!initial) throw new Error('Playground requires at least one scenario.');
  const [scenario, setScenario] = useState(initial);
  const [policyId, setPolicyId] = useState(initial.defaultPolicyId);
  const [prompt, setPrompt] = useState(initial.prompt);
  const [run, setRun] = useState<RunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [live, setLive] = useState(false);
  const [presenterCode, setPresenterCode] = useState('');

  const policy = policies.find((p) => p.id === policyId) ?? policies[0];
  if (!policy) throw new Error('Playground requires at least one policy.');

  function selectScenario(s: Scenario) {
    setScenario(s);
    setPolicyId(s.defaultPolicyId);
    setPrompt(s.prompt);
    setRun(null);
    setError(null);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await runScenario({ scenarioId: scenario.id, policyId, prompt, live, presenterCode });
      if (result.ok) setRun(result.run);
      else {
        setRun(null);
        setError(result.error);
      }
    });
  }

  return (
    <div className="playground">
      <aside aria-label="Scenarios" className="scenario-list">
        <h2 className="eyebrow">Try a scenario</h2>
        {scenarios.map((s) => (
          <button
            key={s.id}
            type="button"
            className="scenario"
            aria-pressed={s.id === scenario.id}
            onClick={() => selectScenario(s)}
          >
            <span className="scenario__name">{s.name}</span>
            <span className="scenario__summary">{s.summary}</span>
          </button>
        ))}
      </aside>

      <main className="playground__main">
        <section aria-label="Request" className="card request">
          <label htmlFor="prompt" className="visually-hidden">Request</label>
          <textarea id="prompt" className="prompt" maxLength={8000} value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} />
          <div className="request__policy">
            <label htmlFor="demo-response-mode" className="muted">Response</label>
            <select id="demo-response-mode" className="select" value={live ? 'openai' : 'prepared'} onChange={e => { setLive(e.target.value === 'openai'); setRun(null); setError(null); }}>
              <option value="prepared">Prepared demo</option>
              <option value="openai" disabled={!openaiConfigured}>OpenAI response</option>
            </select>
            {live && <><label htmlFor="presenter-code" className="muted">Presenter code</label>
              <input id="presenter-code" type="password" className="select" autoComplete="off" value={presenterCode} onChange={e => setPresenterCode(e.target.value)} maxLength={256} /></>}
          </div>
          {live && <p className="fine">OpenAI generates the response using bundled sample attachments. Routing and auctions remain simulated.</p>}
          <div className="request__bar">
            {scenario.attachments.map((a) => (
              <span key={a} className="chip">{a}</span>
            ))}
            <span className="spacer" />
            <span className="muted">
              Priorities <strong>{policy.label}</strong>
            </span>
            <button type="button" className="btn-primary" onClick={submit} disabled={pending || !prompt.trim()}>
              {pending ? 'Running…' : 'Run'}
            </button>
          </div>
          <div className="request__policy">
            <Disclosure title="Policy settings" variant="inline">
              <PolicySettings policy={policy} note={scenario.evidenceNote} />
            </Disclosure>
            <label htmlFor="policy" className="muted">Policy</label>
            <select id="policy" className="select" value={policyId} onChange={(e) => { setPolicyId(e.target.value); setRun(null); setError(null); }}>
              {policies.map((p) => (
                <option key={p.id} value={p.id}>{p.id}</option>
              ))}
            </select>
          </div>
        </section>

        <section aria-label="Response" className="card response">
          <ResponsePane run={run} error={error} pending={pending} />
        </section>
      </main>

      <aside aria-label="Routing result" className="result-rail">
        {run ? <RunResult run={run} /> : <p className="card muted">Run a scenario to see where it was routed.</p>}
      </aside>
    </div>
  );
}

function PolicySettings({ policy, note }: { policy: PolicyPreset; note: string }) {
  const w = policy.weights;
  return (
    <div className="policy-grid">
      <div>
        <h3 className="eyebrow">Priorities</h3>
        {policy.mode === 'cheapest-qualified' ? (
          <p>Cheapest bid that clears the quality and speed minimums wins.</p>
        ) : (
          <div className="weights">
            <WeightRow label="Quality" value={w.quality} tone="quality" />
            <WeightRow label="Cost" value={w.cost} tone="cost" />
            <WeightRow label="Speed" value={w.latency} tone="latency" />
          </div>
        )}
      </div>
      <div>
        <h3 className="eyebrow">Guardrails</h3>
        <dl className="kv">
          <dt>Min. quality</dt><dd>{policy.minQuality.toFixed(2)}</dd>
          <dt>Max spend / run</dt><dd>{fmtUsd(policy.maxSpendUsd, 'not set')}</dd>
          <dt>Speed target</dt>
          <dd>≤ {fmtMs(policy.latencyTarget.ms)} {policy.latencyTarget.metric === 'first-token' ? 'first token' : 'total'}</dd>
          <dt>Missing evidence</dt><dd>{policy.missingCoverage}</dd>
        </dl>
      </div>
      <div>
        <h3 className="eyebrow">If something fails</h3>
        <dl className="kv">
          <dt>Jev unsure</dt><dd>{policy.onLowConfidence === 'fail' ? 'fail with reason' : 'conservative pool'}</dd>
          <dt>No bids</dt><dd>{policy.onNoBid === 'fail' ? 'fail' : 'use fallback'}</dd>
          <dt>Provider error</dt><dd>{policy.onProviderError === 'retry-next-bid' ? 'retry next bid' : 'fail'}</dd>
        </dl>
      </div>
      <div className="notice">
        <span>{note}</span>
        <span>Policy editing is not yet available. Choose a preset above.</span>
      </div>
    </div>
  );
}

function WeightRow({ label, value, tone }: { label: string; value: number; tone: 'quality' | 'cost' | 'latency' }) {
  return (
    <>
      <span>{label}</span>
      <span className="bar"><span className={`bar__fill bar__fill--${tone}`} style={{ width: `${value}%` }} /></span>
      <span className="mono num">{value}</span>
    </>
  );
}

function ResponsePane({ run, error, pending }: { run: RunSummary | null; error: string | null; pending: boolean }) {
  const [tab, setTab] = useState<'preview' | 'source'>('preview');
  const isHtml = run?.outputKind === 'html';
  return (
    <>
      <div className="response__head">
        <h2>Response</h2>
        {run?.illustrative && <span className="badge-warn">{run.generation ? 'OpenAI response · simulated routing' : 'Illustrative data'}</span>}
        <span className="spacer" />
        {isHtml && (
          <div role="tablist" aria-label="Design output" className="tabs">
            <button type="button" role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')}>Preview</button>
            <button type="button" role="tab" aria-selected={tab === 'source'} onClick={() => setTab('source')}>Source</button>
          </div>
        )}
      </div>
      {pending && <p className="muted">Generating the response…</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {run && !isHtml && <pre className={run.outputKind === 'json' ? 'output mono' : 'output'}>{run.output}</pre>}
      {run && isHtml && tab === 'preview' && (
        // Empty sandbox: no scripts, opaque origin, no access to app credentials or storage.
        <iframe className="preview" sandbox="" srcDoc={run.output} title="Generated landing page preview" />
      )}
      {run && isHtml && tab === 'source' && <pre className="output source">{run.output}</pre>}
    </>
  );
}

function RunResult({ run }: { run: RunSummary }) {
  const c = run.cost;
  const routingMs = run.timing.classificationMs + run.timing.selectionMs + run.timing.auctionMs;
  return (
    <section className="card result">
      <div className="result__winner">
        <span className="muted">{run.generation ? 'Simulated auction winner' : 'Routed to'}</span>
        <strong>{run.winner.model}</strong>
        <span className="muted">{run.winner.provider} · won {run.bidCount}-way auction</span>
      </div>
      {run.generation && <p className="fine">Response generated by {run.generation.model} · OpenAI</p>}
      <div className="stats">
        <div className="stat"><span>{run.generation ? 'Generation time' : 'Elapsed'}</span><strong className="mono">{fmtMs(run.generation?.elapsedMs ?? run.timing.totalMs)}</strong></div>
        <div className="stat"><span>Est. cost</span><strong className="mono">{fmtUsd(run.generation?.estimatedCostUsd ?? c.estimatedUpstreamUsd)}</strong></div>
      </div>
      <Link href={`/runs/${run.runId}?policy=${encodeURIComponent(run.policyId)}`} className="btn-outline">Why this model? <span aria-hidden="true">→</span></Link>
      <Disclosure title="Timing & cost details" variant="inline">
        <dl className="kv">
          {run.generation && <><dt>OpenAI tokens in / out</dt><dd>{fmtTokens(run.generation.inputTokens)} / {fmtTokens(run.generation.outputTokens)}</dd></>}
          <dt>Routing overhead</dt><dd>{fmtMs(routingMs)}</dd>
          <dt>First token</dt><dd>{fmtMs(run.timing.firstTokenMs)}</dd>
          <dt>Tokens in / out</dt>
          <dd>{run.usage ? `${fmtTokens(run.usage.inputTokens)} / ${fmtTokens(run.usage.outputTokens)}` : '—'}</dd>
          <dt>Simulated quote</dt><dd>{fmtUsd(c.simulatedQuoteUsd)}</dd>
          <dt>Usage-derived upstream</dt><dd>{fmtUsd(c.usageDerivedUpstreamUsd)}</dd>
          <dt>Actual billing</dt><dd>{fmtUsd(c.actualBillingUsd, 'unavailable')}</dd>
        </dl>
        <p className="fine">{run.generation ? 'Routing timings and quotes are simulated. Generation time and tokens come from this OpenAI call; cost uses published rates, not a provider bill.' : 'Quotes are demo offers, not vendor discounts.'}</p>
      </Disclosure>
    </section>
  );
}
