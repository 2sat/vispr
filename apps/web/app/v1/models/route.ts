import { database,authenticate,errorResponse } from '../../../lib/platform';
export const runtime='nodejs';
export async function GET(req:Request) {
 try {const db=database();const app=await authenticate(req,db);
 const policies=await db.call<{policy_id:string}[]>(`policy_versions?application_id=eq.${app.id}&select=policy_id`);
 const ids=[...(policies.some(p=>p.policy_id===app.default_policy_id)?['vispr/default']:[]),...new Set(policies.map(p=>`vispr/policy/${p.policy_id}`))];
 return Response.json({object:'list',data:ids.map(id=>({id,object:'model',created:0,owned_by:'vispr'}))},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return errorResponse(error);}
}
