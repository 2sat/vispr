import {
  database,
  authenticate,
  ownedRequest,
  errorResponse,
} from "../../../../../lib/platform";
export const runtime = "nodejs";
export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const db = database();
    const app = await authenticate(req, db);
    const { id } = await context.params;
    await ownedRequest(db, app.id, id);
    await db.call(
      `inference_requests?id=eq.${id}&application_id=eq.${app.id}`,
      { method: "PATCH", body: JSON.stringify({ cancel_requested: true }) },
    );
    return Response.json({ requestId: id, cancellationRequested: true });
  } catch (error) {
    return errorResponse(error);
  }
}
