import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { PolicySchema, DeploymentSchema } from '@vispr/contracts';
import { issueApiKey } from '@vispr/db';
import { reconcileOpenRouter } from '@vispr/providers';
import { database, errorResponse, PlatformError } from '../../../../lib/platform';
import { operator } from '../../../../lib/operator';
export const runtime='nodejs';
export const maxDuration=60;
const Input=z.discriminatedUnion('action',[
  z.strictObject({action:z.literal('provision')}),
  z.strictObject({action:z.literal('sources')}),
  z.strictObject({action:z.literal('reconcile'),applicationId:z.uuid(),requestId:z.uuid()}),
]);
export async function POST(req:Request) {
  try {
    operator(req);
    const input=Input.parse(await req.json());
    const db=database();
    if(input.action==='sources') {
      const key=process.env.ARTIFICIAL_ANALYSIS_API_KEY;
      if(!key)throw new PlatformError('NOT_CONFIGURED','Benchmark source credential missing',503);
      const response=await fetch('https://artificialanalysis.ai/api/v2/data/llms/models',{headers:{'x-api-key':key},redirect:'error',signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw new PlatformError('NOT_CONFIGURED',`Benchmark source returned HTTP ${response.status}`,503);
      const text=await response.text();
      if(Buffer.byteLength(text)>5_000_000)throw new PlatformError('NOT_CONFIGURED','Benchmark response exceeds staging limit',503);
      return Response.json({sourceUrl:'https://artificialanalysis.ai/api/v2/data/llms/models',retrievedAt:new Date().toISOString(),attribution:'Artificial Analysis',data:JSON.parse(text)},{headers:{'Cache-Control':'no-store'}});
    }
    if(input.action==='reconcile') {
      const rows=await db.call<{id:string;application_id:string;generation_id:string|null;usage:Record<string,unknown>|null;status:string;serving_identity:string|null}[]>(`inference_requests?id=eq.${input.requestId}&application_id=eq.${input.applicationId}&select=id,application_id,generation_id,usage,status,serving_identity`);
      const row=rows[0];
      if(!row?.generation_id || !['completed','failed','cancelled'].includes(row.status))throw new PlatformError('INVALID_REQUEST','Request is unavailable for reconciliation');
      const key=process.env.OPENROUTER_API_KEY;
      if(!key)throw new PlatformError('NOT_CONFIGURED','Provider credential missing',503);
      const cost=await reconcileOpenRouter(row.generation_id,key);
      if(cost===null)return Response.json({requestId:row.id,reconciliation:'pending'},{headers:{'Cache-Control':'no-store'}});
      await db.rpc('finish_execution',{p_app:row.application_id,p_request:row.id,p_status:row.status,p_usage:{...row.usage,actualCostMicros:cost,reconciliation:'settled'}});
      await db.rpc('release_request_capacity',{p_app:row.application_id,p_request:row.id});
      return Response.json({requestId:row.id,generationId:row.generation_id,servingIdentity:row.serving_identity,vendorCostMicros:cost,reconciliation:'settled'},{headers:{'Cache-Control':'no-store'}});
    }
    const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
    if(!secret)throw new PlatformError('NOT_CONFIGURED','Identity credential missing',503);
    const supabase=createClient(db.url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
    const email=`demo-${randomUUID()}@vispr.invalid`;
    const password=randomBytes(24).toString('base64url');
    // Operator-created and confirmed: no invitation or other message is sent.
    const {data,error}=await supabase.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{vispr_demo:true}});
    if(error || !data.user)throw new PlatformError('NOT_CONFIGURED','Demo identity creation failed',503);
    const userId=data.user.id;
    const organizationId=randomUUID();
    await db.call('organizations',{method:'POST',body:JSON.stringify({id:organizationId,name:'Vispr acceptance demo'})});
    await db.call('memberships',{method:'POST',body:JSON.stringify({organization_id:organizationId,user_id:userId,role:'owner'})});
    const policy=PolicySchema.parse({id:'acceptance',version:1,weights:{quality:.6,cost:.25,latency:.15},requestBudgetMicros:250000,dailyBudgetMicros:10000000,maxOutputTokens:256,maxLatencyMs:55000,minimumQuality:.5,allowIncompleteCoverage:false,uncertaintyPenalty:.15,maxCandidates:5,auctionDeadlineMs:1500,bidVisibility:'dark',continuity:'fresh',retainPayloads:true});
    const applicationId=await db.rpc<string>('create_application',{p_org:organizationId,p_owner:userId,p_name:'Live acceptance',p_policy:policy});
    const api=issueApiKey();
    await db.call('api_keys',{method:'POST',body:JSON.stringify({application_id:applicationId,key_hash:api.hash,prefix:api.prefix})});
    // Refresh concrete endpoint inventory before certifying the limited text-only first call.
    const sourceUrl='https://openrouter.ai/api/v1/models/meta-llama/llama-4-scout-17b-16e-instruct/endpoints';
    const response=await fetch(sourceUrl,{redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new PlatformError('NOT_CONFIGURED','Endpoint inventory unavailable',503);
    const inventory=await response.json() as {data:{id:string;endpoints:{tag:string;provider_name:string;context_length:number;max_completion_tokens:number;pricing:Record<string,unknown>;supported_parameters:string[]}[]}};
    const endpoint=inventory.data.endpoints.find(endpoint=>endpoint.tag==='deepinfra/fp8');
    if(!endpoint || endpoint.context_length<4096 || endpoint.max_completion_tokens<256 || !endpoint.supported_parameters.includes('max_tokens') || Object.keys(endpoint.pricing).some(key=>!['prompt','completion','discount'].includes(key)) || Number(endpoint.pricing.discount)!==0)throw new PlatformError('NOT_CONFIGURED','Endpoint requires renewed bound review',503);
    const inputRate=Math.ceil(Number(endpoint.pricing.prompt)*1e12);
    const outputRate=Math.ceil(Number(endpoint.pricing.completion)*1e12);
    if(!Number.isSafeInteger(inputRate)||!Number.isSafeInteger(outputRate)||inputRate<0||outputRate<0)throw new PlatformError('NOT_CONFIGURED','Invalid endpoint prices',503);
    const providerId=randomUUID();
    const deployment=DeploymentSchema.parse({id:`acceptance-${providerId}`,modelId:inventory.data.id,providerId,transport:'openrouter',inferenceModelId:inventory.data.id,providerSlug:endpoint.tag,status:'active',capabilities:{streaming:true,tools:false,structuredOutput:endpoint.supported_parameters.includes('structured_outputs'),vision:false,contextTokens:4096,maxOutputTokens:256}});
    await db.call('providers',{method:'POST',body:JSON.stringify({id:providerId,organization_id:organizationId,manager_user_id:userId,name:endpoint.provider_name,transport:'openrouter',status:'active',secret_reference:'OPENROUTER_API_KEY'})});
    await db.call('provider_deployments',{method:'POST',body:JSON.stringify({id:deployment.id,provider_id:providerId,deployment,base_url:'https://openrouter.ai/api/v1',secret_reference:'OPENROUTER_API_KEY',capacity:2,verified_at:new Date().toISOString()})});
    await db.call('execution_offerings',{method:'POST',body:JSON.stringify({application_id:applicationId,policy_id:policy.id,policy_version:policy.version,deployment,base_url:'https://openrouter.ai/api/v1',secret_reference:'OPENROUTER_API_KEY',input_micros_per_million:inputRate,output_micros_per_million:outputRate,bounded:true})});
    return Response.json({email,password,userId,organizationId,applicationId,apiKey:api.key,policy,deployment,expectedProvider:endpoint.provider_name,inventoryEvidence:{sourceUrl,retrievedAt:new Date().toISOString(),endpoint}}, {status:201,headers:{'Cache-Control':'no-store'}});
  } catch(error) {return errorResponse(error);}
}
