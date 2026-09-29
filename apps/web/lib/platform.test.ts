import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import OpenAI from "openai";
import { hashApiKey } from "../../../packages/db/src/index";
import { Vispr } from "../../../packages/sdk/src/index";
import { demoPolicy } from "../../../packages/contracts/src/fixtures";
import { prepare, execute } from "./platform";
import { POST as native } from "../app/api/inference/stream/route";
import { POST as compatible } from "../app/v1/chat/completions/route";
import { GET as models } from "../app/v1/models/route";
import { GET as trace } from "../app/api/requests/[id]/route";
import { POST as cancel } from "../app/api/requests/[id]/cancel/route";
const app = "00000000-0000-0000-0000-000000000001";
const id = "00000000-0000-0000-0000-000000000002";
const events: unknown[] = [];
let dispatches = 0;
let reserved = false;
let status = "created";
let cancelRequested = false;
const originalFetch = globalThis.fetch;
let server: Server;
let baseURL: string;
const deployment = {
  id: "fixture",
  modelId: "fixture/model",
  providerId: "fixture",
  transport: "openrouter",
  inferenceModelId: "fixture/model",
  providerSlug: "fixture/provider",
  status: "active",
  capabilities: {
    streaming: true,
    tools: true,
    structuredOutput: true,
    vision: false,
    contextTokens: 4000,
    maxOutputTokens: 1500,
  },
};
beforeAll(async () => {
  process.env.SUPABASE_URL = "https://database.fixture";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "server-secret";
  process.env.OPENROUTER_API_KEY = "provider-secret";
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    const request = new Request(`${baseURL}${req.url}`, {
      method: req.method ?? "GET",
      headers: Object.entries(req.headers).filter(
        ([, v]) => typeof v === "string",
      ) as [string, string][],
      ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      signal: abort.signal,
    });
    let response: Response;
    if (req.url === "/api/inference/stream") response = await native(request);
    else if (req.url === "/v1/chat/completions")
      response = await compatible(request);
    else if (req.url === "/v1/models") response = await models(request);
    else if (req.url?.endsWith("/cancel"))
      response = await cancel(request, { params: Promise.resolve({ id }) });
    else response = await trace(request, { params: Promise.resolve({ id }) });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    try {
      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          res.write(next.value);
        }
        reader.releaseLock();
      }
      res.end();
    } catch {
      res.destroy();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  baseURL = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterAll(async () => {
  vi.unstubAllGlobals();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  events.length = 0;
  reserved = false;
  dispatches = 0;
  status = "created";
  cancelRequested = false;
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(baseURL)) return originalFetch(input, init);
      if (url === "https://openrouter.ai/api/v1/chat/completions") {
        dispatches++;
        const body = JSON.parse(init?.body as string);
        expect(body.provider).toEqual({
          only: ["fixture/provider"],
          allow_fallbacks: false,
          require_parameters: true,
        });
        return new Response(
          "data: " +
            JSON.stringify({
              id: "gen-fixture",
              choices: [
                { index: 0, delta: { content: "Hello" }, finish_reason: null },
              ],
            }) +
            "\n\ndata: " +
            JSON.stringify({
              id: "gen-fixture",
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              usage: { prompt_tokens: 3, completion_tokens: 1, cost: 0.0001 },
            }) +
            "\n\ndata: [DONE]\n\n",
          { headers: { "Content-Type": "text/event-stream" } },
        );
      }
      const path = new URL(url).pathname;
      const query = new URL(url).searchParams;
      if (path.endsWith("/api_keys"))
        return Response.json(
          query.get("key_hash") === `eq.${hashApiKey("vispr_fixture")}`
            ? [{ application_id: app }]
            : [],
        );
      if (path.endsWith("/applications"))
        return Response.json([
          {
            id: app,
            owner_user_id: "owner",
            organization_id: "org",
            default_policy_id: "balanced",
          },
        ]);
      if (path.endsWith("/memberships"))
        return Response.json([{ role: "builder" }]);
      if (path.endsWith("/policy_versions"))
        return Response.json(
          !query.has("policy_id")
            ? [{ policy_id: "balanced" }]
            : query.get("policy_id") === "eq.balanced"
              ? [{ policy: demoPolicy, version: 1 }]
              : [],
        );
      if (path.endsWith("/routing_configs")) return Response.json([]);
      if (path.endsWith("/execution_offerings"))
        return Response.json([
          {
            deployment,
            base_url: "https://openrouter.ai/api/v1",
            secret_reference: "OPENROUTER_API_KEY",
            input_micros_per_million: "1000000",
            output_micros_per_million: "2000000",
            bounded: true,
          },
        ]);
      if (path.endsWith("/rpc/begin_execution")) {
        if (reserved)
          return Response.json({ message: "duplicate" }, { status: 409 });
        reserved = true;
        return Response.json(id);
      }
      if (path.endsWith("/rpc/mark_dispatched"))
        return Response.json(!cancelRequested);
      if (path.endsWith("/rpc/finish_execution")) {
        const body = JSON.parse(init?.body as string);
        status = body.p_status;
        return new Response("null");
      }
      if (path.endsWith("/inference_requests")) {
        if (init?.method === "PATCH") {
          if (JSON.parse(init.body as string).cancel_requested)
            cancelRequested = true;
          return Response.json([]);
        }
        return Response.json([{ status, cancel_requested: cancelRequested }]);
      }
      if (path.endsWith("/trace_events")) {
        if (init?.method === "POST") {
          events.push(JSON.parse(init.body as string).event);
          return Response.json([]);
        }
        return Response.json(events.map((event) => ({ event })));
      }
      throw new Error(`Unexpected test URL: ${url}`);
    },
  );
});
it("streams through the native SDK and retrieves a separate trace", async () => {
  const sdk = new Vispr({ apiKey: "vispr_fixture", baseURL });
  const run = sdk.inference.stream({
    policyId: "balanced",
    idempotencyKey: "sdk",
    messages: [{ role: "user", content: "Hello" }],
    maxOutputTokens: 20,
  });
  const received = [];
  for await (const event of run.events) received.push(event);
  expect(received.map((e) => e.type)).toEqual([
    "usage",
    "text_delta",
    "usage",
    "completed",
  ]);
  expect(received.at(-1)?.requestId).toBe(id);
  expect(dispatches).toBe(1);
  expect(status).toBe("completed");
  expect(await sdk.trace(id)).toEqual(received);
  await expect(
    sdk.inference.generate({
      policyId: "balanced",
      idempotencyKey: "sdk",
      messages: [{ role: "user", content: "Hello" }],
      maxOutputTokens: 20,
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(dispatches).toBe(1);
});
it("works with the actual OpenAI client streaming and model discovery", async () => {
  const client = new OpenAI({
    apiKey: "vispr_fixture",
    baseURL: `${baseURL}/v1`,
    maxRetries: 0,
  });
  const list = await client.models.list();
  expect(list.data.map((m) => m.id)).toContain("vispr/default");
  const stream = await client.chat.completions.create({
    model: "vispr/default",
    messages: [{ role: "user", content: "Hello" }],
    stream: true,
    max_tokens: 20,
    stream_options: { include_usage: true },
  });
  let text = "";
  let tokens = 0;
  for await (const chunk of stream) {
    text += chunk.choices[0]?.delta.content ?? "";
    tokens = chunk.usage?.total_tokens ?? tokens;
  }
  expect(text).toBe("Hello");
  expect(tokens).toBe(4);
  expect(dispatches).toBe(1);
});
it("supports nonstreaming chat completions", async () => {
  const client = new OpenAI({
    apiKey: "vispr_fixture",
    baseURL: `${baseURL}/v1`,
    maxRetries: 0,
  });
  const completion = await client.chat.completions.create({
    model: "vispr/policy/balanced",
    messages: [{ role: "user", content: "Hello" }],
    max_tokens: 20,
  });
  expect(completion.choices[0]?.message.content).toBe("Hello");
});
it("rejects unsupported parameters and absent auth before dispatch", async () => {
  const response = await originalFetch(`${baseURL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: "Bearer vispr_fixture",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "vispr/default",
      messages: [{ role: "user", content: "Hello" }],
      logprobs: true,
    }),
  });
  expect(response.status).toBe(400);
  expect((await originalFetch(`${baseURL}/v1/models`)).status).toBe(401);
  expect(dispatches).toBe(0);
});
it("rejects policies outside the owning application and requests above the output limit", async () => {
  const sdk = new Vispr({ apiKey: "vispr_fixture", baseURL });
  await expect(
    sdk.inference.generate({
      policyId: "other-app-policy",
      idempotencyKey: "other",
      messages: [{ role: "user", content: "Hello" }],
      maxOutputTokens: 20,
    }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    sdk.inference.generate({
      policyId: "balanced",
      idempotencyKey: "over",
      messages: [{ role: "user", content: "Hello" }],
      maxOutputTokens: 2000,
    }),
  ).rejects.toMatchObject({ status: 400 });
  expect(dispatches).toBe(0);
});

it("settles cancellation conservatively when the consumer stops reading partial output", async () => {
  const run = await prepare(
    new Request(baseURL, {
      headers: { Authorization: "Bearer vispr_fixture" },
    }),
    {
      policyId: "balanced",
      idempotencyKey: "cancel-test",
      messages: [{ role: "user", content: "Hello" }],
      maxOutputTokens: 20,
    },
  );
  const iterator = execute(run, new AbortController().signal)[Symbol.asyncIterator]();
  expect((await iterator.next()).value?.type).toBe("usage");
  expect((await iterator.next()).value?.type).toBe("text_delta");
  await iterator.return?.();
  expect(status).toBe("cancelled");
  expect(dispatches).toBe(1);
});
it("rejects a revoked/invalid key before reading policies or dispatching", async () => {
  const sdk = new Vispr({ apiKey: "vispr_invalid", baseURL });
  await expect(
    sdk.inference.generate({
      policyId: "balanced",
      idempotencyKey: "invalid-key",
      messages: [{ role: "user", content: "Hello" }],
      maxOutputTokens: 20,
    }),
  ).rejects.toMatchObject({ status: 401 });
  expect(dispatches).toBe(0);
});
