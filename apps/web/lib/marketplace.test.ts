import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { demoPolicy, scenarios } from '@vispr/contracts/fixtures';
import type { TraceEvent } from '@vispr/contracts';
import { JEV_REVISION } from '@vispr/routing';
import { prepare, execute } from './platform';
import { RoutingConfigSchema, validateReview } from './marketplace';

const app='00000000-0000-0000-0000-000000000011';
const requestId='00000000-0000-0000-0000-000000000012';
const catalogId='00000000-0000-0000-0000-000000000013';
const deployments=['a','b'].map(id=>({id,modelId:`model-${id}`,providerId:`provider-${id}`,transport:'openrouter' as const,inferenceModelId:`model-${id}`,providerSlug:`provider-${id}`,status:'active' as const,capabilities:{tools:true,structuredOutput:true,vision:false,streaming:true,contextTokens:4096,maxOutputTokens:1500}}));
let calls:string[];
let events:TraceEvent[];
let reserve:number;
let submitted:{id:string;deploymentId:string;reservationToken:string}[];
let released:string[];
let selectedTask:string;
let outage:boolean;
let noQuality:boolean;
let cancelRequested:boolean;
let sourceOnlyB:boolean;
let unknownExecutionCharge:boolean;
let finalized:Record<string,unknown>|undefined;
function config() {
  const now=new Date().toISOString();
  return RoutingConfigSchema.parse({classifier:{model:'jev-1.13.0',inputMicrosPerMillionTokens:42000,contextTokenBound:64000,maximumStateBytes:32000,priceSourceUrl:'https://docs.typesafe.ai/models',priceReviewedAt:now},profiles:Object.fromEntries([...scenarios.map(s=>s.id),'other'].map(task=>[task,[{benchmark:'synthetic-axis',version:'fixture-1',weight:1,minimum:0,maximum:100,higherIsBetter:true,required:true}]])),metrics:Object.fromEntries(deployments.map(d=>[d.id,{inputMicrosPerMillionTokens:1000000,outputMicrosPerMillionTokens:2000000,estimatedCompletionMs:100,observedAt:now,sourceUrl:'https://fixture.invalid/endpoint',bounded:true,queueMs:0,tokensPerSecond:1000,strategy:'fixed'}])),conservativePool:{task:'support',deploymentIds:['b']},maximumEvidenceAgeMs:60000,maximumMetricsAgeMs:60000,confidenceThreshold:.6,...(sourceOnlyB?{sourceRouting:{pools:[{id:'only-b',deploymentIds:['b']}],bindings:[{source:'component-b',poolId:'only-b'}]}}:{})});
}
function catalog() {const now=new Date().toISOString();return {id:catalogId,createdAt:now,deployments,benchmarks:deployments.map(d=>({modelId:d.modelId,benchmark:'synthetic-axis',benchmarkVersion:'fixture-1',value:noQuality?10:d.id==='a'?90:80,sourceUrl:'https://fixture.invalid/benchmark',retrievedAt:now,evidence:'measured' as const}))};}
function choice(value:string,labels:string[]){return {type:'choice',choice:value,confidence:1,probabilities:Object.fromEntries(labels.map(label=>[label,label===value?1:0]))};}
beforeEach(()=>{
  calls=[];events=[];reserve=0;submitted=[];released=[];selectedTask='support';outage=false;noQuality=false;cancelRequested=false;sourceOnlyB=false;unknownExecutionCharge=false;finalized=undefined;
  vi.stubEnv('SUPABASE_URL','https://db.fixture');vi.stubEnv('SUPABASE_SECRET_KEY','sb_secret_fixture');vi.stubEnv('OPENROUTER_API_KEY','fixture-provider');vi.stubEnv('TYPESAFE_API_KEY','fixture-classifier');
  vi.stubGlobal('fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input);const path=new URL(url).pathname;calls.push(path);
    const body=init?.body?JSON.parse(String(init.body)):undefined;
    if(url==='https://api.typesafe.ai/v1/systemone') {
      expect(reserve).toBe(6984); // full 4096 input + 100 output + 64k classifier input, rounded separately.
      expect(body.model).toBe('jev-1.13.0');
      if(outage)return new Response(null,{status:503});
      return Response.json({model:'jev-1.13.0',usage:{input_tokens:100,output_tokens:20},answers:{task:choice(selectedTask,['support','extraction','coding','research','design','other']),complexity:choice('low',['low','medium','high']),continuity:choice('fresh',['fresh','retain','tool_cycle'])}});
    }
    if(url==='https://openrouter.ai/api/v1/chat/completions') {
      expect(events.some(event=>event.type==='award')).toBe(true);
      const awarded=events.filter(event=>event.type==='award').at(-1);
      if(!awarded || awarded.type!=='award')throw new Error('No award');
      const winner=awarded.award.deploymentId;
      expect(body.model).toBe(`model-${winner}`);expect(body.provider).toEqual({only:[`provider-${winner}`],allow_fallbacks:false,require_parameters:true});
      const chunks=[{id:'gen-fixture',provider:`provider-${winner}`,choices:[{index:0,delta:{content:'Live adapter fixture response'},finish_reason:null}]},{id:'gen-fixture',provider:`provider-${winner}`,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5,...(unknownExecutionCharge?{}:{cost:.0001})}}];
      return new Response(chunks.map(chunk=>`data: ${JSON.stringify(chunk)}\n\n`).join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
    }
    if(path.endsWith('/api_keys'))return Response.json([{application_id:app}]);
    if(path.endsWith('/applications'))return Response.json([{id:app,owner_user_id:'owner',organization_id:'org',default_policy_id:'balanced'}]);
    if(path.endsWith('/memberships'))return Response.json([{role:'owner'}]);
    if(path.endsWith('/policy_versions'))return Response.json([{version:1,policy:{...demoPolicy,auctionDeadlineMs:60}}]);
    if(path.endsWith('/routing_configs'))return Response.json([{catalog_snapshot_id:catalogId,config:config()}]);
    if(path.endsWith('/catalog_snapshots'))return Response.json([{id:catalogId,snapshot:catalog()}]);
    if(path.endsWith('/provider_deployments'))return Response.json(deployments.map(d=>({id:d.id,deployment:d,base_url:'https://openrouter.ai/api/v1',secret_reference:'OPENROUTER_API_KEY',capacity:2,verified_at:new Date().toISOString()})));
    if(path.endsWith('/rpc/begin_execution')){reserve=Number(body.p_amount);return Response.json(requestId);}
    if(path.endsWith('/rpc/authorize_classification'))return Response.json(!cancelRequested);
    if(path.endsWith('/inference_requests'))return Response.json(init?.method==='PATCH'?[]:[{status:'bidding',cancel_requested:cancelRequested}]);
    if(path.endsWith('/trace_events')){events.push(body.event);return Response.json([]);}
    if(path.endsWith('/auctions'))return Response.json([]);
    if(path.endsWith('/rpc/acquire_capacity'))return Response.json(`token-${body.p_deployment}`);
    if(path.endsWith('/rpc/submit_bid')){submitted.push(body.p_bid);return Response.json(null);}
    if(path.endsWith('/rpc/award_auction')){expect(submitted.some(bid=>bid.id===body.p_bid)).toBe(true);return Response.json(!cancelRequested);}
    if(path.endsWith('/rpc/mark_dispatched'))return Response.json(!cancelRequested);
    if(path.endsWith('/rpc/release_capacity')){released.push(body.p_token);return Response.json(null);}
    if(path.endsWith('/rpc/finish_execution')){finalized=body;return Response.json(null);}
    throw new Error(`Unexpected path ${path}`);
  });
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
async function prepared(source?:string){return prepare(new Request('https://vispr.fixture',{headers:{Authorization:'Bearer vispr_fixture'}}),{policyId:'balanced',idempotencyKey:crypto.randomUUID(),messages:[{role:'user',content:`${selectedTask} ${crypto.randomUUID()}`}],maxOutputTokens:100,...(source?{source}:{})});}
it.each(scenarios.map(s=>s.id))('routes %s through assessment, pool, bids, atomic award and pinned execution',async task=>{
  selectedTask=task;
  const run=await prepared();const received=[];
  for await(const event of execute(run,new AbortController().signal))received.push(event);
  expect(received.map(event=>event.type).slice(0,5)).toEqual(['assessment','candidates','bid','bid','award']);
  expect(received[0]).toMatchObject({assessment:{task,questionVersion:JEV_REVISION}});
  expect(received.at(-1)?.type).toBe('completed');expect(received.map(event=>event.sequence)).toEqual(received.map((_,index)=>index));
  expect(calls.indexOf('/rest/v1/rpc/begin_execution')).toBeLessThan(calls.indexOf('/v1/systemone'));
  expect(calls.indexOf('/rest/v1/rpc/award_auction')).toBeLessThan(calls.indexOf('/api/v1/chat/completions'));
  expect(released.sort()).toEqual(['token-a','token-b']);expect(finalized?.p_status).toBe('completed');
});
it('honors source restrictions through auction and execution',async()=>{sourceOnlyB=true;const run=await prepared('component-b');for await(const _ of execute(run,new AbortController().signal)){}expect(events.find(event=>event.type==='award')).toMatchObject({award:{deploymentId:'b'}});expect(submitted.map(bid=>bid.deploymentId)).toEqual(['b']);});
it('uses a labeled conservative pool during classifier outage without inventing an assessment',async()=>{outage=true;const run=await prepared();for await(const _ of execute(run,new AbortController().signal)){}expect(events[0]?.type).toBe('candidates');expect(events.find(event=>event.type==='award')).toMatchObject({award:{deploymentId:'b'}});});
it('stops before bidding and dispatch when quality fails',async()=>{noQuality=true;const run=await prepared();for await(const _ of execute(run,new AbortController().signal)){}expect(events.at(-1)).toMatchObject({type:'error',code:'NO_ELIGIBLE_MODELS'});expect(submitted).toHaveLength(0);expect(calls).not.toContain('/api/v1/chat/completions');});
it('releases awarded capacity when cancelled at the award boundary, without dispatch',async()=>{
  const run=await prepared();const iterator=execute(run,new AbortController().signal)[Symbol.asyncIterator]();
  let next;do{next=await iterator.next();}while(!next.done && next.value.type!=='award');
  await iterator.return?.();expect(calls).not.toContain('/api/v1/chat/completions');expect(released.sort()).toEqual(['token-a','token-b']);expect(finalized?.p_status).toBe('cancelled');
});
it('keeps executing capacity occupied while provider billing is uncertain',async()=>{unknownExecutionCharge=true;const run=await prepared();for await(const _ of execute(run,new AbortController().signal)){}expect(released).toEqual(['token-b']);expect(finalized?.p_usage).toMatchObject({reconciliation:'pending',actualCostMicros:null});});
it('rejects missing or stale endpoint evidence at the publication boundary',()=>{const review=config();delete review.metrics.a;expect(()=>validateReview(catalog(),review)).toThrow('Endpoint cost');const stale=config();stale.metrics.a!.observedAt='2000-01-01T00:00:00Z';expect(()=>validateReview(catalog(),stale)).toThrow('Endpoint cost');});
