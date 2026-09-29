import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CatalogSnapshotSchema, PolicySchema } from '@vispr/contracts';
import { database, dashboardApp, dashboardUser, errorResponse, PlatformError } from '../../../../../lib/platform';
import { RoutingConfigSchema, validateReview, prepareMarketplace } from '../../../../../lib/marketplace';
export const runtime='nodejs';
const Publication=z.strictObject({policyId:z.string().min(1),catalog:CatalogSnapshotSchema,config:RoutingConfigSchema,active:z.boolean().default(false)});
export async function POST(req:Request,context:{params:Promise<{id:string}>}) {
  try {
    const db=database();
    const {id}=await context.params;
    await dashboardApp(req,id,db);
    const reviewer=await dashboardUser(req,db);
    const body=Publication.parse(await req.json());
    validateReview(body.catalog,body.config);
    const rows=await db.call<{policy:unknown}[]>(`policy_versions?application_id=eq.${id}&policy_id=eq.${encodeURIComponent(body.policyId)}&order=version.desc&limit=1&select=policy`);
    if(!rows[0])throw new PlatformError('INVALID_REQUEST','Policy unavailable');
    const policy=PolicySchema.parse(rows[0].policy);
    const hash=createHash('sha256').update(JSON.stringify({deployments:body.catalog.deployments,benchmarks:body.catalog.benchmarks,config:body.config})).digest('hex');
    if(body.active) await prepareMarketplace(db,policy,{policyId:policy.id,idempotencyKey:'activation-check',messages:[{role:'user',content:'Activation check'}],maxOutputTokens:Math.min(32,policy.maxOutputTokens)},body.catalog,body.config);
    const snapshotId=await db.rpc<string>('publish_routing',{p_app:id,p_policy:policy.id,p_version:policy.version,p_reviewer:reviewer.id,p_hash:hash,p_catalog:body.catalog,p_config:body.config,p_active:body.active});
    return Response.json({catalogSnapshotId:snapshotId,active:body.active},{headers:{'Cache-Control':'no-store'}});
  }catch(error){return errorResponse(error);}
}
