'use client';

import { useEffect, useRef, useState } from 'react';
import { InferenceRequestSchema, PolicySchema, type InferenceRequest, type Policy } from '@vispr/contracts';
import { demoPolicy, scenarios } from '@vispr/contracts/fixtures';
import { appendEvent, cancelRun, fixtureEvents, type RunView } from './fixture-run';
import { TraceViewer } from './trace-viewer';

type Snapshot = { request: InferenceRequest; policy: Policy; scenarioId: string };
export function Workspace() {
  const [selected, setSelected] = useState(scenarios[0]!);
  const [prompt, setPrompt] = useState(scenarios[0]!.prompt);
  const [policy, setPolicy] = useState<Policy>({ ...demoPolicy, weights: scenarios[0]!.weights });
  const [run, setRun] = useState<RunView | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [view, setView] = useState<'response' | 'request'>('response');
  const [designView, setDesignView] = useState<'preview' | 'source'>('preview');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const parsedPolicy = PolicySchema.safeParse(policy);
  const issues = parsedPolicy.success ? [] : parsedPolicy.error.issues.map(issue => issue.message);
  const playing = run?.status === 'playing';
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  function choose(id: string) {
    const scenario = scenarios.find(item => item.id === id)!;
    setSelected(scenario); setPrompt(scenario.prompt); setPolicy({ ...demoPolicy, weights: scenario.weights }); setRun(null); setSnapshot(null); setView('response');
  }
  function play() {
    if (!parsedPolicy.success || !prompt.trim() || playing) return;
    const requestId = `example-${crypto.randomUUID()}`;
    const request = InferenceRequestSchema.parse({ policyId: policy.id, idempotencyKey: requestId, messages: [{ role: 'user', content: prompt }], maxOutputTokens: policy.maxOutputTokens });
    setSnapshot({ request, policy: parsedPolicy.data, scenarioId: selected.id });
    setRun({ requestId, events: [], output: '', status: 'playing' }); setView('response');
    const events = fixtureEvents(selected.id, requestId, policy.version);
    let position = 0;
    timer.current = setInterval(() => {
      const event = events[position++];
      if (event) setRun(current => current ? appendEvent(current, event) : current);
      if (position >= events.length && timer.current) { clearInterval(timer.current); timer.current = null; }
    }, 300);
  }
  function cancel() {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    setRun(current => current ? cancelRun(current) : current);
  }
  function download() {
    if (!snapshot || !run) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ mode: 'synthetic-fixture', snapshot, ...run }, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${run.requestId}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <main className="app-shell">
    <header className="topbar"><a className="brand" href="/">vispr<span>INFERENCE MARKETPLACE</span></a><div className="environment"><span className="status-dot" /> Fixture workspace <span className="badge">UI / 01</span></div></header>
    <section className="workspace-heading"><div><p className="eyebrow">THE PLAYGROUND</p><h1>One request. A field of possibilities.</h1><p>Explore the path from task to model to response.</p></div><div className="budget"><small>DEMO LIMITS · NOT CONNECTED</small><strong>$10 <span>/ day</span><i /> $0.25 <span>/ request</span></strong></div></section>
    <aside className="fixture-notice"><span aria-hidden="true">◈</span><p><strong>Example playback.</strong> All assessments, offers and responses are synthetic. No model calls or charges. Draft edits are captured below; they do not change the scripted example outcome.</p></aside>
    <section className="scenario-bar" aria-label="Choose a scenario">{scenarios.map((scenario, index) => <button key={scenario.id} aria-pressed={selected.id === scenario.id} disabled={playing} onClick={() => choose(scenario.id)}><span>0{index + 1}</span>{scenario.title}</button>)}</section>
    <div className="workspace-grid"><section className="request-column" aria-label="Request workspace">
      <div className="panel composer"><div className="panel-heading"><h2>Request</h2><span>{selected.emphasis}</span></div><label className="sr-only" htmlFor="prompt">Request prompt</label><textarea id="prompt" value={prompt} disabled={playing} onChange={event => setPrompt(event.target.value)} /><div className="composer-footer"><span>Editable draft · text input</span><div>{playing ? <button className="secondary" onClick={cancel}>Stop playback</button> : <button className="primary" disabled={!prompt.trim() || !parsedPolicy.success} onClick={play}>Play example trace <span aria-hidden="true">↗</span></button>}</div></div></div>
      <details className="panel policy-panel"><summary><span>Application preferences <small>Local draft</small></span><span className="weight-summary">{Math.round(policy.weights.quality * 100)} / {Math.round(policy.weights.cost * 100)} / {Math.round(policy.weights.latency * 100)}</span></summary><fieldset disabled={playing}><legend className="sr-only">Routing preferences</legend><p className="field-note">Quality / cost / latency percentages must total 100. These controls prepare the shared policy contract for live integration.</p><div className="field-grid">{(['quality', 'cost', 'latency'] as const).map(axis => <label key={axis}>{axis} %<input type="number" min="0" max="100" value={Math.round(policy.weights[axis] * 100)} onChange={event => setPolicy({ ...policy, weights: { ...policy.weights, [axis]: Number(event.target.value) / 100 } })} /></label>)}<label>Request limit ($)<input type="number" step="0.01" min="0.01" max="10" value={policy.requestBudgetMicros / 1e6} onChange={event => setPolicy({ ...policy, requestBudgetMicros: Math.round(Number(event.target.value) * 1e6) })} /></label><label>Output token limit<input type="number" min="1" value={policy.maxOutputTokens} onChange={event => setPolicy({ ...policy, maxOutputTokens: Number(event.target.value) })} /></label><label>Continuity<select value={policy.continuity} onChange={event => setPolicy({ ...policy, continuity: event.target.value as Policy['continuity'] })}><option value="auto">Jev decides</option><option value="fresh">Fresh auction</option><option value="retain">Keep deployment</option></select></label></div><label className="checkbox"><input type="checkbox" checked={policy.allowIncompleteCoverage} onChange={event => setPolicy({ ...policy, allowIncompleteCoverage: event.target.checked })} />Allow incomplete benchmark coverage</label><label className="checkbox"><input type="checkbox" checked={policy.retainPayloads} onChange={event => setPolicy({ ...policy, retainPayloads: event.target.checked })} />Retain payloads when live history is connected</label><p className="field-note">Drafts and playback exist only in this page; nothing is persisted.</p>{issues.length > 0 && <p role="alert" className="validation-error">{[...new Set(issues)].join('. ')}</p>}</fieldset></details>
      <section className="panel output-panel"><div className="panel-heading"><div className="view-switch" role="group" aria-label="Output view"><button aria-pressed={view === 'response'} onClick={() => setView('response')}>Response</button><button aria-pressed={view === 'request'} onClick={() => setView('request')}>Captured draft</button></div><span role="status">{run ? run.status === 'playing' ? 'Playing example…' : run.status : 'Ready for an example'}</span></div>
        {view === 'request' ? <pre className="request-json">{snapshot ? JSON.stringify(snapshot, null, 2) : 'Your request and policy snapshot will appear here after playback starts.'}</pre> : !run?.output ? <div className="output-empty"><span aria-hidden="true">↳</span><h3>{run?.status === 'cancelled' ? 'Playback stopped.' : 'A response starts with a request.'}</h3><p>{playing ? 'Following the example through assessment and auction…' : 'Choose a task above and play its example trace.'}</p></div> : snapshot?.scenarioId === 'design' ? <><div className="preview-toolbar"><span>Static example · scripts and network disabled</span><button className="text-button" onClick={() => setDesignView(designView === 'preview' ? 'source' : 'preview')}>{designView === 'preview' ? 'View HTML' : 'View preview'}</button></div>{designView === 'preview' ? <iframe title="Design example preview" sandbox="" referrerPolicy="no-referrer" srcDoc={run.output} /> : <pre className="response-text">{run.output}</pre>}</> : <pre className="response-text">{run.output}</pre>}
        {run?.output && <div className="output-footnote">Canned example response · no live inference performed</div>}
      </section>
    </section><aside className="panel trace-panel"><div className="panel-heading"><h2>Request trace</h2><span className="trace-count">{run?.events.length ?? 0} events</span></div><div className="trace-subheading"><span>Illustrative decisions, step by step</span><button className="text-button" disabled={!run || playing} onClick={download}>Export JSON</button></div><TraceViewer events={run?.events ?? []} />{run?.status === 'cancelled' && <p className="cancel-message" role="status">Stopped. Partial trace retained.</p>}</aside></div>
    <footer><span>V0.1 / Product UI workstream</span><span>Shared contracts. Synthetic data. Ready for integration.</span></footer>
  </main>;
}
