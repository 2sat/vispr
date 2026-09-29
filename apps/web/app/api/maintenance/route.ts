import { timingSafeEqual } from 'node:crypto';
import { reconcileOpenRouter } from '@vispr/providers';
import { database,errorResponse,PlatformError } from '../../../lib/platform';
export const runtime='nodejs';
export const maxDuration=60;
export async function GET(req:Request) {
 try {
  const secret=process.env.CRON_SECRET;const auth=req.headers.get('Authorization')??'';
  const expected=`Bearer ${secret}`;
  if(!secret||auth.length!==expected.length||!timingSafeEqual(Buffer.from(auth),Buffer.from(expected)))throw new PlatformError('UNAUTHORIZED','Maintenance authorization required',401);
  const db=database();const key=process.env.OPENROUTER_API_KEY;
  const pending=await db.call<{id:string;application_id:string;generation_id:string;status:string;usage:Record<string,unknown>}[]>("inference_requests?transport=eq.openrouter&status=in.(completed,failed,cancelled)&generation_id=not.is.null&usage->>reconciliation=eq.pending&limit=3&order=created_at.asc");
  let settled=0;
  if(key)for(const row of pending) {
   const cost=await reconcileOpenRouter(row.generation_id,key);
   if(cost!==null){await db.rpc('finish_execution',{p_app:row.application_id,p_request:row.id,p_status:row.status,p_usage:{...row.usage,actualCostMicros:cost,reconciliation:'settled'}});settled++;}
  }
  await db.rpc('release_undispatched',{});
  // Dispatched/uncertain reservations are deliberately never released by expiry.
  await db.call(`request_payloads?expires_at=lt.${encodeURIComponent(new Date().toISOString())}`,{method:'DELETE'});
  const retention=new Date(Date.now()-30*86400000).toISOString();
  await db.call(`trace_events?created_at=lt.${encodeURIComponent(retention)}`,{method:'DELETE'});
  return Response.json({checked:pending.length,settled});
 }catch(error){return errorResponse(error);}
}
