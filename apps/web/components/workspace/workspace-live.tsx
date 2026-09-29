'use client';
import './live-workspace.css';
import { useEffect, useRef, useState } from 'react';
import { PolicySchema, type Policy } from '@vispr/contracts';
import { scenarios } from '@vispr/contracts/fixtures';
import { Vispr } from '@vispr/sdk';
import { appendEvent, type RunView } from './run-state';
import { TraceViewer } from './trace-viewer';

export function Workspace({initialApiKey=''}:{initialApiKey?:string}) {
  const [selected,setSelected]=useState(scenarios[0]!);
  const [prompt,setPrompt]=useState(scenarios[0]!.prompt);
  const [key,setKey]=useState(initialApiKey);
  const [policies,setPolicies]=useState<Policy[]>([]);
  const [policyId,setPolicyId]=useState('');
  const [maxOutputTokens,setMaxOutputTokens]=useState(256);
  const [run,setRun]=useState<RunView|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('Connect an application key to load its saved policies.');
  const [traceId,setTraceId]=useState('');
  const [designSource,setDesignSource]=useState(false);
  const controller=useRef<AbortController|null>(null);
  const generation=useRef(0);
  const currentRequest=useRef<string|null>(null);
  const policy=policies.find(policy=>policy.id===policyId);
  useEffect(()=>()=>controller.current?.abort(),[]);
  function client(){return new Vispr({apiKey:key,baseURL:window.location.origin});}
  async function connect() {
    setBusy(true);setMessage('Loading application policies…');
    try {
      const response=await fetch('/api/policies',{headers:{Authorization:`Bearer ${key}`},cache:'no-store'});
      if(!response.ok)throw new Error('Application key is unavailable or its owner is not an invited member.');
      const body=await response.json() as {policies:unknown;defaultPolicyId:string};
      const saved=PolicySchema.array().parse(body.policies);
      setPolicies(saved);setPolicyId(body.defaultPolicyId);
      setMaxOutputTokens(Math.min(256,saved.find(policy=>policy.id===body.defaultPolicyId)?.maxOutputTokens??256));
      setMessage(saved.length?'Connected. Requests use the selected saved policy and may incur charges.':'This application has no saved policies.');
    } catch(error){setPolicies([]);setPolicyId('');setMessage(error instanceof Error?error.message:'Connection failed.');}
    finally{setBusy(false);}
  }
  async function start() {
    if(!policy || busy || !prompt.trim())return;
    const version=++generation.current;
    const abort=new AbortController();controller.current=abort;currentRequest.current=null;
    setRun({requestId:'',events:[],output:'',status:'playing'});setBusy(true);setMessage('Routing request…');
    const sdk=client();
    try {
      for await(const event of sdk.stream({policyId:policy.id,idempotencyKey:crypto.randomUUID(),messages:[{role:'user',content:prompt}],maxOutputTokens,...(selected.id==='extraction'?{outputSchema:{type:'object',properties:{invoice_number:{type:'string'},amount:{type:'number'},currency:{type:'string'}},required:['invoice_number','amount','currency'],additionalProperties:false}}:{})},{signal:abort.signal})) {
        if(version!==generation.current)break;
        currentRequest.current=event.requestId;setTraceId(event.requestId);
        setRun(state=>state?appendEvent(state.requestId?state:{...state,requestId:event.requestId},event):state);
        if(event.type==='error')setMessage(event.message);
        else if(event.type==='completed')setMessage('Completed. Usage and routing evidence are in the persisted trace.');
      }
    } catch(error){
      if(version===generation.current){setMessage(abort.signal.aborted?'Request cancelled. Dispatched charges may need reconciliation.':error instanceof Error?error.message:'Request failed.');setRun(state=>state?{...state,status:abort.signal.aborted?'cancelled':'failed'}:state);}
    } finally {if(version===generation.current){setBusy(false);controller.current=null;}}
  }
  async function cancel(){
    const abort=controller.current;
    try{if(currentRequest.current)await client().cancel(currentRequest.current);}
    catch{setMessage('Cancellation could not be confirmed; inspect the persisted trace and billing.');}
    finally{abort?.abort();}
  }
  async function loadTrace(){
    if(busy || !traceId.trim() || !key)return;
    setBusy(true);
    try{
      const events=await client().trace(traceId.trim());
      let view:RunView={requestId:traceId.trim(),events:[],output:'',status:'playing'};
      for(const event of events)view=appendEvent(view,event);
      setRun(view);setMessage(events.at(-1)?.type==='completed'?'Persisted trace loaded.':events.at(-1)?.type==='error'?'Persisted failure trace loaded.':'Trace has no terminal event yet; reload to check progress.');
    }catch(error){setMessage(error instanceof Error?error.message:'Trace unavailable.');}
    finally{setBusy(false);}
  }
  function download(){
    if(!run)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify({mode:'live',policyId,...run},null,2)],{type:'application/json'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download=`${run.requestId||'request'}.json`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  // Sandbox plus an initial CSP blocks scripts, network, forms and navigation in generated HTML.
  const preview=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">${run?.output.replace(/^\s*```(?:html)?\s*\n?|\n?```\s*$/g,'')??''}`;
  return <main className="app-shell live-workspace">
    <header className="topbar"><a className="brand" href="/">vispr<span>INFERENCE MARKETPLACE</span></a><div className="environment">Live workspace</div></header>
    <section className="workspace-heading"><div><p className="eyebrow">THE PLAYGROUND</p><h1>One request. A field of possibilities.</h1><p>Run a saved application policy and inspect its actual request trace.</p></div><div className="budget"><small>SHARED DEMO CEILINGS · UTC DAY</small><strong>$10 <span>/ day</span><i/> $5 <span>/ request</span></strong></div></section>
    <section className="panel composer" aria-label="Application connection"><label htmlFor="application-key">Application API key</label><input id="application-key" type="password" autoComplete="off" value={key} disabled={busy} onChange={event=>{setKey(event.target.value);setPolicies([]);setPolicyId('');}}/><button className="secondary" disabled={!key||busy} onClick={connect}>Connect</button><p className="field-note">The key stays in page memory. Scenarios change the prompt; the saved policy controls routing and spending.</p><p role="status">{message}</p></section>
    <section className="scenario-bar" aria-label="Choose a scenario">{scenarios.map((scenario,index)=><button key={scenario.id} aria-pressed={selected.id===scenario.id} disabled={busy} onClick={()=>{setSelected(scenario);setPrompt(scenario.prompt);setRun(null);}}><span>0{index+1}</span>{scenario.title}</button>)}</section>
    <div className="workspace-grid"><section className="request-column" aria-label="Request workspace">
      <div className="panel composer"><div className="panel-heading"><h2>Request</h2><span>{selected.emphasis}</span></div><label htmlFor="policy">Saved policy</label><select id="policy" value={policyId} disabled={busy} onChange={event=>{setPolicyId(event.target.value);setMaxOutputTokens(Math.min(maxOutputTokens,policies.find(policy=>policy.id===event.target.value)?.maxOutputTokens??256));}}><option value="">Select a policy</option>{policies.map(policy=><option key={policy.id} value={policy.id}>{policy.id} · v{policy.version}</option>)}</select><label htmlFor="output-limit">Maximum output tokens</label><input id="output-limit" type="number" min="1" max={policy?.maxOutputTokens??256} value={maxOutputTokens} disabled={busy} onChange={event=>setMaxOutputTokens(Number(event.target.value))}/><label className="sr-only" htmlFor="prompt">Request prompt</label><textarea id="prompt" value={prompt} disabled={busy} onChange={event=>setPrompt(event.target.value)}/><div className="composer-footer"><span>Real inference · billed to shared account</span>{controller.current?<button className="secondary" onClick={cancel}>Cancel request</button>:<button className="primary" disabled={busy||!policy||!prompt.trim()||!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1||maxOutputTokens>(policy?.maxOutputTokens??0)} onClick={start}>Run request ↗</button>}</div>{policy&&<p className="field-note">Quality {Math.round(policy.weights.quality*100)}% · cost {Math.round(policy.weights.cost*100)}% · latency {Math.round(policy.weights.latency*100)}%. Policy ceiling ${policy.requestBudgetMicros/1e6}/request.</p>}</div>
      <section className="panel output-panel"><div className="panel-heading"><h2>Response</h2><span>{run?.status??'Ready'}</span></div>{!run?.output?<div className="output-empty"><h3>A response starts with a request.</h3><p>Connect an application, choose its policy, and run a task.</p></div>:selected.id==='design'?<><div className="preview-toolbar"><span>Generated HTML · scripts and network disabled</span><button className="text-button" onClick={()=>setDesignSource(!designSource)}>{designSource?'View preview':'View HTML'}</button></div>{designSource?<pre className="response-text">{run.output}</pre>:<iframe title="Generated design preview" sandbox="" referrerPolicy="no-referrer" srcDoc={preview}/>}</>:<pre className="response-text">{run.output}</pre>}</section>
    </section><aside className="panel trace-panel"><div className="panel-heading"><h2>Request trace</h2><span>{run?.events.length??0} events</span></div><div className="trace-subheading"><span>Persisted routing and execution events</span><button className="text-button" disabled={!run||busy} onClick={download}>Export JSON</button></div><label htmlFor="trace-id">Request ID</label><input id="trace-id" value={traceId} disabled={busy} onChange={event=>setTraceId(event.target.value)}/><button className="secondary" disabled={busy||!key||!traceId.trim()} onClick={loadTrace}>Load persisted trace</button><TraceViewer events={run?.events??[]}/></aside></div>
    <footer><span>V0.1 / Live integration</span><span>Simulated bids · real execution charges</span></footer>
  </main>;
}
