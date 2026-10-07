import "server-only";

import { getAiAdminSession } from "@/lib/ai/admin-session";
import { authorizePaidTriage } from "@/lib/ai/guardrails";
import { hasOpenRouterApiKey } from "@/lib/ai/openRouterConfig";
import { triagePendingWords } from "@/lib/ai/openRouterTriage";
import { createAiTriagePost } from "@/lib/ai/triage-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = createAiTriagePost({
  getSession: getAiAdminSession,
  hasProvider: hasOpenRouterApiKey,
  authorizePaidTriage,
  triagePendingWords,
});
