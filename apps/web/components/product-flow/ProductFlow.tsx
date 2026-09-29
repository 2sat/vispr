'use client';
import { useEffect, useState, type CSSProperties } from 'react';
import { phases } from './flow-data';
import './product-flow.css';

export function ProductFlow() {
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
    <header className="product-flow__heading"><div><p className="eyebrow">THE PRODUCT / COUNTERPARTIES & INTERFACES</p><h1>Follow a request through Vispr.</h1><p>From an app’s approved model region to a provider’s response.</p></div><span className="product-flow__mode">Illustrated sequence · no requests dispatched</span></header>
    <div className="product-flow__layout">
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
    </div>
  </main>;
}
