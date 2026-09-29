import { PolicySchema } from '@vispr/contracts';
import { authenticate, database, errorResponse } from '../../../lib/platform';
export const runtime = 'nodejs';
export async function GET(req: Request) {
  try {
    const db=database();
    const app=await authenticate(req,db);
    const rows=await db.call<{policy:unknown}[]>(`policy_versions?application_id=eq.${app.id}&order=version.desc&select=policy`);
    const seen=new Set<string>();
    const policies=rows.map(row=>PolicySchema.parse(row.policy)).filter(policy=>{if(seen.has(policy.id))return false;seen.add(policy.id);return true;});
    return Response.json({defaultPolicyId:app.default_policy_id,policies},{headers:{'Cache-Control':'no-store'}});
  } catch(error) {return errorResponse(error);}
}
