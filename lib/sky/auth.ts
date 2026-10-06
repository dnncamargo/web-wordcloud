import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const SKY_SESSION_COOKIE = "sky_session";
const SKY_SESSION_TTL_SECONDS = 8 * 60 * 60;
const SKY_SESSION_VERSION = "v1";

type SkySessionPayload = {
  v: typeof SKY_SESSION_VERSION;
  role: "sky-admin";
  exp: number;
  nonce: string;
};

export type SkySession = {
  role: SkySessionPayload["role"];
  expiresAt: number;
};

function getSkySecrets() {
  const password = process.env.SKY_ADMIN_PASSWORD;
  const sessionSecret = process.env.SKY_SESSION_SECRET;

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

function encodeSession(payload: SkySessionPayload, secret: string) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(encodedPayload, secret);

  return `${SKY_SESSION_VERSION}.${encodedPayload}.${signature}`;
}

function decodeSession(value: string, secret: string): SkySession | null {
  const parts = value.split(".");

  if (parts.length !== 3) return null;

  const [version, encodedPayload, encodedSignature] = parts;

  if (!version || !encodedPayload || !encodedSignature || version !== SKY_SESSION_VERSION) return null;

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
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<SkySessionPayload>;

    if (
      payload.v !== SKY_SESSION_VERSION ||
      payload.role !== "sky-admin" ||
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

export function authenticateSkyPassword(password: string) {
  const secrets = getSkySecrets();

  if (!secrets) return false;

  return constantTimeStringEqual(password, secrets.password);
}

export function createSkySession() {
  const secrets = getSkySecrets();

  if (!secrets) return null;

  const expiresAt = Math.floor(Date.now() / 1000) + SKY_SESSION_TTL_SECONDS;

  return encodeSession(
    {
      v: SKY_SESSION_VERSION,
      role: "sky-admin",
      exp: expiresAt,
      nonce: randomBytes(16).toString("hex"),
    },
    secrets.sessionSecret,
  );
}

export function verifySkySession(value: string | undefined) {
  const secrets = getSkySecrets();

  if (!secrets || !value) return null;

  return decodeSession(value, secrets.sessionSecret);
}

export async function getSkySession() {
  const cookieStore = await cookies();

  return verifySkySession(cookieStore.get(SKY_SESSION_COOKIE)?.value);
}

export async function setSkySessionCookie(value: string) {
  const cookieStore = await cookies();

  cookieStore.set({
    name: SKY_SESSION_COOKIE,
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SKY_SESSION_TTL_SECONDS,
  });
}

export async function clearSkySessionCookie() {
  const cookieStore = await cookies();

  cookieStore.set({
    name: SKY_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export { SKY_SESSION_COOKIE };
