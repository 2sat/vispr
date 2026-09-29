import { demoPolicy, scenarios } from '@vispr/contracts/fixtures';
export default function Home() {
  return <main>
    <header><a className="brand" href="/">vispr<span> / inference marketplace</span></a><span className="badge">Foundation preview</span></header>
    <section className="hero"><p className="eyebrow">THE RIGHT MODEL, FOR THE TASK.</p><h1>Give every request<br />a better route.</h1><p className="intro">Task-aware selection. Competitive offers. One inference interface.</p></section>
    <aside className="notice"><strong>Development scaffold</strong><span>These are sample task briefs. Live inference, auctions and invite-only access are not connected yet. No requests are sent from this page.</span></aside>
    <section aria-labelledby="scenarios"><div className="section-heading"><h2 id="scenarios">Five tasks. Different priorities.</h2><span>SDK + compatible chat API</span></div><div className="grid">{scenarios.map((scenario, index) => <article key={scenario.id}><span className="number">0{index + 1}</span><p className="emphasis">{scenario.emphasis}</p><h3>{scenario.title}</h3><p className="prompt">{scenario.prompt}</p><dl><div><dt>Quality</dt><dd>{Math.round(scenario.weights.quality * 100)}%</dd></div><div><dt>Cost</dt><dd>{Math.round(scenario.weights.cost * 100)}%</dd></div><div><dt>Latency</dt><dd>{Math.round(scenario.weights.latency * 100)}%</dd></div></dl></article>)}</div></section>
    <footer><p>Planned guardrails: ${demoPolicy.dailyBudgetMicros / 1e6}/day · ${demoPolicy.requestBudgetMicros / 1e6}/request</p><p>Jev → eligible pool → auction → pinned execution</p></footer>
  </main>;
}
