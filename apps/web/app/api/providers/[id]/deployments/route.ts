import { DeploymentSchema } from "@vispr/contracts";
import {
  database,
  dashboardUser,
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
    const user = await dashboardUser(req, db);
    const { id } = await context.params;
    const rows = await db.call<
      { organization_id: string; manager_user_id: string; transport: string }[]
    >(
      `providers?id=eq.${encodeURIComponent(id)}&select=organization_id,manager_user_id,transport`,
    );
    const provider = rows[0];
    if (
      !provider ||
      !user.members.some(
        (m) =>
          m.organization_id === provider.organization_id &&
          (m.role === "owner" ||
            (m.role === "provider_manager" &&
              provider.manager_user_id === user.id)),
      )
    )
      throw new PlatformError("UNAUTHORIZED", "Provider unavailable", 403);
    const body = (await req.json()) as {
      deployment: unknown;
      baseURL: string;
      secretReference: string;
      capacity: number;
    };
    const deployment = DeploymentSchema.parse(body.deployment);
    if (
      deployment.providerId !== id ||
      deployment.transport !== provider.transport ||
      deployment.status !== "pending" ||
      !Number.isSafeInteger(body.capacity) ||
      body.capacity < 1 ||
      !/^VISPR_PROVIDER_[A-Z0-9_]+$/.test(body.secretReference)
    )
      throw new PlatformError(
        "INVALID_REQUEST",
        "New deployments must be pending with an operator secret reference",
      );
    const url = new URL(body.baseURL);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.protocol !== "https:"
    )
      throw new PlatformError(
        "INVALID_REQUEST",
        "Authenticated HTTPS endpoint required",
      );
    if (
      deployment.transport === "openrouter" &&
      body.baseURL.replace(/\/$/, "") !== "https://openrouter.ai/api/v1"
    )
      throw new PlatformError("INVALID_REQUEST", "Invalid OpenRouter endpoint");
    if (
      deployment.transport === "direct" &&
      !(process.env.VISPR_DIRECT_ALLOWED_ORIGINS ?? "")
        .split(",")
        .includes(url.origin)
    )
      throw new PlatformError(
        "INVALID_REQUEST",
        "Operator-approved direct endpoint required",
      );
    await db.call("provider_deployments", {
      method: "POST",
      body: JSON.stringify({
        id: deployment.id,
        provider_id: id,
        deployment,
        base_url: body.baseURL,
        secret_reference: body.secretReference,
        capacity: body.capacity,
      }),
    });
    return Response.json(
      {
        deployment,
        status: "pending",
        message:
          "Connectivity and declared feature verification are required before activation",
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
