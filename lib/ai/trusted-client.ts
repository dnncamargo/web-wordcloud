import "server-only";

import { isIP } from "node:net";

import type { AiLoginIdentity } from "@/lib/ai/guardrails";

const VERCEL_CLIENT_IP_HEADER = "x-vercel-forwarded-for";

export function getTrustedAiLoginIdentity(
  request: Request,
): AiLoginIdentity | null {
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
