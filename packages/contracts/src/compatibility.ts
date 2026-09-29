import { z } from "zod";
import { InferenceRequestSchema, type InferenceRequest } from "./index";
const CompatMessage = z.strictObject({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z
    .union([
      z.string(),
      z.array(
        z.union([
          z.strictObject({ type: z.literal("text"), text: z.string() }),
          z.strictObject({
            type: z.literal("image_url"),
            image_url: z.strictObject({ url: z.url() }),
          }),
        ]),
      ),
    ])
    .nullable()
    .optional(),
  tool_call_id: z.string().optional(),
  tool_calls: z
    .array(
      z.strictObject({
        id: z.string(),
        type: z.literal("function"),
        function: z.strictObject({ name: z.string(), arguments: z.string() }),
      }),
    )
    .optional(),
});
export const ChatCompletionRequestSchema = z
  .strictObject({
    model: z.string(),
    messages: z.array(CompatMessage).min(1),
    stream: z.boolean().default(false),
    max_tokens: z.number().int().positive().optional(),
    max_completion_tokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
    tools: z
      .array(
        z.strictObject({
          type: z.literal("function"),
          function: z.strictObject({
            name: z.string(),
            description: z.string().optional(),
            parameters: z.record(z.string(), z.unknown()),
          }),
        }),
      )
      .optional(),
    tool_choice: z.enum(["auto", "none", "required"]).optional(),
    response_format: z
      .strictObject({
        type: z.literal("json_schema"),
        json_schema: z.strictObject({
          name: z.string(),
          strict: z.literal(true).optional(),
          schema: z.record(z.string(), z.unknown()),
        }),
      })
      .optional(),
    stream_options: z.strictObject({ include_usage: z.boolean() }).optional(),
  })
  .refine(
    (x) => !(x.max_tokens && x.max_completion_tokens),
    "Use only one output-token limit",
  );
export function translateChatCompletion(
  body: unknown,
  defaults: {
    policyId: string;
    maxOutputTokens: number;
    idempotencyKey: string;
    sessionId?: string;
  },
): {
  request: InferenceRequest;
  stream: boolean;
  includeUsage: boolean;
  model: string;
} {
  const b = ChatCompletionRequestSchema.parse(body);
  const policyId =
    b.model === "vispr/default"
      ? defaults.policyId
      : b.model.startsWith("vispr/policy/")
        ? b.model.slice("vispr/policy/".length)
        : "";
  if (!policyId) throw new Error("Unsupported virtual model");
  const messages = b.messages.map((m) => {
    if (
      (m.tool_calls && m.role !== "assistant") ||
      (m.tool_call_id && m.role !== "tool")
    )
      throw new Error("Invalid tool message");
    if (m.role === "tool")
      return { role: m.role, content: m.content, toolCallId: m.tool_call_id };
    if (m.role === "assistant")
      return {
        role: m.role,
        content: m.content ?? "",
        ...(m.tool_calls
          ? {
              toolCalls: m.tool_calls.map((t) => ({
                id: t.id,
                name: t.function.name,
                arguments: t.function.arguments,
              })),
            }
          : {}),
      };
    return {
      role: m.role,
      content: Array.isArray(m.content)
        ? m.content.map((c) =>
            c.type === "text" ? c : { type: c.type, url: c.image_url.url },
          )
        : m.content,
    };
  });
  return {
    request: InferenceRequestSchema.parse({
      ...defaults,
      policyId,
      messages,
      maxOutputTokens:
        b.max_completion_tokens ?? b.max_tokens ?? defaults.maxOutputTokens,
      ...(b.temperature !== undefined ? { temperature: b.temperature } : {}),
      ...(b.tool_choice ? { toolChoice: b.tool_choice } : {}),
      ...(b.tools
        ? {
            tools: b.tools.map((t) => ({
              name: t.function.name,
              description: t.function.description ?? "",
              parameters: t.function.parameters,
            })),
          }
        : {}),
      ...(b.response_format
        ? { outputSchema: b.response_format.json_schema.schema }
        : {}),
    }),
    stream: b.stream,
    includeUsage: b.stream_options?.include_usage ?? false,
    model: b.model,
  };
}
