import { translateChatCompletion } from "@vispr/contracts/compatibility";
import {
  prepare,
  authenticate,
  execute,
  sse,
  errorResponse,
  newIdempotencyKey,
  PlatformError,
} from "../../../../lib/platform";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    const app = await authenticate(req);
    let translated: ReturnType<typeof translateChatCompletion>;
    try {
      translated = translateChatCompletion(await req.json(), {
        policyId: app.default_policy_id,
        maxOutputTokens: 1500,
        idempotencyKey:
          req.headers.get("Idempotency-Key") ?? newIdempotencyKey(),
        ...(req.headers.get("X-Vispr-Session-Id")
          ? { sessionId: req.headers.get("X-Vispr-Session-Id")! }
          : {}),
      });
    } catch {
      throw new PlatformError(
        "INVALID_REQUEST",
        "Invalid or unsupported chat completion parameters",
      );
    }
    const run = await prepare(req, translated.request);
    const abort = new AbortController();
    const events = execute(run, AbortSignal.any([req.signal, abort.signal]));
    const created = Math.floor(Date.now() / 1000);
    const id = `chatcmpl-${run.id}`;
    const tools = new Map<string, number>();
    let toolIndex = 0;
    let finishReason = "stop";
    function chunk(delta: unknown, finish: string | null = null) {
      return {
        id,
        object: "chat.completion.chunk",
        created,
        model: translated.model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      };
    }
    if (translated.stream) {
      async function* frames() {
        let finalUsage: unknown;
        yield `data: ${JSON.stringify(chunk({ role: "assistant", content: "" }))}\n\n`;
        for await (const event of events) {
          if (event.type === "text_delta")
            yield `data: ${JSON.stringify(chunk({ content: event.text }))}\n\n`;
          if (event.type === "tool_delta") {
            if (!tools.has(event.toolCallId))
              tools.set(event.toolCallId, toolIndex++);
            yield `data: ${JSON.stringify(chunk({ tool_calls: [{ index: tools.get(event.toolCallId), ...(event.name ? { id: event.toolCallId, type: "function" } : {}), function: { ...(event.name ? { name: event.name } : {}), arguments: event.argumentsDelta } }] }))}\n\n`;
          }
          if (event.type === "usage")
            finishReason = event.usage.finishReason ?? "stop";
          if (event.type === "usage")
            finalUsage = {
              prompt_tokens: event.usage.inputTokens,
              completion_tokens: event.usage.outputTokens,
              total_tokens: event.usage.inputTokens + event.usage.outputTokens,
            };
          if (event.type === "error") {
            yield `data: ${JSON.stringify({ error: { code: event.code, message: event.message, partial: event.partial } })}\n\n`;
            yield "data: [DONE]\n\n";
            return;
          }
          if (event.type === "completed")
            yield `data: ${JSON.stringify(chunk({}, tools.size ? "tool_calls" : finishReason))}\n\n`;
        }
        if (translated.includeUsage && finalUsage)
          yield `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: translated.model, choices: [], usage: finalUsage })}\n\n`;
        yield "data: [DONE]\n\n";
      }
      return new Response(
        sse(frames(), () => abort.abort()),
        {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-store",
            "X-Vispr-Request-Id": run.id,
          },
        },
      );
    }
    let text = "";
    let usage: unknown;
    const calls = new Map<
      string,
      {
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }
    >();
    for await (const event of events) {
      if (event.type === "text_delta") text += event.text;
      if (event.type === "tool_delta") {
        const call = calls.get(event.toolCallId) ?? {
          id: event.toolCallId,
          type: "function",
          function: { name: "", arguments: "" },
        };
        if (event.name) call.function.name = event.name;
        call.function.arguments += event.argumentsDelta;
        calls.set(event.toolCallId, call);
      }
      if (event.type === "usage")
        finishReason = event.usage.finishReason ?? "stop";
      if (event.type === "usage")
        usage = {
          prompt_tokens: event.usage.inputTokens,
          completion_tokens: event.usage.outputTokens,
          total_tokens: event.usage.inputTokens + event.usage.outputTokens,
        };
      if (event.type === "error")
        return Response.json(
          { error: { code: event.code, message: event.message } },
          { status: 502, headers: { "X-Vispr-Request-Id": run.id } },
        );
    }
    return Response.json(
      {
        id,
        object: "chat.completion",
        created,
        model: translated.model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: text,
              ...(calls.size ? { tool_calls: [...calls.values()] } : {}),
            },
            finish_reason: calls.size ? "tool_calls" : finishReason,
          },
        ],
        usage,
      },
      { headers: { "X-Vispr-Request-Id": run.id } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
