import {
  InferenceRequestSchema,
  TraceEventSchema,
  type InferenceRequest,
  type TraceEvent,
} from "@vispr/contracts";
export interface VisprClient {
  stream(
    request: InferenceRequest,
    options?: { signal?: AbortSignal },
  ): AsyncIterable<TraceEvent>;
  cancel(requestId: string): Promise<void>;
}
export class VisprError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
export async function* readSSE(response: Response): AsyncIterable<string> {
  if (!response.body)
    throw new VisprError("INVALID_RESPONSE", "Missing stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const data = block
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).replace(/^ /, ""))
          .join("\n");
        if (data) yield data;
      }
      if (buffer.length > 1_000_000)
        throw new VisprError("INVALID_RESPONSE", "Stream frame too large");
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export class Vispr implements VisprClient {
  private readonly baseURL: string;
  private readonly fetcher: typeof fetch;
  constructor(
    private readonly options: {
      apiKey: string;
      baseURL: string;
      fetch?: typeof fetch;
    },
  ) {
    this.baseURL = options.baseURL.replace(/\/$/, "");
    this.fetcher = options.fetch ?? fetch;
  }
  private async call(path: string, init: RequestInit = {}) {
    const response = await this.fetcher(`${this.baseURL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string };
      };
      throw new VisprError(
        body.error?.code ?? "API_ERROR",
        body.error?.message ?? "Request failed",
        response.status,
      );
    }
    return response;
  }
  readonly inference = {
    stream: (
      request: InferenceRequest,
      options?: { signal?: AbortSignal },
    ) => ({ events: this.stream(request, options) }),
    generate: async (
      request: InferenceRequest,
      options?: { signal?: AbortSignal },
    ) => {
      let text = "";
      const events: TraceEvent[] = [];
      for await (const event of this.stream(request, options)) {
        events.push(event);
        if (event.type === "text_delta") text += event.text;
        if (event.type === "error")
          throw new VisprError(event.code, event.message);
      }
      return { text, events };
    },
  };
  async *stream(
    request: InferenceRequest,
    options?: { signal?: AbortSignal },
  ): AsyncIterable<TraceEvent> {
    const response = await this.call("/api/inference/stream", {
      method: "POST",
      body: JSON.stringify(InferenceRequestSchema.parse(request)),
      ...(options?.signal ? { signal: options.signal } : {}),
    });
    let previous = -1;
    let requestId: string | undefined;
    let terminal = false;
    for await (const data of readSSE(response)) {
      const event = TraceEventSchema.parse(JSON.parse(data));
      if (
        event.sequence <= previous ||
        (requestId && requestId !== event.requestId) ||
        terminal
      )
        throw new VisprError("INVALID_RESPONSE", "Invalid event ordering");
      requestId = event.requestId;
      previous = event.sequence;
      terminal = event.type === "completed" || event.type === "error";
      yield event;
    }
    if (!terminal)
      throw new VisprError(
        "PROVIDER_FAILED",
        "Stream interrupted; output may be partial",
      );
  }
  async cancel(requestId: string) {
    await this.call(`/api/requests/${encodeURIComponent(requestId)}/cancel`, {
      method: "POST",
    });
  }
  async trace(requestId: string): Promise<TraceEvent[]> {
    return TraceEventSchema.array().parse(
      await (
        await this.call(`/api/requests/${encodeURIComponent(requestId)}`)
      ).json(),
    );
  }
}
