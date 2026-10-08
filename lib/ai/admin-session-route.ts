import "server-only";

import type {
  AiAdminSession,
} from "@/lib/ai/admin-session";
import type {
  AiLoginIdentity,
  GuardrailDecision,
} from "@/lib/ai/guardrails";
import {
  hasOversizedContentLength,
  isJsonRequest,
  isSameOrigin,
  jsonNoStore,
} from "@/lib/ai/http";
import { readBoundedRequestBody } from "@/lib/ai/triageInput";

const MAX_REQUEST_BODY_BYTES = 4 * 1024;
const MAX_PASSWORD_LENGTH = 1024;

type SessionState = {
  configured: boolean;
  authenticated: boolean;
};

export type AiAdminSessionRouteDependencies = Readonly<{
  getSession: () => Promise<AiAdminSession | null>;
  hasProvider: () => boolean;
  getModel: () => string;
  authenticatePassword: (password: string) => boolean;
  createSession: () => string | null;
  setSessionCookie: (value: string) => Promise<void>;
  clearSessionCookie: () => Promise<void>;
  checkLoginAttempt: (
    identity: AiLoginIdentity,
  ) => Promise<GuardrailDecision>;
  getClientIdentity: (request: Request) => AiLoginIdentity | null;
}>;

function getSessionState(
  dependencies: AiAdminSessionRouteDependencies,
  authenticated: boolean,
): SessionState {
  const configured = dependencies.hasProvider();

  return {
    configured,
    authenticated: configured && authenticated,
  };
}

async function readPassword(request: Request): Promise<string | null> {
  const bodyResult = await readBoundedRequestBody(request, MAX_REQUEST_BODY_BYTES);

  if (bodyResult.status !== "ok") return null;

  try {
    const payload: unknown = JSON.parse(bodyResult.body);

    if (
      typeof payload !== "object" ||
      payload === null ||
      Array.isArray(payload) ||
      Object.keys(payload).length !== 1 ||
      !("password" in payload) ||
      typeof payload.password !== "string" ||
      payload.password.length > MAX_PASSWORD_LENGTH
    ) {
      return null;
    }

    return payload.password;
  } catch {
    return null;
  }
}

export function createAiAdminSessionHandlers(
  dependencies: AiAdminSessionRouteDependencies,
) {
  return {
    async GET() {
      const session = await dependencies.getSession();

      return jsonNoStore(getSessionState(dependencies, Boolean(session)));
    },

    async POST(request: Request) {
      if (!isSameOrigin(request)) {
        return jsonNoStore({ error: "Requisição inválida." }, 403);
      }

      if (!isJsonRequest(request)) {
        return jsonNoStore({ error: "Requisição inválida." }, 415);
      }

      if (hasOversizedContentLength(request, MAX_REQUEST_BODY_BYTES)) {
        return jsonNoStore({ error: "Não foi possível ativar a IA." }, 401);
      }

      if (!dependencies.hasProvider()) {
        return jsonNoStore({ error: "Não foi possível ativar a IA." }, 401);
      }

      const password = await readPassword(request);

      if (password === null) {
        return jsonNoStore({ error: "Não foi possível ativar a IA." }, 401);
      }

      const identity = dependencies.getClientIdentity(request);

      if (identity === null) {
        return jsonNoStore({ error: "Não foi possível ativar a IA." }, 503);
      }

      let decision: GuardrailDecision;

      try {
        decision = await dependencies.checkLoginAttempt(identity);
      } catch {
        return jsonNoStore({ error: "Não foi possível ativar a IA." }, 503);
      }

      if (decision.status === "limited") {
        return jsonNoStore({ error: "Não foi possível ativar a IA." }, 429);
      }

      if (decision.status !== "allowed") {
        return jsonNoStore({ error: "Não foi possível ativar a IA." }, 503);
      }

      if (!dependencies.authenticatePassword(password)) {
        return jsonNoStore({ error: "Não foi possível ativar a IA." }, 401);
      }

      const session = dependencies.createSession();

      if (!session) {
        return jsonNoStore({ error: "Não foi possível ativar a IA." }, 401);
      }

      await dependencies.setSessionCookie(session);

      return jsonNoStore(getSessionState(dependencies, true));
    },

    async DELETE(request: Request) {
      if (!isSameOrigin(request)) {
        return jsonNoStore({ error: "Requisição inválida." }, 403);
      }

      await dependencies.clearSessionCookie();

      return jsonNoStore(getSessionState(dependencies, false));
    },
  };
}
