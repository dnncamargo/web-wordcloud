import "server-only";

import { isIP } from "node:net";

import type { AiLoginIdentity } from "@/lib/ai/guardrails";

const VERCEL_CLIENT_IP_HEADER = "x-forwarded-for";

type Environment = Readonly<Record<string, string | undefined>>;

export function getTrustedAiLoginIdentity(
  request: Request,
  environment: Environment = process.env,
): AiLoginIdentity | null {
  if (environment.VERCEL !== "1") return null;

  const rawValue = request.headers.get(VERCEL_CLIENT_IP_HEADER);

  if (rawValue === null) return null;

  const value = rawValue.trim();

  if (value.length === 0 || value.includes(",") || isIP(value) === 0) {
    return null;
  }

  return {
    source: "platform-forwarded-for",
    value: value.toLowerCase(),
  };
}
