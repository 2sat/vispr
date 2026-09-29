import { createAdminClient } from "../../../lib/supabase";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) return Response.json({service:"vispr",status:"unconfigured"},{status:503});
  try {
    const { error } = await createAdminClient().from("schema_versions").select("version").eq("version","foundation-v1").single();
    return Response.json({service:"vispr",status:error ? "degraded" : "ok",database:error ? "unreachable" : "connected"},{status:error ? 503 : 200});
  } catch { return Response.json({service:"vispr",status:"degraded",database:"unreachable"},{status:503}); }
}
