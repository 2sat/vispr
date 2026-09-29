'use client';
import { useEffect, useState, type CSSProperties } from 'react';
import { phases } from './flow-data';
import './product-flow.css';

export function ProductFlow() {
  const [showDetails, setShowDetails] = useState(false);
  const [phaseIndex, setPhaseIndex] = useState(1);
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [reducedMotion, setReducedMotion] = useState(false);
  const phase = phases[phaseIndex]!;
  const step = phase.steps[stepIndex]!;
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { setReducedMotion(media.matches); if (media.matches) setPlaying(false); };
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      if (stepIndex === phase.steps.length - 1) setPlaying(false);
      else setStepIndex(index => index + 1);
    }, 3000 / speed);
    return () => window.clearTimeout(timer);
  }, [playing, stepIndex, phase.steps.length, speed]);
  function jump(index: number) { setPlaying(false); setStepIndex(index); }
  const position = (id: string) => 110 + phase.participants.findIndex(p => p.id === id) * (880 / (phase.participants.length - 1));
  const height = 138 + phase.steps.length * 64;
  return <main className="product-flow">
    <header className="product-flow__heading"><div><p className="eyebrow">THE PRODUCT / COUNTERPARTIES & INTERFACES</p><h1>One request. Providers compete.</h1><p>Pick an eligible pool, collect bids, then run the winner.</p></div><span className="product-flow__mode">Illustrated sequence · no requests dispatched</span></header>
    <section className="core-flow" aria-label="Core inference bidding process">
      <svg className="core-flow__wide" viewBox="0 0 1160 350" role="img" aria-labelledby="core-flow-title core-flow-description">
        <title id="core-flow-title">The core inference bid process</title>
        <desc id="core-flow-description">An app sends a request. Vispr chooses models that meet the task and app limits. Eligible providers bid in parallel. Vispr awards a qualifying bid, runs inference on the winner, and returns the response.</desc>
        <defs><marker id="core-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10Z" fill="currentColor" /></marker></defs>
        <g className="core-flow__edges" markerEnd="url(#core-arrow)">
          <path d="M190 175 H245" />
          <path d="M445 175 H475 V75 H515" /><path d="M445 175 H515" /><path d="M445 175 H475 V275 H515" />
          <path d="M675 75 H715 V175 H760" /><path d="M675 175 H760" /><path d="M675 275 H715 V175 H760" />
          <path d="M940 175 H985" />
        </g>
        <g className="core-flow__node"><rect x="20" y="133" width="170" height="84" rx="12" /><text x="105" y="168">App request</text><text x="105" y="192" className="core-flow__sub">Prompt + policy</text></g>
        <g className="core-flow__node core-flow__primary"><rect x="245" y="123" width="200" height="104" rx="12" /><text x="345" y="159">Pick eligible pool</text><text x="345" y="185" className="core-flow__sub">Task + app limits</text><text x="345" y="206" className="core-flow__sub">Latency · cost · benchmarks</text></g>
        {[{ y: 75, name: 'Provider A' }, { y: 175, name: 'Provider B' }, { y: 275, name: 'Provider C' }].map(provider => <g key={provider.name} className="core-flow__node core-flow__bid"><rect x="515" y={provider.y - 34} width="160" height="68" rx="10" /><text x="595" y={provider.y - 2}>{provider.name}</text><text x="595" y={provider.y + 20} className="core-flow__sub">Submit bid</text></g>)}
        <g className="core-flow__node core-flow__primary"><rect x="760" y="133" width="180" height="84" rx="12" /><text x="850" y="168">Award &amp; run</text><text x="850" y="192" className="core-flow__sub">Winning eligible bid</text></g>
        <g className="core-flow__node"><rect x="985" y="133" width="155" height="84" rx="12" /><text x="1062" y="168">Response</text><text x="1062" y="192" className="core-flow__sub">Stream + trace</text></g>
      </svg>
      <svg className="core-flow__compact" viewBox="0 0 540 500" role="img" aria-label="Request flows to eligible pool, branches to three parallel provider bids, converges on award and inference, then returns a response.">
        <defs><marker id="compact-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10Z" fill="currentColor" /></marker></defs>
        <g className="core-flow__edges" markerEnd="url(#compact-arrow)"><path d="M270 77 V105" /><path d="M270 179 V200 H95 V225" /><path d="M270 179 V225" /><path d="M270 179 V200 H445 V225" /><path d="M95 283 V309 H270 V335" /><path d="M270 283 V335" /><path d="M445 283 V309 H270 V335" /><path d="M270 393 V420" /></g>
        <g className="core-flow__node"><rect x="180" y="19" width="180" height="58" rx="10" /><text x="270" y="43">App request</text><text x="270" y="63" className="core-flow__sub">Prompt + policy</text></g>
        <g className="core-flow__node core-flow__primary"><rect x="140" y="105" width="260" height="74" rx="10" /><text x="270" y="132">Pick eligible pool</text><text x="270" y="157" className="core-flow__sub">Task + latency, cost &amp; benchmark limits</text></g>
        {[{ x: 95, name: 'Provider A' }, { x: 270, name: 'Provider B' }, { x: 445, name: 'Provider C' }].map(provider => <g key={provider.name} className="core-flow__node core-flow__bid"><rect x={provider.x - 74} y="225" width="148" height="58" rx="10" /><text x={provider.x} y="250">{provider.name}</text><text x={provider.x} y="271" className="core-flow__sub">Submit bid</text></g>)}
        <g className="core-flow__node core-flow__primary"><rect x="170" y="335" width="200" height="58" rx="10" /><text x="270" y="360">Award &amp; run</text><text x="270" y="381" className="core-flow__sub">Winning eligible bid</text></g>
        <g className="core-flow__node"><rect x="180" y="420" width="180" height="58" rx="10" /><text x="270" y="445">Response</text><text x="270" y="466" className="core-flow__sub">Stream + trace</text></g>
      </svg>
    </section>
    <div className="core-flow__caption"><p>Every bid must satisfy the app’s limits. No qualifying bid means no dispatch.</p><span>Demo: simulated bids, real inference.</span></div>
    <button type="button" className="core-flow__details-toggle" aria-expanded={showDetails} aria-controls="detailed-product-flow" onClick={() => { setShowDetails(!showDetails); setPlaying(false); }}>{showDetails ? 'Hide detailed interfaces' : 'Explore interfaces & animated sequence'} <span aria-hidden="true">{showDetails ? '−' : '+'}</span></button>
    {showDetails && <div id="detailed-product-flow" className="product-flow__layout">
      <aside className="product-flow__sidebar">
        <div role="tablist" aria-label="Product flow phases" aria-orientation="vertical">{phases.map((item, index) => <button key={item.id} id={`tab-${item.id}`} type="button" role="tab" aria-selected={phaseIndex === index} aria-controls="flow-panel" tabIndex={phaseIndex === index ? 0 : -1} onKeyDown={event => {
          const next = event.key === 'ArrowDown' ? (phaseIndex + 1) % phases.length : event.key === 'ArrowUp' ? (phaseIndex + phases.length - 1) % phases.length : event.key === 'Home' ? 0 : event.key === 'End' ? phases.length - 1 : null;
          if (next !== null) { event.preventDefault(); setPhaseIndex(next); jump(0); document.getElementById(`tab-${phases[next]!.id}`)?.focus(); }
        }} onClick={() => { setPhaseIndex(index); jump(0); }}><span>0{index + 1}</span><strong>{item.title}</strong></button>)}</div>
        <section className="product-flow__detail" aria-live="polite" aria-atomic="true"><p className="eyebrow">STEP {String(stepIndex + 1).padStart(2, '0')} / {phase.steps.length}</p><h2>{step.label}</h2><p>{step.detail}</p><dl><dt>Interface</dt><dd>{step.interface}</dd><dt>What crosses the boundary</dt><dd>{step.payload}</dd><dt>Interaction</dt><dd>{step.kind === 'simulated' ? 'Simulated auction adapter' : step.kind === 'internal' ? 'Internal service / database' : 'API or counterparty interaction'}</dd></dl></section>
      </aside>
      <section id="flow-panel" role="tabpanel" aria-labelledby={`tab-${phase.id}`} className="product-flow__panel">
        <div className="product-flow__intro"><h2>{phase.title}</h2><p>{phase.subtitle}</p></div>
        <div className="product-flow__controls">
          <button type="button" className="btn-primary" onClick={() => { if (!playing && stepIndex === phase.steps.length - 1) setStepIndex(0); setPlaying(!playing); }}>{playing ? 'Pause' : stepIndex === phase.steps.length - 1 ? 'Replay' : 'Play sequence'}</button>
          <button type="button" disabled={stepIndex === 0} onClick={() => jump(stepIndex - 1)} aria-label="Previous step">←</button>
          <button type="button" disabled={stepIndex === phase.steps.length - 1} onClick={() => jump(stepIndex + 1)} aria-label="Next step">→</button>
          <button type="button" onClick={() => jump(0)}>Reset</button>
          <label>Speed <select value={speed} onChange={event => setSpeed(Number(event.target.value))}><option value={.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select></label>
          <span>{stepIndex + 1} / {phase.steps.length}</span>
        </div>
        <label className="product-flow__scrub"><span className="visually-hidden">Sequence step</span><input type="range" min="0" max={phase.steps.length - 1} value={stepIndex} aria-valuetext={`Step ${stepIndex + 1}: ${step.label}`} onChange={event => jump(Number(event.target.value))} /></label>
        <div className="product-flow__diagram" tabIndex={0} role="region" aria-label="Scrollable sequence diagram">
          <svg viewBox={`0 0 1100 ${height}`} role="group" aria-label={`${phase.title}. Select an arrow to inspect its interface.`}>
            <defs><marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker></defs>
            {phase.participants.map(participant => <g key={participant.id}><text x={position(participant.id)} y="34" textAnchor="middle" className="product-flow__actor">{participant.name}</text><text x={position(participant.id)} y="54" textAnchor="middle" className="product-flow__role">{participant.role}</text><line x1={position(participant.id)} x2={position(participant.id)} y1="73" y2={height - 28} className="product-flow__lifeline" /></g>)}
            {phase.steps.map((item, index) => {
              const y = 116 + index * 64, from = position(item.from), to = position(item.to), active = index === stepIndex;
              return <g key={`${phase.id}-${index}`} className={`product-flow__message ${active ? 'is-active' : index < stepIndex ? 'is-complete' : ''} ${item.kind}`} role="button" tabIndex={0} aria-label={`Step ${index + 1}: ${item.label}. ${item.interface}`} aria-pressed={active} onClick={() => jump(index)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); jump(index); } }}>
                <rect x="16" y={y - 31} width="1068" height="56" rx="7" className="product-flow__row" />
                <text x="35" y={y + 5} className="product-flow__number">{String(index + 1).padStart(2, '0')}</text>
                <line x1={from} x2={to} y1={y + 8} y2={y + 8} markerEnd="url(#flow-arrow)" className="product-flow__arrow" />
                <text x={(from + to) / 2} y={y - 5} textAnchor="middle" className="product-flow__label">{item.label}</text>
                {active && playing && !reducedMotion && <circle key={`${phase.id}-${index}-${speed}`} cx={from} cy={y + 8} r="5" className="product-flow__packet" style={{ '--travel': `${to - from}px`, animationDuration: `${3000 / speed}ms` } as CSSProperties} />}
              </g>;
            })}
          </svg>
        </div>
        <div className="product-flow__legend"><span><i />API / counterparty</span><span><i className="internal" />Internal service</span><span><i className="simulated" />Simulated bids</span></div>
        <p className="product-flow__footnote">Select any message to inspect the interface. This illustrates the reviewed routing path, not a live trace. Cache hits skip the Jev call; cancellation is an alternate path.</p>
      </section>
    </div>}
  </main>;
}
