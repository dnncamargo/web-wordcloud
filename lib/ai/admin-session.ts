import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const AI_ADMIN_SESSION_COOKIE = "ai_admin_session";
const AI_ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;
const AI_ADMIN_SESSION_VERSION = "v1";

type AiAdminSessionPayload = {
  v: typeof AI_ADMIN_SESSION_VERSION;
  role: "ai-admin";
  exp: number;
  nonce: string;
};

export type AiAdminSession = {
  role: AiAdminSessionPayload["role"];
  expiresAt: number;
};

function getAiAdminSecrets() {
  const password = process.env.AI_ADMIN_PASSWORD;
  const sessionSecret = process.env.AI_SESSION_SECRET;

  if (!password || !sessionSecret) return null;

  return { password, sessionSecret };
}

function constantTimeStringEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();

  return timingSafeEqual(leftDigest, rightDigest);
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function encodeSession(payload: AiAdminSessionPayload, secret: string) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(encodedPayload, secret);

  return `${AI_ADMIN_SESSION_VERSION}.${encodedPayload}.${signature}`;
}

function decodeSession(value: string, secret: string): AiAdminSession | null {
  const parts = value.split(".");

  if (parts.length !== 3) return null;

  const [version, encodedPayload, encodedSignature] = parts;

  if (!version || !encodedPayload || !encodedSignature || version !== AI_ADMIN_SESSION_VERSION) return null;

  const expectedSignature = sign(encodedPayload, secret);
  const receivedSignature = Buffer.from(encodedSignature, "base64url");
  const expectedSignatureBuffer = Buffer.from(expectedSignature, "base64url");

  if (
    receivedSignature.length !== expectedSignatureBuffer.length ||
    !timingSafeEqual(receivedSignature, expectedSignatureBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<AiAdminSessionPayload>;

    if (
      payload.v !== AI_ADMIN_SESSION_VERSION ||
      payload.role !== "ai-admin" ||
      typeof payload.exp !== "number" ||
      !Number.isInteger(payload.exp) ||
      typeof payload.nonce !== "string" ||
      payload.nonce.length < 16 ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return {
      role: payload.role,
      expiresAt: payload.exp,
    };
  } catch {
    return null;
  }
}

export function authenticateAiAdminPassword(password: string) {
  const secrets = getAiAdminSecrets();

  if (!secrets) return false;

  return constantTimeStringEqual(password, secrets.password);
}

export function createAiAdminSession() {
  const secrets = getAiAdminSecrets();

  if (!secrets) return null;

  const expiresAt = Math.floor(Date.now() / 1000) + AI_ADMIN_SESSION_TTL_SECONDS;

  return encodeSession(
    {
      v: AI_ADMIN_SESSION_VERSION,
      role: "ai-admin",
      exp: expiresAt,
      nonce: randomBytes(16).toString("hex"),
    },
    secrets.sessionSecret,
  );
}

export function verifyAiAdminSession(value: string | undefined) {
  const secrets = getAiAdminSecrets();

  if (!secrets || !value) return null;

  return decodeSession(value, secrets.sessionSecret);
}

export async function getAiAdminSession() {
  const cookieStore = await cookies();

  return verifyAiAdminSession(cookieStore.get(AI_ADMIN_SESSION_COOKIE)?.value);
}

export async function setAiAdminSessionCookie(value: string) {
  const cookieStore = await cookies();

  cookieStore.set({
    name: AI_ADMIN_SESSION_COOKIE,
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: AI_ADMIN_SESSION_TTL_SECONDS,
  });
}

export async function clearAiAdminSessionCookie() {
  const cookieStore = await cookies();

  cookieStore.set({
    name: AI_ADMIN_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export { AI_ADMIN_SESSION_COOKIE };
