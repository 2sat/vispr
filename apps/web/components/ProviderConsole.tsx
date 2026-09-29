'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Disclosure } from './Disclosure';
import { deploymentWarnings, quoteBid } from '../lib/bidding';
import { fmtTokens } from '../lib/format';
import type {
  BidPolicy, BidStrategy, EndpointDraft, FeatureSet, ProbeResult, ProbedFeature, ProviderDeployment, ProviderKind, SaveResult,
} from '../lib/types';

interface ProviderConsoleProps {
  deployments: ProviderDeployment[];
  illustrative: boolean;
  saveDeployment: (offeringId: string, patch: { available?: boolean; bidPolicy?: BidPolicy }) => Promise<SaveResult>;
  probeEndpoint: (draft: EndpointDraft) => Promise<ProbeResult>;
}

const statusLabel = { connected: 'Connected', degraded: 'Degraded', unreachable: 'Unreachable' } as const;
const featureLabel: Record<ProbedFeature, string> = {
  streaming: 'Streaming', tools: 'Tool calls', 'structured-output': 'Structured output', images: 'Images',
};
const strategies: { id: BidStrategy; label: string; help: string }[] = [
  { id: 'fixed', label: 'Fixed rate', help: 'Always quotes your list rates.' },
  { id: 'capacity-adjusted', label: 'Capacity-adjusted', help: 'Raises the quote as your capacity fills, and sits out when full.' },
  { id: 'bounded-discount', label: 'Bounded discount', help: 'Quotes up to a set percentage below list, never below your floor.' },
];
const outcomeLabel = { won: 'won · executed', lost: 'lost to a higher score', late: 'rejected · after deadline' } as const;

export function ProviderConsole({ deployments, illustrative, saveDeployment, probeEndpoint }: ProviderConsoleProps) {
  const [items, setItems] = useState(deployments);
  const [selectedId, setSelectedId] = useState(deployments[0]?.offeringId ?? null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const selected = items.find((d) => d.offeringId === selectedId) ?? null;

  const replace = (d: ProviderDeployment) => setItems((xs) => xs.map((x) => (x.offeringId === d.offeringId ? d : x)));

  return (
    <div className="providers">
      <div className="providers__head">
        <div>
          <h1>Provider console</h1>
          <p className="muted">Your registered offerings and how they bid in Vispr auctions</p>
        </div>
        {illustrative && <span className="badge-warn">Illustrative data</span>}
        <span className="spacer" />
        <button type="button" className="btn-primary" onClick={() => setRegisterOpen(true)}>+ Register endpoint</button>
      </div>

      <div className="providers__body">
        <aside aria-label="Offerings" className="offering-list">
          {items.map((d) => (
            <button
              key={d.offeringId}
              type="button"
              className="offering"
              aria-pressed={d.offeringId === selectedId}
              onClick={() => setSelectedId(d.offeringId)}
            >
              <span className="offering__top">
                <span className={`dot dot--${d.available ? d.status : 'paused'}`} aria-hidden="true" />
                <span className="offering__model">{d.model}</span>
                {!d.available && <span className="muted">paused</span>}
              </span>
              <span className="offering__sub">{d.hostLabel} · {statusLabel[d.status]}</span>
            </button>
          ))}
        </aside>

        {selected ? (
          // Keyed so edits reset when switching offerings.
          <DeploymentDetail key={selected.offeringId} deployment={selected} onSaved={replace} saveDeployment={saveDeployment} />
        ) : (
          <p className="card muted">Register an endpoint to start bidding.</p>
        )}
      </div>

      <RegisterDialog open={registerOpen} onClose={() => setRegisterOpen(false)} probeEndpoint={probeEndpoint} />
    </div>
  );
}

function DeploymentDetail({
  deployment: d,
  onSaved,
  saveDeployment,
}: {
  deployment: ProviderDeployment;
  onSaved: (d: ProviderDeployment) => void;
  saveDeployment: ProviderConsoleProps['saveDeployment'];
}) {
  const [policy, setPolicy] = useState(d.bidPolicy);
  const [simInFlight, setSimInFlight] = useState(d.inFlight);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(policy) !== JSON.stringify(d.bidPolicy);
  const quote = quoteBid(policy, { available: d.available, status: d.status, inFlight: simInFlight });
  const warnings = deploymentWarnings({ ...d, bidPolicy: policy });

  const set = <K extends keyof BidPolicy>(key: K, value: BidPolicy[K]) => setPolicy((p) => ({ ...p, [key]: value }));

  function persist(patch: { available?: boolean; bidPolicy?: BidPolicy }) {
    setMessage(null);
    startTransition(async () => {
      const r = await saveDeployment(d.offeringId, patch);
      if (!r.ok) return setMessage({ tone: 'error', text: r.error });
      // Demo mode echoes the seed record, so merge onto what this session already shows.
      onSaved(r.persisted ? r.deployment : { ...d, ...patch });
      setMessage({ tone: 'ok', text: r.persisted ? 'Saved.' : 'Applied for this session — demo mode doesn’t persist changes.' });
    });
  }

  return (
    <main className="providers__detail">
      <section aria-label="Connection" className="card stack">
        <div className="row">
          <h2 className="detail-title">{d.model}</h2>
          <span className="muted">{d.hostLabel}</span>
          <span className={`pill pill--${d.status}`}>{statusLabel[d.status]}</span>
          <span className="spacer" />
          <span id="avail-label" className="muted">Accepting bids</span>
          <button
            type="button"
            role="switch"
            className="switch"
            aria-checked={d.available}
            aria-labelledby="avail-label"
            disabled={pending}
            onClick={() => persist({ available: !d.available })}
          >
            <span className="switch__knob" />
          </button>
        </div>
        <div className="row row--wrap">
          <span className="muted small">Probed features</span>
          <FeatureChips features={d.features} />
          <span className="spacer" />
          <span className="muted small">Last check {d.lastCheckedAt ?? '—'}</span>
          <button type="button" className="btn-secondary">Check connection</button>
        </div>
        {warnings.map((w) => (
          <p key={w} className="notice notice--block">{w}</p>
        ))}
      </section>

      <section aria-label="Bid strategy" className="card bid">
        <div className="bid__form">
          <div className="row">
            <h2>Bid strategy</h2>
            <div role="radiogroup" aria-label="Bid strategy" className="tabs">
              {strategies.map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={policy.strategy === s.id} onClick={() => set('strategy', s.id)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <p className="muted small">{strategies.find((s) => s.id === policy.strategy)!.help}</p>
          <div className="field-grid field-grid--4">
            <NumberField label="Input $/Mtok" value={policy.inputUsdPerMtok} step={0.05} onChange={(v) => set('inputUsdPerMtok', v)} />
            <NumberField label="Output $/Mtok" value={policy.outputUsdPerMtok} step={0.05} onChange={(v) => set('outputUsdPerMtok', v)} />
            <NumberField label="Floor in $/Mtok" value={policy.floorInputUsdPerMtok} step={0.05} onChange={(v) => set('floorInputUsdPerMtok', v)} />
            <NumberField label="Floor out $/Mtok" value={policy.floorOutputUsdPerMtok} step={0.05} onChange={(v) => set('floorOutputUsdPerMtok', v)} />
          </div>
          {policy.strategy === 'bounded-discount' && (
            <RangeField label="Max discount" value={policy.maxDiscountPct} max={50} step={5} unit="%" onChange={(v) => set('maxDiscountPct', v)} />
          )}
          {policy.strategy === 'capacity-adjusted' && (
            <>
              <RangeField label="Surcharge at full load" value={policy.surchargeAtFullPct} max={100} step={5} unit="%" onChange={(v) => set('surchargeAtFullPct', v)} />
              <RangeField label="Requests in flight (preview)" value={Math.min(simInFlight, policy.capacity)} max={policy.capacity} step={1} onChange={setSimInFlight} />
            </>
          )}
          <div className="field-grid field-grid--2">
            <NumberField label="Capacity (concurrent)" value={policy.capacity} step={1} min={1} onChange={(v) => set('capacity', Math.round(v))} />
            <NumberField label="Simulated delay (ms)" value={policy.simulatedDelayMs} step={10} onChange={(v) => set('simulatedDelayMs', v)} />
          </div>
          <div className="row">
            <button type="button" className="btn-primary" disabled={!dirty || pending} onClick={() => persist({ bidPolicy: policy })}>
              {pending ? 'Saving…' : 'Save changes'}
            </button>
            {dirty && <button type="button" className="btn-secondary" onClick={() => setPolicy(d.bidPolicy)}>Discard</button>}
            {message && <span role="status" className={message.tone === 'error' ? 'error small' : 'muted small'}>{message.text}</span>}
          </div>
        </div>

        <div aria-live="polite" className={`quote ${quote.bids ? 'quote--on' : ''}`}>
          <span className="muted small">Next bid would quote</span>
          {quote.bids ? (
            <dl className="quote__values">
              <dt>Input</dt><dd>${quote.inputUsdPerMtok.toFixed(2)}</dd>
              <dt>Output</dt><dd>${quote.outputUsdPerMtok.toFixed(2)}</dd>
            </dl>
          ) : (
            <strong className="quote__none">No bid</strong>
          )}
          <span className="small">{quote.reason}</span>
          <span className="fine">Per Mtok. Demo offers only — not a discount any vendor honors.</span>
        </div>
      </section>

      <section aria-label="Recent auctions" className="card stack">
        <div className="row">
          <h2>Recent auctions</h2>
          <span className="muted">
            {d.recentAuctions.length
              ? `${d.recentAuctions.filter((a) => a.outcome === 'won').length} won of ${d.recentAuctions.length} invitations`
              : 'No invitations'}
          </span>
          <span className="spacer" />
          <span className="muted small">Invitations are sealed: you see auction IDs, never prompts or who else bid.</span>
        </div>
        {d.recentAuctions.length ? (
          <table className="table">
            <thead><tr><th>When</th><th>Auction</th><th>Bid arrived</th><th>Quoted in / out</th><th>Outcome</th></tr></thead>
            <tbody>
              {d.recentAuctions.map((a, i) => (
                <tr key={`${a.auctionId}-${i}`}>
                  <td className="muted">{a.at ?? '—'}</td>
                  <td className="mono">{a.auctionId}</td>
                  <td className="mono">{a.arrivedMs} ms</td>
                  <td className="mono">{fmtQuote(a.quotedInputUsdPerMtok)} / {fmtQuote(a.quotedOutputUsdPerMtok)}</td>
                  <td className={a.outcome === 'won' ? 'ok strong' : a.outcome === 'late' ? 'danger' : 'muted'}>{outcomeLabel[a.outcome]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No invitations yet — this offering hasn’t passed a connection check.</p>
        )}
      </section>

      <section className="card details">
        <Disclosure title="Endpoint & model details" hint="Version, limits, credentials">
          <dl className="kv kv--wide">
            <dt>Endpoint</dt><dd>{d.endpoint ?? 'provider default'}</dd>
            <dt>Model version</dt><dd>{d.modelVersion}</dd>
            <dt>Context · output limit</dt>
            <dd>{d.contextTokens ? fmtTokens(d.contextTokens) : '—'} · {d.outputTokens ? fmtTokens(d.outputTokens) : '—'}</dd>
            <dt>Credentials</dt>
            <dd>{d.secretRef} <span className="sans muted">· stored server-side, never sent to the browser, traces or other bidders</span></dd>
            <dt>Offering ID</dt><dd>{d.offeringId}</dd>
          </dl>
        </Disclosure>
      </section>
    </main>
  );
}

function RegisterDialog({ open, onClose, probeEndpoint }: { open: boolean; onClose: () => void; probeEndpoint: ProviderConsoleProps['probeEndpoint'] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const empty: EndpointDraft = { kind: 'openai-compatible', modelId: '', endpoint: '', secretRef: '' };
  const [draft, setDraft] = useState(empty);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [pending, startTransition] = useTransition();
  const needsUrl = draft.kind === 'openai-compatible' || draft.kind === 'hosted-open';

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      setDraft(empty);
      setProbe(null);
      el.showModal();
    } else if (!open && el.open) el.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const edit = <K extends keyof EndpointDraft>(k: K, v: EndpointDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setProbe(null); // Any change invalidates the last check.
  };

  return (
    <dialog ref={ref} className="dialog" aria-labelledby="reg-title" onClose={onClose}>
      <div className="row">
        <h2 id="reg-title" className="dialog__title">Register an endpoint</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>×</button>
      </div>
      <label className="field">
        Provider type
        <select className="select" value={draft.kind} onChange={(e) => edit('kind', e.target.value as ProviderKind)}>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="google">Google</option>
          <option value="hosted-open">Hosted open-model provider</option>
          <option value="openai-compatible">OpenAI-compatible (vLLM, Ollama…)</option>
        </select>
      </label>
      <label className="field">
        Model ID
        <input className="input mono" value={draft.modelId} onChange={(e) => edit('modelId', e.target.value)} placeholder="[model-id]" />
      </label>
      {needsUrl && (
        <label className="field">
          Endpoint URL
          <input className="input mono" type="url" value={draft.endpoint} onChange={(e) => edit('endpoint', e.target.value)} placeholder="https://inference.example.com/v1" />
          <span className="small">Hosted mode blocks private and loopback addresses. Local endpoints only work when Vispr runs locally.</span>
        </label>
      )}
      <label className="field">
        Secret reference
        <input className="input mono" value={draft.secretRef} onChange={(e) => edit('secretRef', e.target.value)} placeholder="secret://providers/[name]" />
        <span className="small">Kept server-side. Bid strategy and rates can be set after registering.</span>
      </label>

      {probe && !probe.ok && <p role="alert" className="error">{probe.error}</p>}
      {probe?.ok && (
        <div className="probe">
          <strong>Connection check</strong>
          <dl className="kv">
            {(Object.keys(featureLabel) as ProbedFeature[]).map((f) => (
              <FeatureResult key={f} name={featureLabel[f]} ok={probe.features[f]} />
            ))}
          </dl>
          <p className="fine">Only features that passed are declared. Requests needing the others won’t be routed here.</p>
        </div>
      )}

      <div className="row row--end">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="btn-secondary btn-secondary--accent"
          disabled={pending}
          onClick={() => startTransition(async () => setProbe(await probeEndpoint(draft)))}
        >
          {pending ? 'Checking…' : 'Test connection'}
        </button>
        {/* TODO(milestone 3): registerDeployment server action; enabled only after a passing check. */}
        <button type="button" className="btn-primary" disabled={!probe?.ok} onClick={onClose}>Register</button>
      </div>
    </dialog>
  );
}

function FeatureChips({ features }: { features: FeatureSet }) {
  return (
    <>
      {(Object.keys(featureLabel) as ProbedFeature[]).map((f) => (
        <span key={f} className={`feature ${features[f] ? 'feature--on' : ''}`}>
          {features[f] ? '✓' : '—'} {featureLabel[f]}
        </span>
      ))}
    </>
  );
}

function FeatureResult({ name, ok }: { name: string; ok: boolean }) {
  return (
    <>
      <dt>{name}</dt>
      <dd className={ok ? 'ok' : 'muted'}>{ok ? 'supported' : 'not detected'}</dd>
    </>
  );
}

function NumberField({ label, value, step, min = 0, onChange }: { label: string; value: number; step: number; min?: number; onChange: (v: number) => void }) {
  return (
    <label className="field">
      {label}
      <input
        className="input mono"
        type="number"
        inputMode="decimal"
        min={min}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      />
    </label>
  );
}

function RangeField({ label, value, max, step, unit = '', onChange }: { label: string; value: number; max: number; step: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="range-field">
      <span>{label}</span>
      <input type="range" min={0} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="mono num">{value}{unit}</span>
    </label>
  );
}

function fmtQuote(v: number | null) {
  return v === null ? '$[x]' : `$${v.toFixed(2)}`;
}
