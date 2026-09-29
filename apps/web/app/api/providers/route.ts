import { randomUUID } from 'node:crypto';
import { database,dashboardUser,errorResponse,PlatformError } from '../../../lib/platform';
export const runtime='nodejs';
export async function GET(req:Request) {
 try {const db=database();const user=await dashboardUser(req,db);const orgs=user.members.filter(m=>m.role==='owner'||m.role==='provider_manager').map(m=>m.organization_id);
 if(!orgs.length)throw new PlatformError('UNAUTHORIZED','Provider manager membership required',403);
 const providers=await db.call<{id:string;manager_user_id:string;organization_id:string}[]>(`providers?organization_id=in.(${orgs.join(',')})&select=id,name,status,transport,organization_id,manager_user_id`);
 return Response.json(providers.filter(p=>p.manager_user_id===user.id||user.members.some(m=>m.role==='owner'&&m.organization_id===p.organization_id)));
 }catch(error){return errorResponse(error);}
}
export async function POST(req:Request) {
 try {const db=database();const user=await dashboardUser(req,db);const body=await req.json() as {organizationId?:string;name?:string;transport?:string};
 if(!body.organizationId||!body.name||body.name.length>200||!['openrouter','direct'].includes(body.transport??'')||!user.members.some(m=>m.organization_id===body.organizationId&&(m.role==='owner'||m.role==='provider_manager')))throw new PlatformError('UNAUTHORIZED','Provider manager membership required',403);
 const rows=await db.call<{id:string}[]>('providers',{method:'POST',body:JSON.stringify({id:randomUUID(),organization_id:body.organizationId,manager_user_id:user.id,name:body.name,transport:body.transport,status:'pending'})});return Response.json(rows[0],{status:201});
 }catch(error){return errorResponse(error);}
}
