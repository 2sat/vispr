import { PolicySchema } from "@vispr/contracts";
import {
  database,
  dashboardUser,
  errorResponse,
  PlatformError,
} from "../../../lib/platform";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const db = database();
    const user = await dashboardUser(req, db);
    const body = (await req.json()) as {
      organizationId?: string;
      name?: string;
      policy?: unknown;
    };
    if (
      !body.organizationId ||
      !body.name ||
      body.name.length > 200 ||
      !user.members.some(
        (m) =>
          m.organization_id === body.organizationId &&
          ["owner", "builder"].includes(m.role),
      )
    )
      throw new PlatformError(
        "INVALID_REQUEST",
        "Builder membership and application name required",
      );
    const policy = PolicySchema.parse(body.policy);
    const app = await db.rpc<string>("create_application", {
      p_org: body.organizationId,
      p_owner: user.id,
      p_name: body.name,
      p_policy: policy,
    });
    return Response.json({ id: app }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
