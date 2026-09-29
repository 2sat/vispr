import { usdToMicros } from "./money";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText, jsonSchema, tool, Output, type ModelMessage } from "ai";
import {
  DeploymentSchema,
  InferenceRequestSchema,
  UsageSchema,
  type Deployment,
  type InferenceRequest,
  type Usage,
} from "@vispr/contracts";
export type ExecutionEvent =
  | { type: "text_delta"; text: string }
  | {
      type: "tool_delta";
      toolCallId: string;
      argumentsDelta: string;
      name?: string;
    }
  | { type: "usage"; usage: Usage };
export interface ExecutionAdapter {
  execute(input: {
    deployment: Deployment;
    request: InferenceRequest;
    signal: AbortSignal;
  }): AsyncIterable<ExecutionEvent>;
}
export function modelMessages(request: InferenceRequest): ModelMessage[] {
  return request.messages.map((m) => {
    if (m.role === "tool")
      return {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: m.toolCallId,
            toolName: request.messages
              .flatMap((x) =>
                x.role === "assistant" ? (x.toolCalls ?? []) : [],
              )
              .find((t) => t.id === m.toolCallId)!.name,
            output: { type: "text", value: m.content },
          },
        ],
      };
    if (m.role === "assistant")
      return {
        role: "assistant",
        content: [
          { type: "text", text: m.content },
          ...(m.toolCalls ?? []).map((t) => ({
            type: "tool-call" as const,
            toolCallId: t.id,
            toolName: t.name,
            input: JSON.parse(t.arguments),
          })),
        ],
      };
    if (m.role === "user" && Array.isArray(m.content))
      return {
        role: "user",
        content: m.content.map((c) =>
          c.type === "text"
            ? c
            : { type: "image" as const, image: new URL(c.url) },
        ),
      };
    return { role: m.role, content: m.content as string };
  });
}
export class CompatibleAdapter implements ExecutionAdapter {
  constructor(
    private readonly config: {
      apiKey: string;
      baseURL: string;
      fetch?: typeof fetch;
    },
  ) {}
  async *execute(input: {
    deployment: Deployment;
    request: InferenceRequest;
    signal: AbortSignal;
  }): AsyncIterable<ExecutionEvent> {
    const deployment = DeploymentSchema.parse(input.deployment);
    const request = InferenceRequestSchema.parse(input.request);
    if (!this.config.apiKey || deployment.status !== "active")
      throw new Error("Deployment is not configured or active");
    const caps = deployment.capabilities;
    if (
      !caps.streaming ||
      request.maxOutputTokens > caps.maxOutputTokens ||
      (request.tools?.length && !caps.tools) ||
      (request.outputSchema && !caps.structuredOutput) ||
      (request.messages.some(
        (m) =>
          Array.isArray(m.content) &&
          m.content.some((c) => c.type === "image_url"),
      ) &&
        !caps.vision)
    )
      throw new Error("Unsupported deployment capabilities");
    let cost: number | null = null;
    let servingProvider: string | undefined;
    let generationId: string | undefined;
    let finishReason: string | undefined;
    const provider = createOpenAICompatible({
      name: "vispr",
      baseURL: this.config.baseURL,
      apiKey: this.config.apiKey,
      ...(this.config.fetch ? { fetch: this.config.fetch } : {}),
      includeUsage: true,
      supportsStructuredOutputs: caps.structuredOutput,
      transformRequestBody: (body) =>
        deployment.transport === "openrouter"
          ? {
              ...body,
              provider: {
                only: [deployment.providerSlug],
                allow_fallbacks: false,
                require_parameters: true,
              },
            }
          : body,
      metadataExtractor: {
        extractMetadata: async () => undefined,
        createStreamExtractor: () => ({
          processChunk(chunk) {
            const c = chunk as {
              id?: string;
              provider?: string;
              choices?: { finish_reason?: string | null }[];
              usage?: { cost?: number };
            };
            if (c.id) generationId = c.id;
            if (c.choices?.[0]?.finish_reason)
              finishReason = c.choices[0].finish_reason;
            if (c.provider) servingProvider = c.provider;
            if (
              typeof c.usage?.cost === "number" &&
              Number.isFinite(c.usage.cost) &&
              c.usage.cost >= 0
            )
              cost = usdToMicros(c.usage.cost);
          },
          buildMetadata: () =>
            servingProvider ? { vispr: { servingProvider } } : undefined,
        }),
      },
    });
    const result = streamText({
      model: provider.chatModel(deployment.inferenceModelId),
      messages: modelMessages(request),
      allowSystemInMessages: true,
      ...(request.temperature !== undefined
        ? { temperature: request.temperature }
        : {}),
      ...(request.toolChoice ? { toolChoice: request.toolChoice } : {}),
      maxOutputTokens: request.maxOutputTokens,
      maxRetries: 0,
      streamRetries: 0,
      onError: () => {},
      abortSignal: input.signal,
      ...(request.tools?.length
        ? {
            tools: Object.fromEntries(
              request.tools.map((t) => [
                t.name,
                tool({
                  description: t.description,
                  inputSchema: jsonSchema(t.parameters),
                }),
              ]),
            ),
          }
        : {}),
      ...(request.outputSchema
        ? {
            output: Output.object({ schema: jsonSchema(request.outputSchema) }),
          }
        : {}),
    });
    let announcedGeneration = false;
    try {
      for await (const part of result.fullStream) {
        if (generationId && !announcedGeneration) {
          announcedGeneration = true;
          yield {
            type: "usage",
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              actualCostMicros: null,
              generationId,
              reconciliation: "pending",
              ...(servingProvider ? { servingProvider } : {}),
            },
          };
        }
        if (part.type === "text-delta")
          yield { type: "text_delta", text: part.text };
        if (part.type === "tool-input-start")
          yield {
            type: "tool_delta",
            toolCallId: part.id,
            name: part.toolName,
            argumentsDelta: "",
          };
        if (part.type === "tool-input-delta")
          yield {
            type: "tool_delta",
            toolCallId: part.id,
            argumentsDelta: part.delta,
          };
        if (part.type === "error") throw new Error("Provider execution failed");
        if (part.type === "abort")
          throw new Error("Provider execution cancelled");
      }
      if (input.signal.aborted) throw new Error("Provider execution cancelled");
      if (!finishReason)
        throw new Error("Provider stream ended without a completion");
    } catch (error) {
      yield {
        type: "usage",
        usage: UsageSchema.parse({
          inputTokens: 0,
          outputTokens: 0,
          actualCostMicros: cost,
          ...(servingProvider ? { servingProvider } : {}),
          ...(generationId ? { generationId } : {}),
          reconciliation: cost === null ? "pending" : "settled",
        }),
      };
      throw error;
    }
    const usage = await result.totalUsage;
    const response = await result.response;
    yield {
      type: "usage",
      usage: UsageSchema.parse({
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        actualCostMicros: cost,
        ...(servingProvider ? { servingProvider } : {}),
        finishReason: [
          "stop",
          "length",
          "tool_calls",
          "content_filter",
        ].includes(finishReason ?? "")
          ? finishReason
          : "unknown",
        ...(response.id ? { generationId: response.id } : {}),
        reconciliation: cost === null ? "pending" : "settled",
      }),
    };
  }
}
export async function reconcileOpenRouter(
  generationId: string,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<number | null> {
  const response = await fetcher(
    `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(generationId)}`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok) return null;
  const body = (await response.json()) as { data?: { total_cost?: number } };
  const cost = body.data?.total_cost;
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0
    ? usdToMicros(cost)
    : null;
}
/** A free serving-inventory probe; feature claims require separate live verification. */
export async function probeEndpoint(config: {
  baseURL: string;
  apiKey: string;
  modelId: string;
  fetch?: typeof fetch;
}) {
  try {
    const response = await (config.fetch ?? fetch)(
      `${config.baseURL.replace(/\/$/, "")}/models`,
      {
        headers: { Authorization: `Bearer ${config.apiKey}` },
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok)
      return {
        reachable: false,
        modelAvailable: false,
        featuresVerified: false,
      };
    const body = (await response.json()) as { data?: { id: string }[] };
    return {
      reachable: true,
      modelAvailable:
        Array.isArray(body.data) &&
        body.data.some((m) => m.id === config.modelId),
      featuresVerified: false,
    };
  } catch {
    return { reachable: false, modelAvailable: false, featuresVerified: false };
  }
}
