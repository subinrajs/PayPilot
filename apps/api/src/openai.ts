import OpenAI from "openai";

export function createOpenAIClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "Missing OPENAI_API_KEY. Copy apps/api/.env.example to apps/api/.env and fill in an OpenAI API key.",
    );
  }
  return new OpenAI({ apiKey: key });
}

export const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
