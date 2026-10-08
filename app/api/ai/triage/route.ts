import "server-only";

import { getAiAdminSession } from "@/lib/ai/admin-session";
import { authorizePaidTriage } from "@/lib/ai/guardrails";
import { hasOpenRouterApiKey } from "@/lib/ai/openRouterConfig";
import {
  triagePendingWords,
  type OpenRouterTriageFailureDiagnostic,
} from "@/lib/ai/openRouterTriage";
import { createAiTriagePost } from "@/lib/ai/triage-route";

function logAiTriageFailure(diagnostic: OpenRouterTriageFailureDiagnostic) {
  console.error("ai_triage_failure", diagnostic);
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = createAiTriagePost({
  getSession: getAiAdminSession,
  hasProvider: hasOpenRouterApiKey,
  authorizePaidTriage,
  triagePendingWords,
  logFailure: logAiTriageFailure,
});
