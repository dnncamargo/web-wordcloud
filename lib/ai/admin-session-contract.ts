export type AiSessionState = Readonly<{
  configured: boolean;
  authenticated: boolean;
}>;

export function isAiSessionState(value: unknown): value is AiSessionState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const candidate = value as Record<string, unknown>;

  return (
    Object.keys(candidate).sort().join(",") === "authenticated,configured" &&
    typeof candidate.configured === "boolean" &&
    typeof candidate.authenticated === "boolean"
  );
}
