import { vi } from "vitest";
import type OpenAI from "openai";
import type { ChatCompletionMessage } from "openai/resources/chat/completions";

export function createFakeOpenAI() {
  return {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  };
}

export type FakeOpenAI = ReturnType<typeof createFakeOpenAI>;
export function asOpenAI(fake: FakeOpenAI): OpenAI {
  return fake as unknown as OpenAI;
}

export function completionOf(message: Partial<ChatCompletionMessage>): { choices: [{ message: ChatCompletionMessage }] } {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          refusal: null,
          ...message,
        } as ChatCompletionMessage,
      },
    ],
  };
}

let callCounter = 0;
export function toolCall(name: string, args: unknown) {
  callCounter += 1;
  return { id: `call_${callCounter}`, type: "function" as const, function: { name, arguments: JSON.stringify(args) } };
}
