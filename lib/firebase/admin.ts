import "server-only";

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function getAdminApp() {
  const existing = getApps().find((app) => app.name === "web-wordcloud-server");
  if (existing) return existing;

  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID ?? (emulatorHost ? process.env.GCLOUD_PROJECT : undefined);
  if (!projectId) throw new Error("Firebase server configuration is unavailable.");
  const clientProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if ((!emulatorHost && !clientProjectId) || (clientProjectId && clientProjectId !== projectId)) {
    throw new Error("Firebase server and client project configuration do not match.");
  }
  if (process.env.NODE_ENV !== "production" && !emulatorHost) {
    throw new Error("Firebase Admin is disabled outside production unless the Firestore Emulator is configured.");
  }
  if (emulatorHost && !/^(localhost|127\.0\.0\.1):\d+$/.test(emulatorHost)) {
    throw new Error("The Firestore Emulator must use a loopback address.");
  }

  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!emulatorHost && !rawServiceAccount) {
    throw new Error("Firebase server credentials are unavailable.");
  }

  let credential;
  if (rawServiceAccount) {
    let serviceAccount: { project_id?: unknown; client_email?: unknown; private_key?: unknown };
    try {
      serviceAccount = JSON.parse(rawServiceAccount) as typeof serviceAccount;
    } catch {
      throw new Error("Firebase server credentials are invalid.");
    }
    if (
      serviceAccount.project_id !== projectId ||
      typeof serviceAccount.client_email !== "string" ||
      typeof serviceAccount.private_key !== "string"
    ) {
      throw new Error("Firebase server project configuration does not match its credentials.");
    }
    credential = cert(serviceAccount as Parameters<typeof cert>[0]);
  } else credential = undefined;

  return initializeApp(credential ? { projectId, credential } : { projectId }, "web-wordcloud-server");
}

export function getServerFirestore() {
  return getFirestore(getAdminApp());
}
