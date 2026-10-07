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

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BODY_BYTES = 4 * 1024;
const MAX_PASSWORD_LENGTH = 1024;

type SessionState = {
  configured: boolean;
  authenticated: boolean;
  model?: string;
};

function getSessionState(authenticated: boolean): SessionState {
  const configured = hasOpenRouterApiKey();

  return {
    configured,
    authenticated: configured && authenticated,
    ...(configured ? { model: getOpenRouterModel() } : {}),
  };
}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  });
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");

  if (!origin) return false;

  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function isJsonRequest(request: Request) {
  const contentType = request.headers.get("content-type");

  return contentType?.split(";", 1)[0].trim().toLowerCase() === "application/json";
}

async function readPassword(request: Request) {
  const contentLength = request.headers.get("content-length");

  if (contentLength) {
    const parsedLength = Number(contentLength);

    if (!Number.isSafeInteger(parsedLength) || parsedLength > MAX_REQUEST_BODY_BYTES) {
      return null;
    }
  }

  const body = await request.text();

  if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BODY_BYTES) {
    return null;
  }

  try {
    const payload: unknown = JSON.parse(body);

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

export async function GET() {
  const session = await getAiAdminSession();

  return json(getSessionState(Boolean(session)));
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return json({ error: "Requisição inválida." }, 403);
  }

  if (!isJsonRequest(request)) {
    return json({ error: "Requisição inválida." }, 415);
  }

  if (!hasOpenRouterApiKey()) {
    return json({ error: "Não foi possível ativar a IA." }, 401);
  }

  const password = await readPassword(request);

  if (password === null || !authenticateAiAdminPassword(password)) {
    return json({ error: "Não foi possível ativar a IA." }, 401);
  }

  const session = createAiAdminSession();

  if (!session) {
    return json({ error: "Não foi possível ativar a IA." }, 401);
  }

  await setAiAdminSessionCookie(session);

  return json(getSessionState(true));
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) {
    return json({ error: "Requisição inválida." }, 403);
  }

  await clearAiAdminSessionCookie();

  return json(getSessionState(false));
}
