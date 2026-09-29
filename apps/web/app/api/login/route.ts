import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { database, errorResponse, PlatformError } from '../../../lib/platform';
export const runtime='nodejs';
const Login=z.strictObject({email:z.email().max(254),password:z.string().min(1).max(512)});
export async function POST(req:Request) {
  try {
    const {email,password}=Login.parse(await req.json());
    const db=database();
    const key=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY??process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if(!key)throw new PlatformError('NOT_CONFIGURED','Identity configuration unavailable',503);
    const client=createClient(db.url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await client.auth.signInWithPassword({email,password});
    if(error || !data.session || !data.user || data.user.is_anonymous)throw new PlatformError('UNAUTHORIZED','Invited login required',401);
    const memberships=await db.call<{organization_id:string;role:string}[]>(`memberships?user_id=eq.${data.user.id}&select=organization_id,role`);
    if(!memberships.length){await client.auth.signOut({scope:'local'});throw new PlatformError('UNAUTHORIZED','Invited membership required',403);}
    const applications=await db.call<{id:string;name:string;organization_id:string}[]>(`applications?owner_user_id=eq.${data.user.id}&select=id,name,organization_id`);
    return Response.json({userId:data.user.id,accessToken:data.session.access_token,expiresAt:data.session.expires_at,applications},{headers:{'Cache-Control':'no-store'}});
  }catch(error){return errorResponse(error);}
}
