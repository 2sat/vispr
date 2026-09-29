import { describe, it, expect } from "vitest";
import {
  CompatibleAdapter,
  reconcileOpenRouter,
  type ExecutionEvent,
} from "./index";
import type { Deployment, InferenceRequest } from "@vispr/contracts";
const deployment: Deployment = {
  id: "test",
  modelId: "test-model",
  providerId: "test-host",
  transport: "openrouter",
  inferenceModelId: "fixture/model",
  providerSlug: "fixture/provider",
  status: "active",
  capabilities: {
    tools: true,
    structuredOutput: true,
    vision: false,
    streaming: true,
    contextTokens: 10000,
    maxOutputTokens: 1000,
  },
};
const request: InferenceRequest = {
  policyId: "test",
  idempotencyKey: "test",
  messages: [{ role: "user", content: "Hello" }],
  maxOutputTokens: 20,
};
function response(chunks: unknown[]) {
  return new Response(
    chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") +
      "data: [DONE]\n\n",
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
describe("execution adapter", () => {
  it("serializes a single pinned provider with no fallbacks and reconciles real upstream cost separately", async () => {
    let captured: Record<string, unknown> = {};
    let calls = 0;
    const adapter = new CompatibleAdapter({
      apiKey: "fixture-secret",
      baseURL: "https://openrouter.ai/api/v1",
      fetch: async (_url, init) => {
        calls++;
        captured = JSON.parse(init!.body as string);
        return response([
          {
            id: "gen-fixture",
            provider: "Fixture Host",
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "hello" },
                finish_reason: null,
              },
            ],
          },
          {
            id: "gen-fixture",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: {
              prompt_tokens: 4,
              completion_tokens: 2,
              total_tokens: 6,
              cost: 0.000123,
            },
          },
        ]);
      },
    });
    const events: ExecutionEvent[] = [];
    for await (const e of adapter.execute({
      deployment,
      request,
      signal: new AbortController().signal,
    }))
      events.push(e);
    expect(captured.model).toBe("fixture/model");
    expect(captured.provider).toEqual({
      only: ["fixture/provider"],
      allow_fallbacks: false,
      require_parameters: true,
    });
    expect(calls).toBe(1);
    expect(events).toContainEqual({ type: "text_delta", text: "hello" });
    expect(events.at(-1)).toMatchObject({
      type: "usage",
      usage: {
        actualCostMicros: 123,
        servingProvider: "Fixture Host",
        reconciliation: "settled",
        generationId: "gen-fixture",
      },
    });
  });
  it("direct transport does not depend on OpenRouter or invent missing cost", async () => {
    let captured: Record<string, unknown> = {};
    const adapter = new CompatibleAdapter({
      apiKey: "direct-secret",
      baseURL: "https://operator.example/v1",
      fetch: async (_url, init) => {
        captured = JSON.parse(init!.body as string);
        return response([
          {
            id: "direct-1",
            choices: [
              { index: 0, delta: { content: "hi" }, finish_reason: null },
            ],
          },
          {
            id: "direct-1",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          },
        ]);
      },
    });
    const events: ExecutionEvent[] = [];
    for await (const e of adapter.execute({
      deployment: { ...deployment, transport: "direct" },
      request,
      signal: new AbortController().signal,
    }))
      events.push(e);
    expect(captured.provider).toBeUndefined();
    expect(events.at(-1)).toMatchObject({
      usage: { actualCostMicros: null, reconciliation: "pending" },
    });
  });
  it("never retries a billable POST after failure", async () => {
    let calls = 0;
    const adapter = new CompatibleAdapter({
      apiKey: "secret",
      baseURL: "https://openrouter.ai/api/v1",
      fetch: async () => {
        calls++;
        return new Response("unavailable", { status: 503 });
      },
    });
    await expect(async () => {
      for await (const _ of adapter.execute({
        deployment,
        request,
        signal: new AbortController().signal,
      })) {
      }
    }).rejects.toThrow();
    expect(calls).toBe(1);
  });
  it("rejects unsupported features before dispatch", async () => {
    let calls = 0;
    const adapter = new CompatibleAdapter({
      apiKey: "secret",
      baseURL: "https://test.invalid",
      fetch: async () => {
        calls++;
        throw Error();
      },
    });
    await expect(async () => {
      for await (const _ of adapter.execute({
        deployment: {
          ...deployment,
          capabilities: { ...deployment.capabilities, tools: false },
        },
        request: {
          ...request,
          tools: [
            {
              name: "lookup",
              description: "lookup",
              parameters: { type: "object" },
            },
          ],
        },
        signal: new AbortController().signal,
      })) {
      }
    }).rejects.toThrow();
    expect(calls).toBe(0);
  });
  it("looks up unknown charges without treating lookup failures as zero", async () => {
    expect(
      await reconcileOpenRouter(
        "gen-test",
        "key",
        async () => new Response("", { status: 404 }),
      ),
    ).toBeNull();
    expect(
      await reconcileOpenRouter("gen-test", "key", async () =>
        Response.json({ data: { total_cost: 0.02 } }),
      ),
    ).toBe(20000);
  });
});
it("reports partial stream failure with pending generation reconciliation instead of completion", async () => {
  const adapter = new CompatibleAdapter({
    apiKey: "secret",
    baseURL: "https://fixture.invalid",
    fetch: async () =>
      response([
        {
          id: "gen-partial",
          choices: [
            { index: 0, delta: { content: "partial" }, finish_reason: null },
          ],
        },
      ]),
  });
  const events: ExecutionEvent[] = [];
  await expect(async () => {
    for await (const event of adapter.execute({
      deployment,
      request,
      signal: new AbortController().signal,
    }))
      events.push(event);
  }).rejects.toThrow(/Provider/);
  expect(events).toContainEqual({ type: "text_delta", text: "partial" });
  expect(events.at(-1)).toMatchObject({
    type: "usage",
    usage: {
      generationId: "gen-partial",
      reconciliation: "pending",
      actualCostMicros: null,
    },
  });
});
