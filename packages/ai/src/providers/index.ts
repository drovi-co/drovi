import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "@ai-sdk/provider";

// Provider types
export type AIProvider = "openai" | "anthropic" | "google" | "groq";

// Model configurations per provider
export const MODELS = {
  openai: {
    "gpt-5.2": "gpt-5.2",
    "gpt-4o": "gpt-4o",
    "gpt-4o-mini": "gpt-4o-mini",
    "gpt-4-turbo": "gpt-4-turbo",
    "gpt-3.5-turbo": "gpt-3.5-turbo",
  },
  anthropic: {
    "claude-3-5-sonnet": "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku": "claude-3-5-haiku-20241022",
    "claude-3-opus": "claude-3-opus-20240229",
  },
  google: {
    "gemini-2.0-flash": "gemini-2.0-flash-exp",
    "gemini-1.5-pro": "gemini-1.5-pro",
    "gemini-1.5-flash": "gemini-1.5-flash",
  },
  groq: {
    "llama-3.3-70b": "llama-3.3-70b-versatile",
    "llama-3.1-70b": "llama-3.1-70b-versatile",
    "mixtral-8x7b": "mixtral-8x7b-32768",
  },
} as const;

// Provider instances
let openaiProvider: ReturnType<typeof createOpenAI> | null = null;
let anthropicProvider: ReturnType<typeof createAnthropic> | null = null;
let googleProvider: ReturnType<typeof createGoogleGenerativeAI> | null = null;
let groqProvider: ReturnType<typeof createGroq> | null = null;

// Get or create provider instance
export function getOpenAI() {
  if (!openaiProvider) {
    openaiProvider = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiProvider;
}

export function getAnthropic() {
  if (!anthropicProvider) {
    anthropicProvider = createAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return anthropicProvider;
}

export function getGoogle() {
  if (!googleProvider) {
    googleProvider = createGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    });
  }
  return googleProvider;
}

export function getGroq() {
  if (!groqProvider) {
    groqProvider = createGroq({
      apiKey: process.env.GROQ_API_KEY,
    });
  }
  return groqProvider;
}

// Reasoning models that don't support temperature parameter
export const REASONING_MODELS = new Set([
  "gpt-5.2",
  "o1",
  "o1-mini",
  "o1-preview",
  "o3",
  "o3-mini",
]);

// Check if a model is a reasoning model
export function isReasoningModel(modelName: string): boolean {
  return REASONING_MODELS.has(modelName);
}

// Get model by provider and model name
export function getModel(
  provider: AIProvider,
  modelName?: string
): LanguageModelV1 {
  switch (provider) {
    case "openai": {
      const model = modelName ?? "gpt-5.2";
      return getOpenAI()(model);
    }
    case "anthropic": {
      const model = modelName ?? "claude-3-5-sonnet-20241022";
      return getAnthropic()(model);
    }
    case "google": {
      const model = modelName ?? "gemini-2.0-flash-exp";
      return getGoogle()(model);
    }
    case "groq": {
      const model = modelName ?? "llama-3.3-70b-versatile";
      return getGroq()(model);
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// Get default provider from environment
export function getDefaultProvider(): AIProvider {
  const provider = process.env.AI_PROVIDER as AIProvider;
  if (!provider) {
    return "openai"; // Default to OpenAI
  }
  if (!["openai", "anthropic", "google", "groq"].includes(provider)) {
    throw new Error(`Invalid AI_PROVIDER: ${provider}`);
  }
  return provider;
}

// Get default model for the configured provider
export function getDefaultModel(): LanguageModelV1 {
  return getModel(getDefaultProvider());
}
