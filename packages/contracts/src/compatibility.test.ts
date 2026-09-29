import { it, expect } from "vitest";
import { translateChatCompletion } from "./compatibility";
const defaults = {
  policyId: "balanced",
  maxOutputTokens: 100,
  idempotencyKey: "test",
};
it("accepts standard assistant tool calls with omitted content and portable tool results", () => {
  const translated = translateChatCompletion(
    {
      model: "vispr/default",
      messages: [
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call1",
              type: "function",
              function: { name: "lookup", arguments: "{}" },
            },
          ],
        },
        { role: "tool", tool_call_id: "call1", content: "result" },
      ],
    },
    defaults,
  );
  expect(translated.request.messages).toEqual([
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "call1", name: "lookup", arguments: "{}" }],
    },
    { role: "tool", content: "result", toolCallId: "call1" },
  ]);
});
it("rejects invalid tool arguments/results and required tool choice without tools before spending", () => {
  expect(() =>
    translateChatCompletion(
      {
        model: "vispr/default",
        messages: [
          {
            role: "assistant",
            tool_calls: [
              {
                id: "call1",
                type: "function",
                function: { name: "lookup", arguments: "not-json" },
              },
            ],
          },
        ],
      },
      defaults,
    ),
  ).toThrow();
  expect(() =>
    translateChatCompletion(
      {
        model: "vispr/default",
        messages: [
          { role: "tool", tool_call_id: "unknown", content: "result" },
        ],
      },
      defaults,
    ),
  ).toThrow();
  expect(() =>
    translateChatCompletion(
      {
        model: "vispr/default",
        messages: [{ role: "user", content: "hi" }],
        tool_choice: "required",
      },
      defaults,
    ),
  ).toThrow();
});
