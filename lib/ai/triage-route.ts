import "server-only";

import type { AiAdminSession } from "@/lib/ai/admin-session";
import type { GuardrailDecision } from "@/lib/ai/guardrails";
import {
  getOpenRouterTriageFailureDiagnostic,
  type OpenRouterTriageFailureDiagnostic,
  type TriageResult,
} from "@/lib/ai/openRouterTriage";
import {
  hasOversizedContentLength,
  isJsonRequest,
  isSameOrigin,
  jsonNoStore,
} from "@/lib/ai/http";
import {
  MAX_BODY_BYTES,
  readAndValidatePaidTriageInput,
} from "@/lib/ai/triageInput";

export type AiTriageRouteDependencies = Readonly<{
  getSession: () => Promise<AiAdminSession | null>;
  hasProvider: () => boolean;
  authorizePaidTriage: () => Promise<GuardrailDecision>;
  triagePendingWords: (input: unknown) => Promise<TriageResult[]>;
  logFailure: (diagnostic: OpenRouterTriageFailureDiagnostic) => void;
}>;

export function createAiTriagePost(
  dependencies: AiTriageRouteDependencies,
) {
  return async function POST(request: Request) {
    if (!isSameOrigin(request)) {
      return jsonNoStore({ error: "Requisição inválida." }, 403);
    }

    if (!isJsonRequest(request)) {
      return jsonNoStore({ error: "Requisição inválida." }, 415);
    }

    if (hasOversizedContentLength(request, MAX_BODY_BYTES)) {
      return jsonNoStore({ error: "Requisição muito grande." }, 413);
    }

    const session = await dependencies.getSession();

    if (!session) {
      return jsonNoStore({ error: "Autenticação necessária." }, 401);
    }

    const inputResult = await readAndValidatePaidTriageInput(request);

    if (inputResult.status === "too-large") {
      return jsonNoStore({ error: "Requisição muito grande." }, 413);
    }

    if (inputResult.status !== "ok") {
      return jsonNoStore({ error: "Entrada de triagem inválida." }, 400);
    }

    if (inputResult.input.pendingWords.length === 0) {
      return jsonNoStore([]);
    }

    if (!dependencies.hasProvider()) {
      return jsonNoStore({ error: "Serviço de IA indisponível." }, 503);
    }

    let decision: GuardrailDecision;

    try {
      decision = await dependencies.authorizePaidTriage();
    } catch {
      return jsonNoStore({ error: "Serviço de IA indisponível." }, 503);
    }

    if (decision.status === "limited") {
      return jsonNoStore({ error: "Limite de uso atingido." }, 429);
    }

    if (decision.status !== "allowed") {
      return jsonNoStore({ error: "Serviço de IA indisponível." }, 503);
    }

    try {
      const results = await dependencies.triagePendingWords(inputResult.input);
      return jsonNoStore(results);
    } catch (error) {
      dependencies.logFailure(getOpenRouterTriageFailureDiagnostic(error));
      return jsonNoStore({ error: "Serviço de IA indisponível." }, 503);
    }
  };
}
