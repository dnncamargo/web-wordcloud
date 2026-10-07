import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export const AI_RATE_LIMIT_TIMEOUT_MS = 1_500;

const TRIAGE_BURST_DEFAULT_LIMIT = 5;
const TRIAGE_BURST_DEFAULT_WINDOW_SECONDS = 60;
const TRIAGE_DAILY_DEFAULT_LIMIT = 50;
const TRIAGE_DAILY_DEFAULT_WINDOW_SECONDS = 86_400;
const LOGIN_CLIENT_DEFAULT_LIMIT = 10;
const LOGIN_CLIENT_DEFAULT_WINDOW_SECONDS = 600;
const LOGIN_GLOBAL_DEFAULT_LIMIT = 100;
const LOGIN_GLOBAL_DEFAULT_WINDOW_SECONDS = 3_600;

const MAX_CONFIGURED_LIMIT = 1_000_000;
const MAX_CONFIGURED_WINDOW_SECONDS = 31_536_000;
const NAMESPACE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

type Environment = Readonly<Record<string, string | undefined>>;

export type GuardrailStatus = "allowed" | "limited" | "unavailable";

export type GuardrailDecision = Readonly<{
  status: GuardrailStatus;
}>;

export type AiLoginIdentity = Readonly<{
  source: "platform-forwarded-for";
  value: string;
}>;

export type AiGuardrailConfiguration = Readonly<{
  namespace: string;
  triage: Readonly<{
    burst: Readonly<{ limit: number; windowSeconds: number }>;
    daily: Readonly<{ limit: number; windowSeconds: number }>;
  }>;
  login: Readonly<{
    perClient: Readonly<{ limit: number; windowSeconds: number }>;
    application: Readonly<{ limit: number; windowSeconds: number }>;
  }>;
}>;

type LimiterKind = "slidingWindow" | "fixedWindow";

type LimiterSpec = Readonly<{
  kind: LimiterKind;
  limit: number;
  windowSeconds: number;
  prefix: string;
  redis: unknown;
  timeoutMs: number;
  analytics: false;
  ephemeralCache: false;
}>;

type RateLimiter = Readonly<{
  limit: (identifier: string) => Promise<unknown>;
}>;

type RedisFactory = (config: Readonly<{
  url: string;
  token: string;
  enableTelemetry: false;
}>) => unknown;

type LimiterFactory = (spec: LimiterSpec) => RateLimiter;

export type AiGuardrailsOptions = Readonly<{
  environment?: Environment;
  createRedis?: RedisFactory;
  createLimiter?: LimiterFactory;
}>;

export type AiGuardrails = Readonly<{
  configuration: AiGuardrailConfiguration | null;
  authorizePaidTriage: () => Promise<GuardrailDecision>;
  checkAiLoginAttempt: (
    identity: AiLoginIdentity,
  ) => Promise<GuardrailDecision>;
}>;

type InternalConfiguration = Readonly<{
  public: AiGuardrailConfiguration;
  redisUrl: string;
  redisToken: string;
}>;

function hasOwn(environment: Environment, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(environment, key);
}

function readRequiredEnvironmentValue(
  environment: Environment,
  key: string,
): string | null {
  const value = environment[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  return value.trim();
}

function readBoundedPositiveInteger(
  environment: Environment,
  key: string,
  fallback: number,
  maximum: number,
): number | null {
  if (!hasOwn(environment, key) || environment[key] === undefined) {
    return fallback;
  }

  const rawValue = environment[key];

  if (typeof rawValue !== "string") {
    return null;
  }

  const value = rawValue.trim();

  if (!/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > maximum
  ) {
    return null;
  }

  return parsed;
}

function resolveNamespace(environment: Environment): string | null {
  if (hasOwn(environment, "AI_RATE_LIMIT_NAMESPACE")) {
    const explicitNamespace = environment.AI_RATE_LIMIT_NAMESPACE;

    if (
      typeof explicitNamespace !== "string" ||
      !NAMESPACE_PATTERN.test(explicitNamespace.trim())
    ) {
      return null;
    }

    return explicitNamespace.trim();
  }

  const vercelEnvironment = environment.VERCEL_ENV?.trim();

  if (
    vercelEnvironment === "production" ||
    vercelEnvironment === "preview" ||
    vercelEnvironment === "development"
  ) {
    return `vercel:${vercelEnvironment}`;
  }

  return `node:${environment.NODE_ENV?.trim() === "production" ? "production" : "development"}`;
}

function isValidRedisUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.length > 0
    );
  } catch {
    return false;
  }
}

function readConfiguration(environment: Environment): InternalConfiguration | null {
  const redisUrl = readRequiredEnvironmentValue(
    environment,
    "UPSTASH_REDIS_REST_URL",
  );
  const redisToken = readRequiredEnvironmentValue(
    environment,
    "UPSTASH_REDIS_REST_TOKEN",
  );
  const namespace = resolveNamespace(environment);

  if (
    redisUrl === null ||
    redisToken === null ||
    !isValidRedisUrl(redisUrl) ||
    namespace === null
  ) {
    return null;
  }

  const burstLimit = readBoundedPositiveInteger(
    environment,
    "AI_TRIAGE_BURST_LIMIT",
    TRIAGE_BURST_DEFAULT_LIMIT,
    MAX_CONFIGURED_LIMIT,
  );
  const burstWindowSeconds = readBoundedPositiveInteger(
    environment,
    "AI_TRIAGE_BURST_WINDOW_SECONDS",
    TRIAGE_BURST_DEFAULT_WINDOW_SECONDS,
    MAX_CONFIGURED_WINDOW_SECONDS,
  );
  const dailyLimit = readBoundedPositiveInteger(
    environment,
    "AI_TRIAGE_DAILY_LIMIT",
    TRIAGE_DAILY_DEFAULT_LIMIT,
    MAX_CONFIGURED_LIMIT,
  );
  const dailyWindowSeconds = readBoundedPositiveInteger(
    environment,
    "AI_TRIAGE_DAILY_WINDOW_SECONDS",
    TRIAGE_DAILY_DEFAULT_WINDOW_SECONDS,
    MAX_CONFIGURED_WINDOW_SECONDS,
  );
  const loginClientLimit = LOGIN_CLIENT_DEFAULT_LIMIT;
  const loginClientWindowSeconds = LOGIN_CLIENT_DEFAULT_WINDOW_SECONDS;
  const loginGlobalLimit = LOGIN_GLOBAL_DEFAULT_LIMIT;
  const loginGlobalWindowSeconds = LOGIN_GLOBAL_DEFAULT_WINDOW_SECONDS;

  if (
    burstLimit === null ||
    burstWindowSeconds === null ||
    dailyLimit === null ||
    dailyWindowSeconds === null
  ) {
    return null;
  }

  return {
    redisUrl,
    redisToken,
    public: {
      namespace,
      triage: {
        burst: { limit: burstLimit, windowSeconds: burstWindowSeconds },
        daily: { limit: dailyLimit, windowSeconds: dailyWindowSeconds },
      },
      login: {
        perClient: {
          limit: loginClientLimit,
          windowSeconds: loginClientWindowSeconds,
        },
        application: {
          limit: loginGlobalLimit,
          windowSeconds: loginGlobalWindowSeconds,
        },
      },
    },
  };
}

function defaultRedisFactory(config: Readonly<{
  url: string;
  token: string;
  enableTelemetry: false;
}>): Redis {
  return new Redis(config);
}

function defaultLimiterFactory(spec: LimiterSpec): RateLimiter {
  const limiter =
    spec.kind === "slidingWindow"
      ? Ratelimit.slidingWindow(spec.limit, `${spec.windowSeconds} s`)
      : Ratelimit.fixedWindow(spec.limit, `${spec.windowSeconds} s`);

  return new Ratelimit({
    redis: spec.redis as Redis,
    limiter,
    prefix: spec.prefix,
    timeout: spec.timeoutMs,
    analytics: spec.analytics,
    ephemeralCache: spec.ephemeralCache,
  });
}

function unavailable(): GuardrailDecision {
  return { status: "unavailable" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function classifyLimiterResponse(value: unknown): GuardrailStatus {
  if (!isRecord(value) || typeof value.success !== "boolean") {
    return "unavailable";
  }

  const reason = value.reason;

  if (
    reason !== undefined &&
    reason !== "timeout" &&
    reason !== "cacheBlock" &&
    reason !== "denyList"
  ) {
    return "unavailable";
  }

  if (reason === "timeout") {
    return "unavailable";
  }

  if (value.success) {
    return reason === undefined ? "allowed" : "unavailable";
  }

  return "limited";
}

async function combineLimiterResults(
  limiters: readonly RateLimiter[],
  identifiers: readonly string[],
): Promise<GuardrailDecision> {
  for (let index = 0; index < limiters.length; index += 1) {
    let result: unknown;

    try {
      result = await limiters[index].limit(identifiers[index]);
    } catch {
      return unavailable();
    }

    const status = classifyLimiterResponse(result);

    if (status !== "allowed") {
      return { status };
    }
  }

  return { status: "allowed" };
}

function isValidLoginIdentity(identity: AiLoginIdentity): boolean {
  return (
    isRecord(identity) &&
    identity.source === "platform-forwarded-for" &&
    typeof identity.value === "string" &&
    identity.value.trim().length > 0
  );
}

export function createAiGuardrails(
  options: AiGuardrailsOptions = {},
): AiGuardrails {
  const environment = options.environment ?? process.env;
  const configuration = readConfiguration(environment);

  if (configuration === null) {
    return {
      configuration: null,
      authorizePaidTriage: async () => unavailable(),
      checkAiLoginAttempt: async () => unavailable(),
    };
  }

  const createRedis = options.createRedis ?? defaultRedisFactory;
  const createLimiter = options.createLimiter ?? defaultLimiterFactory;

  try {
    const redis = createRedis({
      url: configuration.redisUrl,
      token: configuration.redisToken,
      enableTelemetry: false,
    });
    const namespace = configuration.public.namespace;
    const burstLimiter = createLimiter({
      kind: "slidingWindow",
      ...configuration.public.triage.burst,
      prefix: `${namespace}:ai:triage:burst`,
      redis,
      timeoutMs: AI_RATE_LIMIT_TIMEOUT_MS,
      analytics: false,
      ephemeralCache: false,
    });
    const dailyLimiter = createLimiter({
      kind: "fixedWindow",
      ...configuration.public.triage.daily,
      prefix: `${namespace}:ai:triage:daily`,
      redis,
      timeoutMs: AI_RATE_LIMIT_TIMEOUT_MS,
      analytics: false,
      ephemeralCache: false,
    });
    const loginClientLimiter = createLimiter({
      kind: "slidingWindow",
      ...configuration.public.login.perClient,
      prefix: `${namespace}:ai:login:client`,
      redis,
      timeoutMs: AI_RATE_LIMIT_TIMEOUT_MS,
      analytics: false,
      ephemeralCache: false,
    });
    const loginGlobalLimiter = createLimiter({
      kind: "fixedWindow",
      ...configuration.public.login.application,
      prefix: `${namespace}:ai:login:global`,
      redis,
      timeoutMs: AI_RATE_LIMIT_TIMEOUT_MS,
      analytics: false,
      ephemeralCache: false,
    });

    return {
      configuration: configuration.public,
      authorizePaidTriage: () =>
        combineLimiterResults(
          [burstLimiter, dailyLimiter],
          ["global", "global"],
        ),
      checkAiLoginAttempt: (identity) => {
        if (!isValidLoginIdentity(identity)) {
          return Promise.resolve(unavailable());
        }

        return combineLimiterResults(
          [loginClientLimiter, loginGlobalLimiter],
          [identity.value, "global"],
        );
      },
    };
  } catch {
    return {
      configuration: null,
      authorizePaidTriage: async () => unavailable(),
      checkAiLoginAttempt: async () => unavailable(),
    };
  }
}

export function resolveAiRateLimitNamespace(
  environment: Environment = process.env,
): string | null {
  return resolveNamespace(environment);
}

export async function authorizePaidTriage(): Promise<GuardrailDecision> {
  return createAiGuardrails().authorizePaidTriage();
}

export async function checkAiLoginAttempt(
  identity: AiLoginIdentity,
): Promise<GuardrailDecision> {
  return createAiGuardrails().checkAiLoginAttempt(identity);
}
