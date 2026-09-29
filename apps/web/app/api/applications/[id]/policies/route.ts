import { PolicySchema } from '@vispr/contracts';
import { database,dashboardApp,errorResponse } from '../../../../../lib/platform';
export const runtime='nodejs';
export async function GET(req:Request,context:{params:Promise<{id:string}>}) {
 try {const db=database();const {id}=await context.params;await dashboardApp(req,id,db);return Response.json(await db.call(`policy_versions?application_id=eq.${encodeURIComponent(id)}&select=policy&order=version.desc`));}catch(error){return errorResponse(error);}
}
export async function POST(req:Request,context:{params:Promise<{id:string}>}) {
 try {const db=database();const {id}=await context.params;await dashboardApp(req,id,db);const policy=PolicySchema.parse(await req.json());
 await db.call('policy_versions',{method:'POST',body:JSON.stringify({application_id:id,policy_id:policy.id,version:policy.version,policy})});return Response.json(policy,{status:201});}catch(error){return errorResponse(error);}
}
