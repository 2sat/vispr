import 'server-only';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { Database } from '@vispr/db';
import { CatalogSnapshotSchema, DeploymentSchema, BenchmarkAxisRuleSchema, SourceRoutingSchema, type CatalogSnapshot, type Deployment, type InferenceRequest, type Policy, type TraceEvent } from '@vispr/contracts';
import { AssessmentService, MemoryAssessmentCache, JevClassifier, routeRequest, evaluateOffer, estimateCostMicros, resolveSourcePool, type EndpointMetrics } from '@vispr/routing';
import { collectAuction, createSimulatedBidder } from '@vispr/auction';
import { CompatibleAdapter } from '@vispr/providers';
import { PlatformError } from './platform-error';

const identifier = z.string().min(1).max(200).regex(/^[A-Za-z0-9._:/-]+$/);
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const task = z.enum(['support', 'extraction', 'coding', 'research', 'design', 'other']);
const metric = z.strictObject({ inputMicrosPerMillionTokens: money, outputMicrosPerMillionTokens: money, estimatedCompletionMs: z.number().finite().positive(), observedAt: z.iso.datetime(), sourceUrl: z.url(), bounded: z.literal(true), queueMs: z.number().int().nonnegative(), tokensPerSecond: z.number().finite().positive(), strategy: z.enum(['fixed','discount','capacity']) });
export const RoutingConfigSchema = z.strictObject({
  classifier: z.strictObject({ model: z.string().regex(/^jev-\d+\.\d+\.\d+$/), inputMicrosPerMillionTokens: money, contextTokenBound: z.number().int().min(1).max(64000), maximumStateBytes: z.number().int().min(1).max(32000), priceSourceUrl: z.url(), priceReviewedAt: z.iso.datetime() }),
  profiles: z.partialRecord(task, z.array(BenchmarkAxisRuleSchema).min(1)),
  metrics: z.record(identifier, metric),
  conservativePool: z.strictObject({ task, deploymentIds: z.array(identifier).min(1) }),
  maximumEvidenceAgeMs: z.number().int().positive(), maximumMetricsAgeMs: z.number().int().positive(),
  confidenceThreshold: z.number().min(0).max(1),
  sourceRouting: SourceRoutingSchema.optional(),
});
export type RoutingConfig = z.infer<typeof RoutingConfigSchema>;
type Registered = { id: string; deployment: unknown; base_url: string; secret_reference: string; capacity: number; verified_at: string | null };
export interface MarketplacePlan { catalog: CatalogSnapshot; config: RoutingConfig; registrations: Registered[]; reserveMicros: number; classifierBoundMicros: number }
const cache = new MemoryAssessmentCache();

export function inputBound(request: InferenceRequest): number {
  if (request.messages.some(message => Array.isArray(message.content))) throw new PlatformError('INVALID_REQUEST','Multimodal cost bounds are pending');
  return Buffer.byteLength(JSON.stringify({ messages: request.messages, tools: request.tools, outputSchema: request.outputSchema }), 'utf8') + request.messages.length * 256;
}
function fresh(value: string, age: number) { const time=Date.parse(value); return time<=Date.now() && Date.now()-time<=age; }
export function validateReview(catalog: CatalogSnapshot, config: RoutingConfig) {
  const active = catalog.deployments.filter(deployment => deployment.status === 'active');
  if (!active.length || new Set(catalog.deployments.map(d=>d.id)).size!==catalog.deployments.length) throw new PlatformError('NOT_CONFIGURED','A reviewed pool requires unique active deployments',503);
  if (!fresh(config.classifier.priceReviewedAt, config.maximumMetricsAgeMs)) throw new PlatformError('NOT_CONFIGURED','Classifier pricing needs refresh',503);
  for (const deployment of active) {
    const metric=config.metrics[deployment.id];
    if (!metric || !fresh(metric.observedAt,config.maximumMetricsAgeMs)) throw new PlatformError('NOT_CONFIGURED','Endpoint cost and completion-time evidence needs review',503);
  }
  if (config.conservativePool.deploymentIds.some(id=>!active.some(d=>d.id===id))) throw new PlatformError('NOT_CONFIGURED','Conservative pool references an inactive deployment',503);
  for (const rules of Object.values(config.profiles)) {
    const keys=new Set(rules.map(rule=>JSON.stringify([rule.benchmark,rule.version])));
    if(keys.size!==rules.length) throw new PlatformError('NOT_CONFIGURED','Duplicate benchmark profile',503);
    for (const rule of rules) if (!catalog.benchmarks.some(observation=>observation.benchmark===rule.benchmark && observation.benchmarkVersion===rule.version && fresh(observation.retrievedAt,config.maximumEvidenceAgeMs))) throw new PlatformError('NOT_CONFIGURED','Reviewed benchmark version is missing or stale',503);
  }
  if (!config.profiles[config.conservativePool.task]) throw new PlatformError('NOT_CONFIGURED','Conservative task requires reviewed benchmark axes',503);
}
export function approvedAdapter(row: Registered, deployment: Deployment): CompatibleAdapter {
  const url=new URL(row.base_url);
  const local=process.env.VISPR_ALLOW_LOCAL_ENDPOINTS==='true' && process.env.NODE_ENV!=='production';
  const allowed=(process.env.VISPR_DIRECT_ALLOWED_ORIGINS??'').split(',');
  if (url.username || url.password || url.search || url.hash || (url.protocol!=='https:' && !(local && url.protocol==='http:')) || (deployment.transport==='openrouter' ? row.base_url.replace(/\/$/,'')!=='https://openrouter.ai/api/v1' || row.secret_reference!=='OPENROUTER_API_KEY' : !allowed.includes(url.origin) || !/^VISPR_PROVIDER_[A-Z0-9_]+$/.test(row.secret_reference))) throw new PlatformError('NOT_CONFIGURED','Endpoint is not operator-approved',503);
  const apiKey=process.env[row.secret_reference];
  if(!apiKey || apiKey==='[SENSITIVE]') throw new PlatformError('NOT_CONFIGURED','Provider credential is missing',503);
  return new CompatibleAdapter({apiKey,baseURL:row.base_url,fetch:(input,init)=>fetch(input,{...init,redirect:'error'})});
}
export async function loadMarketplace(db: Database, app: string, policy: Policy, request: InferenceRequest): Promise<MarketplacePlan|null> {
  const rows=await db.call<{ catalog_snapshot_id: string; config: unknown }[]>(`routing_configs?application_id=eq.${app}&policy_id=eq.${encodeURIComponent(policy.id)}&policy_version=eq.${policy.version}&active=eq.true&select=catalog_snapshot_id,config`);
  if(!rows[0]) return null;
  const config=RoutingConfigSchema.parse(rows[0].config);
  const snapshots=await db.call<{id:string;snapshot:unknown}[]>(`catalog_snapshots?id=eq.${rows[0].catalog_snapshot_id}&select=id,snapshot`);
  const catalog=CatalogSnapshotSchema.parse(snapshots[0]?.snapshot);
  if(catalog.id!==rows[0].catalog_snapshot_id) throw new PlatformError('NOT_CONFIGURED','Snapshot identity mismatch',503);
  return prepareMarketplace(db,policy,request,catalog,config);
}
export async function prepareMarketplace(db: Database, policy: Policy, request: InferenceRequest, catalog: CatalogSnapshot, config: RoutingConfig): Promise<MarketplacePlan> {
  validateReview(catalog,config);
  try { catalog=resolveSourcePool(request.source,config.sourceRouting,catalog).catalog; }
  catch { throw new PlatformError('INVALID_REQUEST','Invocation source has no configured pool'); }
  if(!process.env.TYPESAFE_API_KEY) throw new PlatformError('NOT_CONFIGURED','Classifier credential is missing',503);
  const registrations=await db.call<Registered[]>('provider_deployments?select=id,deployment,base_url,secret_reference,capacity,verified_at');
  const bytes=inputBound(request);
  const valid: Registered[]=[];
  const bounds:number[]=[];
  for(const deployment of catalog.deployments.filter(d=>d.status==='active')) {
    const row=registrations.find(r=>r.id===deployment.id);
    if(!row?.verified_at || JSON.stringify(DeploymentSchema.parse(row.deployment))!==JSON.stringify(deployment)) throw new PlatformError('NOT_CONFIGURED','Published deployment differs from verified registration',503);
    approvedAdapter(row,deployment);
    const caps=deployment.capabilities;
    if(bytes+request.maxOutputTokens>caps.contextTokens || request.maxOutputTokens>caps.maxOutputTokens || !caps.streaming || (request.tools?.length && !caps.tools) || (request.outputSchema && !caps.structuredOutput)) continue;
    const rates=config.metrics[deployment.id]!;
    bounds.push(estimateCostMicros(caps.contextTokens,request.maxOutputTokens,rates.inputMicrosPerMillionTokens,rates.outputMicrosPerMillionTokens));
    valid.push(row);
  }
  if(!bounds.length) throw new PlatformError('NO_ELIGIBLE_MODELS','No verified deployment supports this request',422);
  const classifierBoundMicros=estimateCostMicros(config.classifier.contextTokenBound,0,config.classifier.inputMicrosPerMillionTokens,0);
  if(!classifierBoundMicros) throw new PlatformError('NOT_CONFIGURED','Classifier requires a positive funded allowance',503);
  const reserveMicros=Math.max(...bounds)+classifierBoundMicros;
  if(reserveMicros>Math.min(policy.requestBudgetMicros,5000000)) throw new PlatformError('BUDGET_EXCEEDED','Reviewed upstream bounds exceed request budget',429);
  return {catalog:{...catalog,deployments:catalog.deployments.filter(d=>valid.some(r=>r.id===d.id))},config,registrations:valid,reserveMicros,classifierBoundMicros};
}
type WithoutEnvelope<T> = T extends unknown ? Omit<T,'requestId'|'sequence'> : never;
type Decision = WithoutEnvelope<Extract<TraceEvent,{type:'assessment'|'candidates'|'bid'|'award'}>>;
export async function* marketplaceAward(input: {id:string;applicationId:string;request:InferenceRequest;policy:Policy;db:Database;plan:MarketplacePlan;signal:AbortSignal}): AsyncGenerator<Decision,{deployment:Deployment;adapter:CompatibleAdapter;capacityToken:string}> {
  const {id,applicationId,request,policy,db,plan,signal}=input;
  const {config,catalog}=plan;
  let classificationCost:number|null=0;
  const patch=(body:object)=>db.call(`inference_requests?id=eq.${id}&application_id=eq.${applicationId}`,{method:'PATCH',body:JSON.stringify(body)});
  const classifier=new JevClassifier({
    apiKey:process.env.TYPESAFE_API_KEY!,model:config.classifier.model,maximumStateBytes:config.classifier.maximumStateBytes,maxAttempts:1,
    async authorizeAttempt(_,signal) {
      signal.throwIfAborted();
      if(!await db.rpc<boolean>('authorize_classification',{p_app:applicationId,p_request:id,p_bound:plan.classifierBoundMicros})) throw new PlatformError('CANCELLED','Classification was cancelled',409);
      classificationCost=null;
    },
    async recordAttempt(report) {
      if(report.usage && report.usage.inputTokens<=config.classifier.contextTokenBound) classificationCost=estimateCostMicros(report.usage.inputTokens,0,config.classifier.inputMicrosPerMillionTokens,0);
      await patch({classification_cost_micros:classificationCost,routing_metadata:{classificationAttempt:report,classificationCostBasis:'returned input tokens at reviewed TypeSafe rate'}});
    },
  });
  const selection={metrics:config.metrics as Record<string,EndpointMetrics>,profiles:config.profiles,now:Date.now(),maximumEvidenceAgeMs:config.maximumEvidenceAgeMs,maximumMetricsAgeMs:config.maximumMetricsAgeMs,remainingRequestBudgetMicros:policy.requestBudgetMicros-plan.classifierBoundMicros,estimateInputTokens:()=>inputBound(request)};
  const result=await routeRequest({applicationId,request,policy,catalog,context:{unresolvedToolCallIds:[],capabilityContextDigest:createHash('sha256').update(JSON.stringify(catalog.deployments)).digest('hex')},service:new AssessmentService(classifier,cache),selection,remainingBudget:async()=>Math.min(policy.requestBudgetMicros,5000000)-(classificationCost??plan.classifierBoundMicros),...(config.sourceRouting?{sourceRouting:config.sourceRouting}:{}),cacheEnabled:true,confidenceThreshold:config.confidenceThreshold,signal,conservativePool:config.conservativePool});
  await patch({catalog_snapshot_id:catalog.id,routing_metadata:{source:result.source,failure:result.failure,assessment:result.assessment,sourcePool:result.sourcePool,classificationCostBasis:'returned input tokens at reviewed TypeSafe rate'}});
  if(result.assessment) yield {type:'assessment',assessment:result.assessment};
  // Score totals are internal; public events follow the shared strict candidate schema.
  yield {type:'candidates',candidates:result.candidates.map(({score,...candidate})=>candidate)};
  const eligible=result.candidates.filter(candidate=>candidate.eligible);
  if(!eligible.length) throw new PlatformError('NO_ELIGIBLE_MODELS','No model qualifies against reviewed evidence and policy',422);
  signal.throwIfAborted();
  const auctionId=randomUUID();
  const deadline=Date.now()+policy.auctionDeadlineMs;
  await db.call('auctions',{method:'POST',body:JSON.stringify({id:auctionId,application_id:applicationId,request_id:id,deadline:new Date(deadline).toISOString()})});
  await patch({status:'bidding'});
  const tokens=new Map<string,string>();
  let awardedToken:string|undefined;
  let handedOff=false;
  try {
    const registrations=[];
    for(const candidate of eligible) {
      signal.throwIfAborted();
      const row=plan.registrations.find(row=>row.id===candidate.deploymentId)!;
      // Capacity failures are abstentions; deadline/database failures may produce no bids.
      let token:string;
      try { token=await db.rpc<string>('acquire_capacity',{p_deployment:row.id,p_auction:auctionId,p_expires:new Date(deadline+60000).toISOString()}); }
      catch { continue; }
      tokens.set(row.id,token);
      const metric=config.metrics[row.id]!;
      const simulated=createSimulatedBidder({deploymentId:row.id,strategy:metric.strategy,inputRate:metric.inputMicrosPerMillionTokens,outputRate:metric.outputMicrosPerMillionTokens,inputFloor:0,outputFloor:0,capacity:row.capacity,active:0,queueMs:metric.queueMs,tokensPerSecond:metric.tokensPerSecond,validityMs:60000});
      registrations.push({participantId:row.id,deploymentId:row.id,bidder:{async bid(invitation:Parameters<typeof simulated.bid>[0],signal:AbortSignal){
        const bid=await simulated.bid(invitation,signal);
        if(!bid)return null;
        const reserved={...bid,reservationToken:token};
        await db.rpc('submit_bid',{p_id:reserved.id,p_auction:auctionId,p_deployment:row.id,p_token:token,p_bid:reserved,p_valid_until:reserved.validUntil});
        return reserved;
      }}});
    }
    if(Date.now()>=deadline || !registrations.length) throw new PlatformError('NO_BIDS','No capacity available before auction deadline',422);
    const pool=config.sourceRouting?.pools.find(pool=>pool.id===result.sourcePool?.poolId);
    const auction=await collectAuction({auctionId,deadline,registrations,visibility:policy.bidVisibility,...(policy.bidVisibility==='workload'?{workload:{inputTokenBucket:Math.ceil(inputBound(request)/1000)*1000,outputTokenBucket:Math.ceil(request.maxOutputTokens/1000)*1000}}:{}),signal,evaluate(bid){
      const candidate=eligible.find(candidate=>candidate.deploymentId===bid.deploymentId)!;
      return evaluateOffer({bid,policy,inputTokens:inputBound(request),outputTokens:request.maxOutputTokens,remainingRequestBudgetMicros:policy.requestBudgetMicros-(classificationCost??plan.classifierBoundMicros),quality:candidate.quality??0,uncertainty:candidate.quality===null?1:0,observedCompletionMs:config.metrics[bid.deploymentId]!.estimatedCompletionMs,...(pool?.criteria?{poolCriteria:pool.criteria}:{})});
    }});
    for(const ranked of auction.ranked) yield {type:'bid',bid:ranked.bid};
    if(!auction.ranked.length) throw new PlatformError('NO_BIDS','No simulated bid satisfies current policy',422);
    await new Promise<void>((resolve,reject)=>{
      const stop=()=>{clearTimeout(timer);reject(signal.reason);};
      const timer=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve();},Math.max(0,deadline-Date.now()+5));
      if(signal.aborted)stop();else signal.addEventListener('abort',stop,{once:true});
    });
    signal.throwIfAborted();
    const winner=auction.ranked[0]!.bid;
    if(!await db.rpc<boolean>('award_auction',{p_auction:auctionId,p_bid:winner.id})) throw new PlatformError('NO_BIDS','Auction did not produce an atomic award',409);
    awardedToken=winner.reservationToken;
    const deployment=catalog.deployments.find(d=>d.id===winner.deploymentId)!;
    yield {type:'award',award:{auctionId,bidId:winner.id,deploymentId:deployment.id,policyVersion:policy.version,catalogSnapshotId:catalog.id}};
    const adapter=approvedAdapter(plan.registrations.find(row=>row.id===deployment.id)!,deployment);
    handedOff=true;
    return {deployment,adapter,capacityToken:awardedToken};
  } finally {
    // The winner's executing capacity is released only by execution settlement.
    for(const token of tokens.values()) if(token!==awardedToken || !handedOff) await db.rpc('release_capacity',{p_token:token});
    if(!awardedToken) await db.call(`auctions?id=eq.${auctionId}`,{method:'PATCH',body:JSON.stringify({status:signal.aborted?'cancelled':'no_bid'})});
  }
}
