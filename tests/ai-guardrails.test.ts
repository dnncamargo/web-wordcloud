import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AI_RATE_LIMIT_TIMEOUT_MS,
  createAiGuardrails,
  resolveAiRateLimitNamespace,
  type AiGuardrailsOptions,
} from "../lib/ai/guardrails";
import { triagePendingWords } from "../lib/ai/openRouterTriage";
import {
  MAX_ACCEPTED_WORDS,
  MAX_BODY_BYTES,
  MAX_COMBINED_WORDS,
  MAX_PENDING_WORDS,
  MAX_QUESTION_CODE_POINTS,
  MAX_WORD_ID_CODE_POINTS,
  MAX_WORD_TEXT_CODE_POINTS,
  readAndValidatePaidTriageInput,
  readBoundedRequestBody,
  validatePaidTriageInput,
} from "../lib/ai/triageInput";

const redisEnvironment = {
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "direct-token-placeholder",
  VERCEL_ENV: "preview",
};

const marketplaceRedisEnvironment = {
  KV_REST_API_URL: "https://marketplace.example.upstash.io",
  KV_REST_API_TOKEN: "marketplace-token-placeholder",
  VERCEL_ENV: "preview",
};

type LimiterResponse = Readonly<{
  success: boolean;
  reason?: string;
}>;

function createFakeOptions(
  responses: readonly (LimiterResponse | Error | unknown)[],
  captured: Array<Record<string, unknown>> = [],
  calls: Array<Readonly<{ prefix: string; identifier: string }>> = [],
  environment: Readonly<Record<string, string | undefined>> = redisEnvironment,
): AiGuardrailsOptions {
  let responseIndex = 0;

  return {
    environment,
    createRedis: (config) => {
      assert.equal(config.enableTelemetry, false);
      return { kind: "fake-redis" };
    },
    createLimiter: (spec) => {
      captured.push({ ...spec });

      return {
        limit: async (identifier) => {
          calls.push({ prefix: spec.prefix, identifier });
          const response = responses[responseIndex++];

          if (response instanceof Error) {
            throw response;
          }

          return response;
        },
      };
    },
  };
}

function validInput() {
  return {
    question: "Como podemos cuidar melhor do ambiente?",
    acceptedWords: [{ id: "accepted-1", text: "Plantar árvores" }],
    pendingWords: [{ id: "pending-1", text: "Reciclar" }],
  };
}

function assertInvalidInput(input: unknown) {
  assert.throws(() => validatePaidTriageInput(input));
}

test("valid defaults create isolated, non-analytics, non-memory limiters", async () => {
  const captured: Array<Record<string, unknown>> = [];
  const guardrails = createAiGuardrails(
    createFakeOptions(
      [{ success: true }, { success: true }],
      captured,
    ),
  );

  assert.deepEqual(guardrails.configuration, {
    namespace: "vercel:preview",
    triage: {
      burst: { limit: 5, windowSeconds: 60 },
      daily: { limit: 50, windowSeconds: 86400 },
    },
    login: {
      perClient: { limit: 10, windowSeconds: 600 },
      application: { limit: 100, windowSeconds: 3600 },
    },
  });

  assert.equal((await guardrails.authorizePaidTriage()).status, "allowed");
  assert.equal(captured.length, 4);
  assert.deepEqual(
    captured.map((spec) => spec.prefix),
    [
      "vercel:preview:ai:triage:burst",
      "vercel:preview:ai:triage:daily",
      "vercel:preview:ai:login:client",
      "vercel:preview:ai:login:global",
    ],
  );
  assert.ok(captured.every((spec) => spec.timeoutMs === AI_RATE_LIMIT_TIMEOUT_MS));
  assert.ok(captured.every((spec) => spec.analytics === false));
  assert.ok(captured.every((spec) => spec.ephemeralCache === false));
});

test("production and preview namespaces are isolated by default", () => {
  assert.equal(
    resolveAiRateLimitNamespace({ VERCEL_ENV: "production" }),
    "vercel:production",
  );
  assert.equal(
    resolveAiRateLimitNamespace({ VERCEL_ENV: "preview" }),
    "vercel:preview",
  );
  assert.notEqual(
    resolveAiRateLimitNamespace({ VERCEL_ENV: "production" }),
    resolveAiRateLimitNamespace({ VERCEL_ENV: "preview" }),
  );
});

test("missing or invalid explicit configuration fails closed", async () => {
  const missing = createAiGuardrails({ environment: {} });
  assert.equal((await missing.authorizePaidTriage()).status, "unavailable");

  const invalid = createAiGuardrails({
    environment: {
      ...redisEnvironment,
      AI_TRIAGE_BURST_LIMIT: "0",
    },
  });
  assert.equal((await invalid.authorizePaidTriage()).status, "unavailable");

  const invalidNamespace = createAiGuardrails({
    environment: {
      ...redisEnvironment,
      AI_RATE_LIMIT_NAMESPACE: "not safe/for redis keys",
    },
  });
  assert.equal((await invalidNamespace.authorizePaidTriage()).status, "unavailable");

  const insecureRedis = createAiGuardrails({
    environment: {
      ...redisEnvironment,
      UPSTASH_REDIS_REST_URL: "http://example.upstash.io",
    },
  });
  assert.equal((await insecureRedis.authorizePaidTriage()).status, "unavailable");
});

test("complete marketplace credentials work when direct credentials are absent", async () => {
  const guardrails = createAiGuardrails(
    createFakeOptions(
      [{ success: true }, { success: true }],
      [],
      [],
      marketplaceRedisEnvironment,
    ),
  );

  assert.equal((await guardrails.authorizePaidTriage()).status, "allowed");
});

test("complete direct credentials take precedence over complete marketplace credentials", async () => {
  const redisConfigs: Array<Readonly<Record<string, unknown>>> = [];
  const guardrails = createAiGuardrails({
    environment: {
      ...redisEnvironment,
      ...marketplaceRedisEnvironment,
    },
    createRedis: (config) => {
      redisConfigs.push(config);
      return { kind: "fake-redis" };
    },
    createLimiter: () => ({ limit: async () => ({ success: true }) }),
  });

  assert.equal((await guardrails.authorizePaidTriage()).status, "allowed");
  assert.equal(redisConfigs.length, 1);
  assert.deepEqual(Object.keys(redisConfigs[0] ?? {}).sort(), [
    "enableTelemetry",
    "token",
    "url",
  ]);
  assert.equal(redisConfigs[0]?.url, redisEnvironment.UPSTASH_REDIS_REST_URL);
  assert.equal(redisConfigs[0]?.token, redisEnvironment.UPSTASH_REDIS_REST_TOKEN);
  assert.equal(redisConfigs[0]?.enableTelemetry, false);
});

test("partial or invalid direct credentials do not fall back to marketplace credentials", async () => {
  const partialDirect = createAiGuardrails({
    environment: {
      ...marketplaceRedisEnvironment,
      UPSTASH_REDIS_REST_URL: redisEnvironment.UPSTASH_REDIS_REST_URL,
    },
  });
  assert.equal((await partialDirect.authorizePaidTriage()).status, "unavailable");

  const insecureDirect = createAiGuardrails({
    environment: {
      ...marketplaceRedisEnvironment,
      UPSTASH_REDIS_REST_URL: "http://example.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: redisEnvironment.UPSTASH_REDIS_REST_TOKEN,
    },
  });
  assert.equal((await insecureDirect.authorizePaidTriage()).status, "unavailable");
});

test("partial or insecure marketplace credentials fail closed", async () => {
  const partialMarketplace = createAiGuardrails({
    environment: {
      KV_REST_API_URL: marketplaceRedisEnvironment.KV_REST_API_URL,
      VERCEL_ENV: "preview",
    },
  });
  assert.equal((await partialMarketplace.authorizePaidTriage()).status, "unavailable");

  const insecureMarketplace = createAiGuardrails({
    environment: {
      KV_REST_API_URL: "http://marketplace.example.upstash.io",
      KV_REST_API_TOKEN: marketplaceRedisEnvironment.KV_REST_API_TOKEN,
      VERCEL_ENV: "preview",
    },
  });
  assert.equal((await insecureMarketplace.authorizePaidTriage()).status, "unavailable");
});

test("unsupported Redis environment variables are ignored", async () => {
  for (const environment of [
    { KV_REST_API_READ_ONLY_TOKEN: "read-only-token-placeholder" },
    { KV_URL: "redis://example" },
    { REDIS_URL: "redis://example" },
  ]) {
    const guardrails = createAiGuardrails({ environment });
    assert.equal((await guardrails.authorizePaidTriage()).status, "unavailable");
  }
});

test("guardrails short-circuit sequentially and keep the global triage identifier", async () => {
  const burstDeniedCalls: Array<Readonly<{ prefix: string; identifier: string }>> = [];
  const burstLimited = createAiGuardrails(
    createFakeOptions([{ success: false }, { success: true }], [], burstDeniedCalls),
  );
  assert.equal((await burstLimited.authorizePaidTriage()).status, "limited");
  assert.deepEqual(burstDeniedCalls, [
    { prefix: "vercel:preview:ai:triage:burst", identifier: "global" },
  ]);

  const burstUnavailableCalls: Array<Readonly<{ prefix: string; identifier: string }>> = [];
  const burstUnavailable = createAiGuardrails(
    createFakeOptions(
      [{ success: true, reason: "timeout" }, { success: true }],
      [],
      burstUnavailableCalls,
    ),
  );
  assert.equal((await burstUnavailable.authorizePaidTriage()).status, "unavailable");
  assert.equal(burstUnavailableCalls.length, 1);

  const dailyDeniedCalls: Array<Readonly<{ prefix: string; identifier: string }>> = [];
  const dailyLimited = createAiGuardrails(
    createFakeOptions([{ success: true }, { success: false }], [], dailyDeniedCalls),
  );
  assert.equal((await dailyLimited.authorizePaidTriage()).status, "limited");
  assert.deepEqual(dailyDeniedCalls, [
    { prefix: "vercel:preview:ai:triage:burst", identifier: "global" },
    { prefix: "vercel:preview:ai:triage:daily", identifier: "global" },
  ]);

  const bothAllowedCalls: Array<Readonly<{ prefix: string; identifier: string }>> = [];
  const bothAllowed = createAiGuardrails(
    createFakeOptions([{ success: true }, { success: true }], [], bothAllowedCalls),
  );
  assert.equal((await bothAllowed.authorizePaidTriage()).status, "allowed");
  assert.equal(bothAllowedCalls.length, 2);
  assert.ok(bothAllowedCalls.every((call) => call.identifier === "global"));
});

test("timeouts, SDK errors, malformed responses, and no-memory fallback fail closed", async () => {
  const timeout = createAiGuardrails(
    createFakeOptions([{ success: true, reason: "timeout" }, { success: true }]),
  );
  assert.equal((await timeout.authorizePaidTriage()).status, "unavailable");

  const thrown = createAiGuardrails(
    createFakeOptions([new Error("redis unavailable"), { success: true }]),
  );
  assert.equal((await thrown.authorizePaidTriage()).status, "unavailable");

  const malformed = createAiGuardrails(
    createFakeOptions([{ success: "yes" }, { success: true }]),
  );
  assert.equal((await malformed.authorizePaidTriage()).status, "unavailable");

  const noFallback = createAiGuardrails(
    createFakeOptions([new Error("redis unavailable"), new Error("redis unavailable")]),
  );
  assert.equal((await noFallback.authorizePaidTriage()).status, "unavailable");
});

test("login limiters are separate and require platform-derived identity", async () => {
  const captured: Array<Record<string, unknown>> = [];
  const calls: Array<Readonly<{ prefix: string; identifier: string }>> = [];
  const guardrails = createAiGuardrails(
    createFakeOptions(
      [{ success: true }, { success: true }, { success: true }, { success: true }],
      captured,
      calls,
    ),
  );

  assert.equal(
    (
      await guardrails.checkAiLoginAttempt({
        source: "platform-forwarded-for",
        value: "203.0.113.10",
      })
    ).status,
    "allowed",
  );
  assert.equal(
    (await guardrails.checkAiLoginAttempt({ source: "platform-forwarded-for", value: "" })).status,
    "unavailable",
  );

  assert.deepEqual(calls, [
    {
      prefix: "vercel:preview:ai:login:client",
      identifier: "203.0.113.10",
    },
    { prefix: "vercel:preview:ai:login:global", identifier: "global" },
  ]);

  const deniedCalls: Array<Readonly<{ prefix: string; identifier: string }>> = [];
  const deniedClient = createAiGuardrails(
    createFakeOptions([{ success: false }, { success: true }], [], deniedCalls),
  );
  assert.equal(
    (
      await deniedClient.checkAiLoginAttempt({
        source: "platform-forwarded-for",
        value: "203.0.113.11",
      })
    ).status,
    "limited",
  );
  assert.deepEqual(deniedCalls, [
    {
      prefix: "vercel:preview:ai:login:client",
      identifier: "203.0.113.11",
    },
  ]);
});

test("bounded body accepts below-limit input and rejects early or streamed oversize", async () => {
  const belowLimit = new Request("https://example.test", {
    method: "POST",
    body: "x".repeat(MAX_BODY_BYTES),
  });
  const belowLimitResult = await readBoundedRequestBody(belowLimit);
  assert.equal(belowLimitResult.status, "ok");
  if (belowLimitResult.status === "ok") {
    assert.equal(belowLimitResult.body.length, MAX_BODY_BYTES);
  }

  const earlyOversize = new Request("https://example.test", {
    method: "POST",
    headers: { "content-length": String(MAX_BODY_BYTES + 1) },
  });
  assert.deepEqual(await readBoundedRequestBody(earlyOversize), { status: "too-large" });

  const streamedOversize = new Request("https://example.test", {
    method: "POST",
    body: "x".repeat(MAX_BODY_BYTES + 1),
  });
  assert.deepEqual(await readBoundedRequestBody(streamedOversize), { status: "too-large" });
});

test("validates exact input and word keys, limits, duplicates, and client controls", async () => {
  assert.deepEqual(validatePaidTriageInput(validInput()), {
    question: "Como podemos cuidar melhor do ambiente?",
    acceptedWords: [{ id: "accepted-1", text: "Plantar árvores" }],
    pendingWords: [{ id: "pending-1", text: "Reciclar" }],
  });

  assertInvalidInput({ ...validInput(), extra: true });
  assertInvalidInput({ ...validInput(), acceptedWords: [{ id: "a", text: "x", extra: true }] });
  assertInvalidInput({ ...validInput(), provider: "openrouter" });
  assertInvalidInput({ ...validInput(), model: "unsafe-model" });
  assertInvalidInput({ ...validInput(), temperature: 0 });
  assertInvalidInput({ ...validInput(), acceptedWords: [{ id: "same", text: "a" }], pendingWords: [{ id: "same", text: "b" }] });

  assertInvalidInput({ ...validInput(), question: "q".repeat(MAX_QUESTION_CODE_POINTS + 1) });
  assertInvalidInput({ ...validInput(), acceptedWords: [{ id: "i".repeat(MAX_WORD_ID_CODE_POINTS + 1), text: "x" }] });
  assertInvalidInput({ ...validInput(), acceptedWords: [{ id: "a", text: "x".repeat(MAX_WORD_TEXT_CODE_POINTS + 1) }] });
  assertInvalidInput({ ...validInput(), acceptedWords: Array.from({ length: MAX_ACCEPTED_WORDS + 1 }, (_, index) => ({ id: `a-${index}`, text: "x" })) });
  assertInvalidInput({ ...validInput(), pendingWords: Array.from({ length: MAX_PENDING_WORDS + 1 }, (_, index) => ({ id: `p-${index}`, text: "x" })) });
  assertInvalidInput({ question: "q", acceptedWords: Array.from({ length: MAX_COMBINED_WORDS - MAX_PENDING_WORDS + 1 }, (_, index) => ({ id: `a-${index}`, text: "x" })), pendingWords: Array.from({ length: MAX_PENDING_WORDS }, (_, index) => ({ id: `p-${index}`, text: "x" })) });

  const body = new Request("https://example.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validInput()),
  });
  assert.deepEqual(await readAndValidatePaidTriageInput(body), {
    status: "ok",
    input: validInput(),
  });

  const invalidJson = new Request("https://example.test", {
    method: "POST",
    body: "not-json",
  });
  assert.deepEqual(await readAndValidatePaidTriageInput(invalidJson), {
    status: "invalid",
  });

  const invalidSchema = new Request("https://example.test", {
    method: "POST",
    body: JSON.stringify({ question: "Pergunta" }),
  });
  assert.deepEqual(await readAndValidatePaidTriageInput(invalidSchema), {
    status: "invalid",
  });

  const oversizedJson = new Request("https://example.test", {
    method: "POST",
    headers: { "content-length": String(MAX_BODY_BYTES + 1) },
  });
  assert.deepEqual(await readAndValidatePaidTriageInput(oversizedJson), {
    status: "too-large",
  });
});

test("body read failures and invalid UTF-8 are invalid rather than too large", async () => {
  const oversizedWithCancelFailure = {
    headers: new Headers(),
    body: {
      getReader: () => ({
        read: async () => ({ done: false, value: new Uint8Array(MAX_BODY_BYTES + 1) }),
        cancel: async () => {
          throw new Error("cancel failed");
        },
      }),
    },
  } as unknown as Request;
  assert.deepEqual(await readBoundedRequestBody(oversizedWithCancelFailure), {
    status: "too-large",
  });

  const failingRequest = {
    headers: new Headers(),
    body: {
      getReader: () => ({
        read: async () => {
          throw new Error("stream failed");
        },
        cancel: async () => undefined,
      }),
    },
  } as unknown as Request;
  assert.deepEqual(await readBoundedRequestBody(failingRequest), { status: "invalid" });

  const invalidUtf8 = new Request("https://example.test", {
    method: "POST",
    body: new Uint8Array([0xc3, 0x28]),
  });
  assert.deepEqual(await readBoundedRequestBody(invalidUtf8), { status: "invalid" });
});

test("empty pending words are valid no-paid-work input", () => {
  const input = validatePaidTriageInput({
    question: "Pergunta",
    acceptedWords: [{ id: "accepted-1", text: "Resposta" }],
    pendingWords: [],
  });

  assert.deepEqual(input.pendingWords, []);
});

test("empty pending words return without requiring Redis or OpenRouter", async () => {
  const results = await triagePendingWords({
    question: "Pergunta",
    acceptedWords: [{ id: "accepted-1", text: "Resposta" }],
    pendingWords: [],
  });

  assert.deepEqual(results, []);
});

test("unicode limits count code points rather than UTF-16 code units", () => {
  const emoji = "😀";
  const input = {
    question: emoji.repeat(MAX_QUESTION_CODE_POINTS),
    acceptedWords: [
      {
        id: emoji.repeat(MAX_WORD_ID_CODE_POINTS),
        text: emoji.repeat(MAX_WORD_TEXT_CODE_POINTS),
      },
    ],
    pendingWords: [],
  };

  assert.doesNotThrow(() => validatePaidTriageInput(input));
});
