import "server-only";

import {
  authenticateAiAdminPassword,
  clearAiAdminSessionCookie,
  createAiAdminSession,
  getAiAdminSession,
  setAiAdminSessionCookie,
} from "@/lib/ai/admin-session";
import {
  getOpenRouterModel,
  hasOpenRouterApiKey,
} from "@/lib/ai/openRouterConfig";
import { checkAiLoginAttempt } from "@/lib/ai/guardrails";
import { createAiAdminSessionHandlers } from "@/lib/ai/admin-session-route";
import { getTrustedAiLoginIdentity } from "@/lib/ai/trusted-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handlers = createAiAdminSessionHandlers({
  getSession: getAiAdminSession,
  hasProvider: hasOpenRouterApiKey,
  getModel: getOpenRouterModel,
  authenticatePassword: authenticateAiAdminPassword,
  createSession: createAiAdminSession,
  setSessionCookie: setAiAdminSessionCookie,
  clearSessionCookie: clearAiAdminSessionCookie,
  checkLoginAttempt: checkAiLoginAttempt,
  getClientIdentity: getTrustedAiLoginIdentity,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
