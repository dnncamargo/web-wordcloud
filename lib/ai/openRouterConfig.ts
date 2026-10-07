import "server-only";

export const DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-v4-flash-0731";

export function getOpenRouterApiKey() {
  return process.env.OPENROUTER_API_KEY?.trim() || null;
}

export function hasOpenRouterApiKey() {
  return Boolean(getOpenRouterApiKey());
}

export function getOpenRouterModel() {
  return process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
}
