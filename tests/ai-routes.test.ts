import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { AiAdminSession } from "../lib/ai/admin-session";
import { createAiAdminSessionHandlers } from "../lib/ai/admin-session-route";
import type { GuardrailDecision } from "../lib/ai/guardrails";
import { createAiTriagePost } from "../lib/ai/triage-route";
import {
  OpenRouterTriageError,
  triagePendingWords,
  type OpenRouterTriageFailureDiagnostic,
  type TriageResult,
} from "../lib/ai/openRouterTriage";
import { getTrustedAiLoginIdentity } from "../lib/ai/trusted-client";

const origin = "https://example.test";

const session: AiAdminSession = {
  role: "ai-admin",
  expiresAt: Math.floor(Date.now() / 1000) + 3_600,
};

const validTriageBody = {
  question: "Como cuidar melhor do ambiente?",
  acceptedWords: [{ id: "accepted-1", text: "Plantar árvores" }],
  pendingWords: [{ id: "pending-1", text: "Reciclar" }],
};

const triageResult: TriageResult = {
  id: "pending-1",
  relevance: 0.8,
  attention: false,
  spellingSuggestion: null,
  mergeTargetId: "accepted-1",
};

function loginRequest(
  body: unknown = { password: "correct" },
  headers: Record<string, string> = {},
) {
  return new Request(`${origin}/api/ai/admin/session`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.10",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function triageRequest(
  body: unknown = validTriageBody,
  headers: Record<string, string> = {},
) {
  return new Request(`${origin}/api/ai/triage`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function responseBody(response: Response) {
  return (await response.json()) as unknown;
}

function assertNoStore(response: Response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
}

function createLoginHandlers(options: {
  decision?: GuardrailDecision;
  identity?: { source: "platform-forwarded-for"; value: string } | null;
  trustedEnvironment?: Readonly<Record<string, string | undefined>>;
  provider?: boolean;
  passwordMatches?: boolean;
} = {}) {
  const calls = {
    limiter: 0,
    password: 0,
    session: 0,
    setCookie: 0,
    clearCookie: 0,
  };
  const handlers = createAiAdminSessionHandlers({
    getSession: async () => null,
    hasProvider: () => options.provider ?? true,
    getModel: () => "test-model",
    authenticatePassword: () => {
      calls.password += 1;
      return options.passwordMatches ?? true;
    },
    createSession: () => {
      calls.session += 1;
      return "signed-session";
    },
    setSessionCookie: async () => {
      calls.setCookie += 1;
    },
    clearSessionCookie: async () => {
      calls.clearCookie += 1;
    },
    checkLoginAttempt: async () => {
      calls.limiter += 1;
      return options.decision ?? { status: "allowed" };
    },
    getClientIdentity: (request) => {
      if (options.trustedEnvironment !== undefined) {
        return getTrustedAiLoginIdentity(request, options.trustedEnvironment);
      }

      return options.identity === undefined
        ? { source: "platform-forwarded-for", value: "203.0.113.10" }
        : options.identity;
    },
  });

  return { calls, handlers };
}

function createTriageHandler(options: {
  decision?: GuardrailDecision;
  session?: AiAdminSession | null;
  provider?: boolean;
  triageError?: Error;
} = {}) {
  const calls = {
    providerCheck: 0,
    guardrail: 0,
    provider: 0,
  };
  const diagnostics: OpenRouterTriageFailureDiagnostic[] = [];
  const handlers = createAiTriagePost({
    getSession: async () => options.session === undefined ? session : options.session,
    hasProvider: () => {
      calls.providerCheck += 1;
      return options.provider ?? true;
    },
    authorizePaidTriage: async () => {
      calls.guardrail += 1;
      return options.decision ?? { status: "allowed" };
    },
    triagePendingWords: async () => {
      calls.provider += 1;
      if (options.triageError) throw options.triageError;
      return [triageResult];
    },
    logFailure: (diagnostic) => {
      diagnostics.push(diagnostic);
    },
  });

  return { calls, diagnostics, handler: handlers };
}

async function runMockedProviderResponse(
  input: unknown,
  providerContent: string,
) {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  const diagnostics: OpenRouterTriageFailureDiagnostic[] = [];

  process.env.OPENROUTER_API_KEY = "test-only-openrouter-key";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [{
          finish_reason: "stop",
          message: { content: providerContent },
        }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  try {
    const handler = createAiTriagePost({
      getSession: async () => session,
      hasProvider: () => true,
      authorizePaidTriage: async () => ({ status: "allowed" }),
      triagePendingWords,
      logFailure: (diagnostic) => {
        diagnostics.push(diagnostic);
      },
    });

    const response = await handler(triageRequest(input));
    return { diagnostics, response };
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalApiKey;
    }
  }
}

test("login rejects malformed, wrong-media, and wrong-origin requests before Redis", async () => {
  for (const request of [
    loginRequest("not-json"),
    new Request(`${origin}/api/ai/admin/session`, {
      method: "POST",
      headers: { origin, "content-type": "text/plain" },
      body: JSON.stringify({ password: "correct" }),
    }),
    loginRequest({ password: "correct" }, { origin: "https://attacker.test" }),
  ]) {
    const { calls, handlers } = createLoginHandlers();
    const response = await handlers.POST(request);
    assert.equal(calls.limiter, 0);
    assert.equal(response.status, request.headers.get("content-type") === "text/plain" ? 415 : request.headers.get("origin") === "https://attacker.test" ? 403 : 401);
    assertNoStore(response);
  }
});

test("valid deployed Vercel login checks the client limiter before password comparison", async () => {
  const order: string[] = [];
  const handlers = createAiAdminSessionHandlers({
    getSession: async () => null,
    hasProvider: () => true,
    getModel: () => "test-model",
    authenticatePassword: () => {
      order.push("password");
      return true;
    },
    createSession: () => "signed-session",
    setSessionCookie: async () => undefined,
    clearSessionCookie: async () => undefined,
    checkLoginAttempt: async () => {
      order.push("limiter");
      return { status: "allowed" };
    },
    getClientIdentity: (request) =>
      getTrustedAiLoginIdentity(request, { VERCEL: "1" }),
  });

  const response = await handlers.POST(loginRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(order, ["limiter", "password"]);
});

test("limited login returns 429 without password comparison or session creation", async () => {
  const { calls, handlers } = createLoginHandlers({ decision: { status: "limited" } });
  const response = await handlers.POST(loginRequest());
  assert.equal(response.status, 429);
  assert.equal(calls.limiter, 1);
  assert.equal(calls.password, 0);
  assert.equal(calls.session, 0);
});

test("unavailable login guardrail returns 503 without password comparison", async () => {
  const { calls, handlers } = createLoginHandlers({ decision: { status: "unavailable" } });
  const response = await handlers.POST(loginRequest());
  assert.equal(response.status, 503);
  assert.equal(calls.password, 0);
  assert.equal(calls.session, 0);
});

test("failed password attempts consume the allowed login quota", async () => {
  const { calls, handlers } = createLoginHandlers({ passwordMatches: false });
  const response = await handlers.POST(loginRequest());
  assert.equal(response.status, 401);
  assert.equal(calls.limiter, 1);
  assert.equal(calls.password, 1);
  assert.equal(calls.session, 0);
});

test("missing or invalid trusted client identity fails closed", async () => {
  const { calls, handlers } = createLoginHandlers({ trustedEnvironment: { VERCEL: "1" } });
  const requests = [
    loginRequest({ password: "correct" }, { "x-forwarded-for": "" }),
    new Request(`${origin}/api/ai/admin/session`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ password: "correct" }),
    }),
  ];

  for (const request of requests) {
    const response = await handlers.POST(request);
    assert.equal(response.status, 503);
  }

  assert.equal(calls.limiter, 0);
  assert.equal(calls.password, 0);
  assert.equal(calls.session, 0);
});

test("trusted client identity accepts only one valid Vercel x-forwarded-for IP", () => {
  for (const value of [undefined, "", "not-an-ip", "203.0.113.10, 198.51.100.7"]) {
    const headers: Record<string, string> = {};
    if (value !== undefined) headers["x-forwarded-for"] = value;
    const request = new Request(`${origin}/api/ai/admin/session`, { headers });
    assert.equal(getTrustedAiLoginIdentity(request, { VERCEL: "1" }), null);
  }

  const request = new Request(`${origin}/api/ai/admin/session`, {
    headers: { "x-forwarded-for": " 2001:DB8::1 " },
  });
  assert.deepEqual(getTrustedAiLoginIdentity(request, { VERCEL: "1" }), {
    source: "platform-forwarded-for",
    value: "2001:db8::1",
  });

  const ipv4Request = new Request(`${origin}/api/ai/admin/session`, {
    headers: { "x-forwarded-for": "203.0.113.10" },
  });
  assert.deepEqual(getTrustedAiLoginIdentity(ipv4Request, { VERCEL: "1" }), {
    source: "platform-forwarded-for",
    value: "203.0.113.10",
  });

  const aliasRequest = new Request(`${origin}/api/ai/admin/session`, {
    headers: { "x-vercel-forwarded-for": "203.0.113.10" },
  });
  assert.equal(getTrustedAiLoginIdentity(aliasRequest, { VERCEL: "1" }), null);

  const outsideVercelRequest = new Request(`${origin}/api/ai/admin/session`, {
    headers: { "x-forwarded-for": "203.0.113.10" },
  });
  assert.equal(getTrustedAiLoginIdentity(outsideVercelRequest, {}), null);
});

test("login GET and DELETE do not consume login quota", async () => {
  const { calls, handlers } = createLoginHandlers();
  const getResponse = await handlers.GET();
  const deleteResponse = await handlers.DELETE(
    new Request(`${origin}/api/ai/admin/session`, {
      method: "DELETE",
      headers: { origin },
    }),
  );
  assert.equal(getResponse.status, 200);
  assert.equal(deleteResponse.status, 200);
  assert.equal(calls.limiter, 0);
  assert.equal(calls.clearCookie, 1);
});

test("triage rejects wrong origin and media type without Redis or provider", async () => {
  const requests = [
    triageRequest(validTriageBody, { origin: "https://attacker.test" }),
    triageRequest(validTriageBody, { "content-type": "text/plain" }),
  ];

  for (const request of requests) {
    const { calls, handler } = createTriageHandler();
    const response = await handler(request);
    assert.equal(response.status, request.headers.get("origin") === "https://attacker.test" ? 403 : 415);
    assert.equal(calls.providerCheck, 0);
    assert.equal(calls.guardrail, 0);
    assert.equal(calls.provider, 0);
    assertNoStore(response);
  }
});

test("unauthenticated triage and oversized content do not reach Redis or provider", async () => {
  const unauthenticated = createTriageHandler({ session: null });
  const unauthenticatedResponse = await unauthenticated.handler(triageRequest());
  assert.equal(unauthenticatedResponse.status, 401);
  assert.equal(unauthenticated.calls.providerCheck, 0);
  assert.equal(unauthenticated.calls.guardrail, 0);
  assert.equal(unauthenticated.calls.provider, 0);

  const earlyOversized = createTriageHandler();
  const earlyResponse = await earlyOversized.handler(
    triageRequest(validTriageBody, { "content-length": "32769" }),
  );
  assert.equal(earlyResponse.status, 413);
  assert.equal(earlyOversized.calls.providerCheck, 0);
  assert.equal(earlyOversized.calls.guardrail, 0);
  assert.equal(earlyOversized.calls.provider, 0);

  const streamedOversized = createTriageHandler();
  const streamedResponse = await streamedOversized.handler(
    triageRequest("x".repeat(32 * 1024 + 1)),
  );
  assert.equal(streamedResponse.status, 413);
  assert.equal(streamedOversized.calls.providerCheck, 0);
  assert.equal(streamedOversized.calls.guardrail, 0);
  assert.equal(streamedOversized.calls.provider, 0);
});

test("invalid triage JSON/schema does not reach Redis or provider", async () => {
  for (const body of ["not-json", { question: "missing lists" }]) {
    const { calls, handler } = createTriageHandler();
    const response = await handler(triageRequest(body));
    assert.equal(response.status, 400);
    assert.equal(calls.providerCheck, 0);
    assert.equal(calls.guardrail, 0);
    assert.equal(calls.provider, 0);
  }
});

test("empty pending triage returns [] without provider configuration or Redis", async () => {
  const { calls, handler } = createTriageHandler({ provider: false });
  const response = await handler(
    triageRequest({ ...validTriageBody, pendingWords: [] }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await responseBody(response), []);
  assert.equal(calls.providerCheck, 0);
  assert.equal(calls.guardrail, 0);
  assert.equal(calls.provider, 0);
});

test("triage guardrail limited or unavailable returns before provider", async () => {
  for (const decision of [{ status: "limited" }, { status: "unavailable" }] as const) {
    const { calls, handler } = createTriageHandler({ decision });
    const response = await handler(triageRequest());
    assert.equal(response.status, decision.status === "limited" ? 429 : 503);
    assert.equal(calls.providerCheck, 1);
    assert.equal(calls.guardrail, 1);
    assert.equal(calls.provider, 0);
  }
});

test("missing provider configuration is checked before paid authorization", async () => {
  const { calls, handler } = createTriageHandler({ provider: false });
  const response = await handler(triageRequest());
  assert.equal(response.status, 503);
  assert.equal(calls.providerCheck, 1);
  assert.equal(calls.guardrail, 0);
  assert.equal(calls.provider, 0);
});

test("allowed triage invokes the provider once and returns validated results", async () => {
  const { calls, handler } = createTriageHandler();
  const response = await handler(triageRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await responseBody(response), [triageResult]);
  assert.equal(calls.providerCheck, 1);
  assert.equal(calls.guardrail, 1);
  assert.equal(calls.provider, 1);
});

test("provider failure is generic and does not expose upstream details", async () => {
  const secret = "OpenRouter secret upstream payload";
  const { calls, handler } = createTriageHandler({ triageError: new Error(secret) });
  const response = await handler(triageRequest());
  const body = JSON.stringify(await responseBody(response));
  assert.equal(response.status, 503);
  assert.equal(body.includes(secret), false);
  assert.equal(calls.provider, 1);
});

test("provider result validation keeps 503 and emits a sanitized diagnostic", async () => {
  const { diagnostics, handler } = createTriageHandler({
    triageError: new OpenRouterTriageError({
      code: "provider_result_incomplete",
      finishReason: "stop",
      expectedResultCount: 1,
      actualResultCount: 0,
    }),
  });
  const response = await handler(triageRequest());

  assert.equal(response.status, 503);
  assert.deepEqual(await responseBody(response), {
    error: "Serviço de IA indisponível.",
  });
  assert.deepEqual(diagnostics, [{
    code: "provider_result_incomplete",
    finishReason: "stop",
    expectedResultCount: 1,
    actualResultCount: 0,
  }]);
});

test("failure diagnostics exclude input, ids, and provider response content", async () => {
  const inputText = "classroom text that must never be logged";
  const providerContent = "provider response content that must never be logged";
  const { diagnostics, handler } = createTriageHandler({
    triageError: new Error(providerContent),
  });
  const response = await handler(
    triageRequest({
      ...validTriageBody,
      question: inputText,
      acceptedWords: [{ id: "accepted-sensitive-id", text: inputText }],
      pendingWords: [{ id: "pending-sensitive-id", text: inputText }],
    }),
  );

  assert.equal(response.status, 503);
  const diagnosticOutput = JSON.stringify(diagnostics);
  assert.doesNotMatch(diagnosticOutput, /classroom text/);
  assert.doesNotMatch(diagnosticOutput, /accepted-sensitive-id|pending-sensitive-id/);
  assert.doesNotMatch(diagnosticOutput, /provider response content/);
  assert.deepEqual(diagnostics, [{ code: "provider_unknown_failure" }]);
});

test("provider result validation emits stable sanitized reasons", async () => {
  const question = "question-sensitive-content";
  const pendingId = "pending-sensitive-id";
  const secondPendingId = "pending-second-sensitive-id";
  const acceptedId = "accepted-sensitive-id";
  const inputText = "classroom-sensitive-content";
  const providerContent = "provider-response-sensitive-content";
  const validResult = {
    id: pendingId,
    relevance: 0.5,
    attention: false,
    spellingSuggestion: providerContent,
    mergeTargetId: null,
  };
  const cases = [
    {
      reason: "pending_id_invalid",
      input: {
        question,
        acceptedWords: [{ id: acceptedId, text: inputText }],
        pendingWords: [{ id: pendingId, text: inputText }],
      },
      results: [{ ...validResult, id: "unknown-sensitive-id" }],
    },
    {
      reason: "pending_id_duplicate",
      input: {
        question,
        acceptedWords: [{ id: acceptedId, text: inputText }],
        pendingWords: [
          { id: pendingId, text: inputText },
          { id: secondPendingId, text: inputText },
        ],
      },
      results: [validResult, { ...validResult }],
    },
    {
      reason: "relevance_invalid",
      input: {
        question,
        acceptedWords: [{ id: acceptedId, text: inputText }],
        pendingWords: [{ id: pendingId, text: inputText }],
      },
      results: [{ ...validResult, relevance: 2 }],
    },
    {
      reason: "attention_invalid",
      input: {
        question,
        acceptedWords: [{ id: acceptedId, text: inputText }],
        pendingWords: [{ id: pendingId, text: inputText }],
      },
      results: [{ ...validResult, attention: "false" }],
    },
    {
      reason: "spelling_suggestion_invalid",
      input: {
        question,
        acceptedWords: [{ id: acceptedId, text: inputText }],
        pendingWords: [{ id: pendingId, text: inputText }],
      },
      results: [{ ...validResult, spellingSuggestion: "   " }],
    },
    {
      reason: "merge_target_invalid",
      input: {
        question,
        acceptedWords: [{ id: acceptedId, text: inputText }],
        pendingWords: [{ id: pendingId, text: inputText }],
      },
      results: [{
        ...validResult,
        mergeTargetId: "unknown-merge-target-sensitive-id",
      }],
    },
  ] as const;
  const allDiagnostics: OpenRouterTriageFailureDiagnostic[] = [];

  for (const testCase of cases) {
    const { diagnostics, response } = await runMockedProviderResponse(
      testCase.input,
      JSON.stringify({ results: testCase.results }),
    );

    assert.equal(response.status, 503);
    allDiagnostics.push(...diagnostics);
    assert.deepEqual(diagnostics, [{
      code: "provider_result_invalid",
      validationReason: testCase.reason,
      finishReason: "stop",
    }]);
  }

  const serializedDiagnostics = JSON.stringify(
    allDiagnostics,
  );
  assert.doesNotMatch(serializedDiagnostics, /question-sensitive-content/);
  assert.doesNotMatch(serializedDiagnostics, /classroom-sensitive-content/);
  assert.doesNotMatch(serializedDiagnostics, /provider-response-sensitive-content/);
  assert.doesNotMatch(serializedDiagnostics, /pending-sensitive-id/);
  assert.doesNotMatch(serializedDiagnostics, /accepted-sensitive-id/);
  assert.doesNotMatch(serializedDiagnostics, /unknown-merge-target-sensitive-id/);
});

test("paid triage route has no Firestore dependency", () => {
  const source = readFileSync("app/api/ai/triage/route.ts", "utf8");
  assert.doesNotMatch(source, /firestore|firebase/i);
});
