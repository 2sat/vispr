import { database,authenticate,ownedRequest,errorResponse } from '../../../../lib/platform';
export const runtime='nodejs';
export async function GET(req:Request,context:{params:Promise<{id:string}>}) {
 try {const db=database(); const app=await authenticate(req,db);const {id}=await context.params;await ownedRequest(db,app.id,id);
 const rows=await db.call<{event:unknown}[]>(`trace_events?request_id=eq.${id}&application_id=eq.${app.id}&order=sequence.asc&select=event`);
 return Response.json(rows.map(r=>r.event),{headers:{'Cache-Control':'no-store'}});
 }catch(error){return errorResponse(error);}
}
