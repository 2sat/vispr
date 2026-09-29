import { probeEndpoint } from '@vispr/providers';
import { DeploymentSchema } from '@vispr/contracts';
import { database,dashboardUser,errorResponse,PlatformError } from '../../../../../lib/platform';
export const runtime='nodejs';
export const maxDuration=60;
export async function GET(req:Request,context:{params:Promise<{id:string}>}) {
 try {const db=database();const user=await dashboardUser(req,db);const {id}=await context.params;
 const rows=await db.call<{organization_id:string;manager_user_id:string}[]>(`providers?id=eq.${encodeURIComponent(id)}&select=organization_id,manager_user_id`);const provider=rows[0];
 if(!provider||!user.members.some(m=>m.organization_id===provider.organization_id&&(m.role==='owner'||(m.role==='provider_manager'&&provider.manager_user_id===user.id))))throw new PlatformError('UNAUTHORIZED','Provider unavailable',403);
 const deployments=await db.call<{id:string;deployment:unknown;base_url:string;secret_reference:string}[]>(`provider_deployments?provider_id=eq.${encodeURIComponent(id)}&limit=5`);
 const results=[];
 for(const row of deployments){const d=DeploymentSchema.parse(row.deployment);const secret=process.env[row.secret_reference];const url=new URL(row.base_url);
 const allowed=d.transport==='openrouter'?row.base_url.replace(/\/$/,'')==='https://openrouter.ai/api/v1':(process.env.VISPR_DIRECT_ALLOWED_ORIGINS??'').split(',').includes(url.origin);
 if(!secret||!allowed||url.protocol!=='https:'||url.username||url.password){results.push({deploymentId:row.id,configured:false,status:'pending'});continue;}
 const probe=await probeEndpoint({baseURL:row.base_url,apiKey:secret,modelId:d.inferenceModelId});
 results.push({deploymentId:row.id,configured:true,status:d.status,...probe});
 }
 return Response.json(results,{headers:{'Cache-Control':'no-store'}});
 }catch(error){return errorResponse(error);}
}
