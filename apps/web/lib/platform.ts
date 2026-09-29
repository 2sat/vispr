import "server-only";
import { Database, hashApiKey } from "@vispr/db";
import { CompatibleAdapter } from "@vispr/providers";
import {
  DeploymentSchema,
  ExecutionRequestSchema,
  PolicySchema,
  TraceEventSchema,
  type TraceEvent,
  type Usage,
} from "@vispr/contracts";
import { randomUUID } from "node:crypto";
export class PlatformError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export function database() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret)
    throw new PlatformError(
      "NOT_CONFIGURED",
      "Database is not configured",
      503,
    );
  return new Database(url, secret);
}
export async function authenticate(req: Request, db = database()) {
  const match = /^Bearer (vispr_[A-Za-z0-9_-]+)$/.exec(
    req.headers.get("Authorization") ?? "",
  );
  if (!match)
    throw new PlatformError("UNAUTHORIZED", "Application key required", 401);
  const keys = await db.call<{ application_id: string }[]>(
    `api_keys?key_hash=eq.${hashApiKey(match[1]!)}&revoked_at=is.null&select=application_id`,
  );
  const key = keys[0];
  if (!key)
    throw new PlatformError("UNAUTHORIZED", "Invalid application key", 401);
  const apps = await db.call<
    {
      id: string;
      owner_user_id: string;
      organization_id: string;
      default_policy_id: string;
    }[]
  >(
    `applications?id=eq.${key.application_id}&select=id,owner_user_id,organization_id,default_policy_id`,
  );
  const app = apps[0];
  if (!app)
    throw new PlatformError("UNAUTHORIZED", "Application unavailable", 401);
  const members = await db.call<unknown[]>(
    `memberships?organization_id=eq.${app.organization_id}&user_id=eq.${app.owner_user_id}&select=role`,
  );
  if (!members.length)
    throw new PlatformError(
      "UNAUTHORIZED",
      "Application owner is not an invited member",
      403,
    );
  return app;
}
export async function ownedRequest(db: Database, appId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id))
    throw new PlatformError("INVALID_REQUEST", "Invalid request ID");
  const rows = await db.call<{ status: string; cancel_requested: boolean }[]>(
    `inference_requests?id=eq.${id}&application_id=eq.${appId}&select=status,cancel_requested`,
  );
  if (!rows[0])
    throw new PlatformError("UNAUTHORIZED", "Request unavailable", 404);
  return rows[0];
}
export async function prepare(req: Request, raw: unknown, db = database()) {
  const app = await authenticate(req, db);
  const request = ExecutionRequestSchema.parse(raw);
  // Until routing is integrated, sessions would falsely imply continuity.
  if (request.source) throw new PlatformError("NOT_CONFIGURED", "Source pool routing is pending service integration", 503);
  if (request.sessionId)
    throw new PlatformError(
      "NOT_CONFIGURED",
      "Session routing is pending integration",
      503,
    );
  const policies = await db.call<{ policy: unknown; version: number }[]>(
    `policy_versions?application_id=eq.${app.id}&policy_id=eq.${encodeURIComponent(request.policyId)}&order=version.desc&limit=1&select=policy,version`,
  );
  if (!policies[0])
    throw new PlatformError("INVALID_REQUEST", "Policy unavailable");
  const policy = PolicySchema.parse(policies[0].policy);
  if (policy.id !== request.policyId || policy.version !== policies[0].version)
    throw new PlatformError(
      "NOT_CONFIGURED",
      "Invalid policy configuration",
      503,
    );
  if (request.maxOutputTokens > policy.maxOutputTokens)
    throw new PlatformError("INVALID_REQUEST", "Output limit exceeds policy");
  const offerings = await db.call<
    {
      deployment: unknown;
      base_url: string;
      secret_reference: string;
      input_micros_per_million: string;
      output_micros_per_million: string;
      bounded: boolean;
    }[]
  >(
    `execution_offerings?application_id=eq.${app.id}&policy_id=eq.${encodeURIComponent(request.policyId)}&policy_version=eq.${policy.version}`,
  );
  const offering = offerings[0];
  if (!offering?.bounded)
    throw new PlatformError(
      "NOT_CONFIGURED",
      "A bounded explicit transport offering is required",
      503,
    );
  const deployment = DeploymentSchema.parse(offering.deployment);
  if (deployment.status !== "active")
    throw new PlatformError(
      "NOT_CONFIGURED",
      "Deployment is pending connectivity verification",
      503,
    );
  // Strict first-path bounds cover the entire context window. Vision has no reliable byte bound here.
  if (request.messages.some((m) => Array.isArray(m.content)))
    throw new PlatformError(
      "INVALID_REQUEST",
      "Multimodal cost bounds are pending",
    );
  const bytes =
    Buffer.byteLength(
      JSON.stringify({
        messages: request.messages,
        tools: request.tools,
        outputSchema: request.outputSchema,
      }),
      "utf8",
    ) +
    256 * request.messages.length;
  if (bytes > deployment.capabilities.contextTokens - request.maxOutputTokens)
    throw new PlatformError(
      "INVALID_REQUEST",
      "Conservative context bound exceeded",
    );
  if (
    (request.tools?.length && !deployment.capabilities.tools) ||
    (request.outputSchema && !deployment.capabilities.structuredOutput) ||
    !deployment.capabilities.streaming ||
    request.maxOutputTokens > deployment.capabilities.maxOutputTokens
  )
    throw new PlatformError(
      "INVALID_REQUEST",
      "Deployment does not support request features",
    );
  const key = process.env[offering.secret_reference];
  if (
    deployment.transport === "openrouter" &&
    offering.secret_reference !== "OPENROUTER_API_KEY"
  )
    throw new PlatformError(
      "NOT_CONFIGURED",
      "Shared OpenRouter account required",
      503,
    );
  if (!key)
    throw new PlatformError(
      "NOT_CONFIGURED",
      "Provider credential is missing",
      503,
    );
  const url = new URL(offering.base_url);
  // Direct destinations are operator-provisioned, with exact hosted origin allowlisting.
  const allowed = (process.env.VISPR_DIRECT_ALLOWED_ORIGINS ?? "").split(",");
  if (
    deployment.transport === "openrouter"
      ? offering.base_url.replace(/\/$/, "") !== "https://openrouter.ai/api/v1"
      : !allowed.includes(url.origin)
  )
    throw new PlatformError(
      "NOT_CONFIGURED",
      "Endpoint is not operator-approved",
      503,
    );
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        process.env.VISPR_ALLOW_LOCAL_ENDPOINTS === "true" &&
        process.env.NODE_ENV !== "production" &&
        url.protocol === "http:"
      ))
  )
    throw new PlatformError("NOT_CONFIGURED", "Invalid endpoint", 503);
  const amount =
    (BigInt(deployment.capabilities.contextTokens) *
      BigInt(offering.input_micros_per_million) +
      BigInt(request.maxOutputTokens) *
        BigInt(offering.output_micros_per_million) +
      999999n) /
    1000000n;
  let id: string;
  try {
    id = await db.rpc<string>("begin_execution", {
      p_app: app.id,
      p_key: request.idempotencyKey,
      p_policy: policy.id,
      p_version: policy.version,
      p_amount: amount.toString(),
      p_request_limit: policy.requestBudgetMicros,
      p_daily_limit: policy.dailyBudgetMicros,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "BUDGET_EXCEEDED")
      throw new PlatformError(
        "BUDGET_EXCEEDED",
        "Shared spending limit exceeded",
        429,
      );
    if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT")
      throw new PlatformError(
        "INVALID_REQUEST",
        "Idempotency key already used; retrieve its trace instead",
        409,
      );
    throw error;
  }
  return {
    id,
    app,
    request,
    policy,
    deployment,
    offering,
    db,
    adapter: new CompatibleAdapter({
      apiKey: key,
      baseURL: offering.base_url,
      fetch: (input, init) => fetch(input, { ...init, redirect: "error" }),
    }),
  };
}
export async function* execute(
  run: Awaited<ReturnType<typeof prepare>>,
  signal: AbortSignal,
): AsyncIterable<TraceEvent> {
  let sequence = 0;
  let partial = false;
  let usage: Usage | undefined;
  let finalized = false;
  const controller = new AbortController();
  const combined = AbortSignal.any([
    signal,
    controller.signal,
    AbortSignal.timeout(Math.min(run.policy.maxLatencyMs, 55000)),
  ]);
  let activePoll: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (activePoll) return;
    activePoll = (async () => {
      try {
        const state = await ownedRequest(run.db, run.app.id, run.id);
        if (state.cancel_requested) controller.abort();
      } catch {
        controller.abort();
      }
    })().finally(() => { activePoll = undefined; });
  }, 500);
  async function event(data: Record<string, unknown>) {
    const event = TraceEventSchema.parse({
      ...data,
      requestId: run.id,
      sequence: sequence++,
    });
    // Payload retention opt-out applies to output deltas as well as prompts.
    const persisted =
      !run.policy.retainPayloads &&
      (event.type === "text_delta" || event.type === "tool_delta")
        ? {
            ...event,
            ...(event.type === "text_delta"
              ? { text: "[redacted]" }
              : { argumentsDelta: "[redacted]" }),
          }
        : event;
    await run.db.call("trace_events", {
      method: "POST",
      body: JSON.stringify({
        application_id: run.app.id,
        request_id: run.id,
        sequence: event.sequence,
        event: persisted,
      }),
    });
    return event;
  }
  try {
    if (
      combined.aborted ||
      !(await run.db.rpc<boolean>("mark_dispatched", {
        p_app: run.app.id,
        p_request: run.id,
      }))
    ) {
      controller.abort();
      throw new Error("Cancelled");
    }
    await run.db.call(
      `inference_requests?id=eq.${run.id}&application_id=eq.${run.app.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          transport: run.deployment.transport,
          selected_deployment: run.deployment,
        }),
      },
    );
    for await (const delta of run.adapter.execute({
      deployment: run.deployment,
      request: run.request,
      signal: combined,
    })) {
      if (delta.type === "usage") {
        usage = delta.usage;
        await run.db.call(
          `inference_requests?id=eq.${run.id}&application_id=eq.${run.app.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              usage,
              generation_id: usage.generationId ?? null,
              serving_identity: usage.servingProvider ?? null,
            }),
          },
        );
      }
      if (delta.type === "text_delta" || delta.type === "tool_delta")
        partial = true;
      yield await event(delta);
    }
    await run.db.rpc("finish_execution", {
      p_app: run.app.id,
      p_request: run.id,
      p_status: "completed",
      p_usage: usage ?? null,
    });
    finalized = true;
    yield await event({ type: "completed" });
  } catch {
    await run.db.rpc("finish_execution", {
      p_app: run.app.id,
      p_request: run.id,
      p_status: combined.aborted ? "cancelled" : "failed",
      p_usage: usage ?? null,
    });
    finalized = true;
    yield await event({
      type: "error",
      code: combined.aborted ? "CANCELLED" : "PROVIDER_FAILED",
      message: combined.aborted
        ? "Execution cancelled; charges may require reconciliation"
        : "Execution failed; charges may require reconciliation",
      partial,
    });
  } finally {
    clearInterval(timer);
    controller.abort();
    await activePoll;
    if (!finalized)
      await run.db.rpc("finish_execution", {
        p_app: run.app.id,
        p_request: run.id,
        p_status: "cancelled",
        p_usage: usage ?? null,
      });
  }
}
export function sse(events: AsyncIterable<string>, onCancel?: () => void) {
  const iterator = events[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(c) {
      try {
        const next = await iterator.next();
        if (next.done) c.close();
        else c.enqueue(encoder.encode(next.value));
      } catch (e) {
        c.error(e);
      }
    },
    async cancel() {
      onCancel?.();
      await iterator.return?.();
    },
  });
}
export function errorResponse(error: unknown) {
  if (error instanceof PlatformError)
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  if (
    error instanceof Error &&
    (error.name === "ZodError" || error instanceof SyntaxError)
  )
    return Response.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "Invalid or unsupported request fields",
        },
      },
      { status: 400 },
    );
  return Response.json(
    { error: { code: "PROVIDER_FAILED", message: "Service operation failed" } },
    { status: 503 },
  );
}
export const newIdempotencyKey = () => randomUUID();
export async function dashboardUser(req: Request, db = database()) {
  const token = /^Bearer (.+)$/.exec(
    req.headers.get("Authorization") ?? "",
  )?.[1];
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!token || !url || !secret)
    throw new PlatformError("UNAUTHORIZED", "Dashboard session required", 401);
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: secret, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new PlatformError("UNAUTHORIZED", "Invalid dashboard session", 401);
  const user = (await response.json()) as {
    id: string;
    is_anonymous?: boolean;
  };
  if (user.is_anonymous || !user.id)
    throw new PlatformError("UNAUTHORIZED", "Invited account required", 403);
  const members = await db.call<{ organization_id: string; role: string }[]>(
    `memberships?user_id=eq.${encodeURIComponent(user.id)}&select=organization_id,role`,
  );
  if (!members.length)
    throw new PlatformError("UNAUTHORIZED", "Invited membership required", 403);
  return { id: user.id, members };
}
export async function dashboardApp(
  req: Request,
  appId: string,
  db = database(),
) {
  const user = await dashboardUser(req, db);
  const apps = await db.call<
    { id: string; organization_id: string; owner_user_id: string }[]
  >(
    `applications?id=eq.${encodeURIComponent(appId)}&select=id,organization_id,owner_user_id`,
  );
  const app = apps[0];
  if (
    !app ||
    !user.members.some(
      (m) =>
        m.organization_id === app.organization_id &&
        (m.role === "owner" ||
          (m.role === "builder" && app.owner_user_id === user.id)),
    )
  )
    throw new PlatformError("UNAUTHORIZED", "Application unavailable", 403);
  return app;
}
