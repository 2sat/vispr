import { issueApiKey } from "@vispr/db";
import {
  database,
  dashboardApp,
  errorResponse,
  PlatformError,
} from "../../../../../lib/platform";
export const runtime = "nodejs";
export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const db = database();
    const { id } = await context.params;
    await dashboardApp(req, id, db);
    const issued = issueApiKey();
    const rows = await db.call<{ id: string }[]>("api_keys", {
      method: "POST",
      body: JSON.stringify({
        application_id: id,
        key_hash: issued.hash,
        prefix: issued.prefix,
      }),
    });
    return Response.json(
      { id: rows[0]?.id, key: issued.key, prefix: issued.prefix },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const db = database();
    const { id } = await context.params;
    await dashboardApp(req, id, db);
    const keyId = new URL(req.url).searchParams.get("keyId");
    if (!keyId || !/^[0-9a-f-]{36}$/i.test(keyId))
      throw new PlatformError("INVALID_REQUEST", "Key ID required");
    await db.call(
      `api_keys?id=eq.${keyId}&application_id=eq.${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ revoked_at: new Date().toISOString() }),
      },
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
