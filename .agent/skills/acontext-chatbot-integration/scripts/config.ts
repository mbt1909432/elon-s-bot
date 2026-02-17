/**
 * Environment configuration for LLM and Acontext
 * Copy this file to your project and adjust paths/aliases as needed.
 */

import type { LLMConfig, AcontextConfig } from "./types";

/**
 * Load LLM configuration from environment
 */
export function getLLMConfig(): LLMConfig {
  const endpoint = process.env.OPENAI_LLM_ENDPOINT;
  const apiKey = process.env.OPENAI_LLM_API_KEY;

  if (!endpoint) {
    throw new Error("OPENAI_LLM_ENDPOINT is not set");
  }
  if (!apiKey) {
    throw new Error("OPENAI_LLM_API_KEY is not set");
  }

  return {
    endpoint,
    apiKey,
    model: process.env.OPENAI_LLM_MODEL ?? "gpt-4o-mini",
    temperature: process.env.OPENAI_LLM_TEMPERATURE
      ? parseFloat(process.env.OPENAI_LLM_TEMPERATURE)
      : 0.7,
    maxTokens: process.env.OPENAI_LLM_MAX_TOKENS
      ? parseInt(process.env.OPENAI_LLM_MAX_TOKENS, 10)
      : 2048,
  };
}

/**
 * Load Acontext configuration from environment
 * Returns null if Acontext is not configured (for optional usage)
 */
export function getAcontextConfig(): AcontextConfig | null {
  const apiKey = process.env.ACONTEXT_API_KEY;

  if (!apiKey) {
    console.warn("[Acontext] ACONTEXT_API_KEY is not set, Acontext features disabled");
    return null;
  }

  return {
    apiKey,
    baseUrl: process.env.ACONTEXT_BASE_URL ?? "https://api.acontext.com/api/v1",
  };
}

/**
 * Check if Acontext is configured
 */
export function isAcontextConfigured(): boolean {
  return !!process.env.ACONTEXT_API_KEY;
}
