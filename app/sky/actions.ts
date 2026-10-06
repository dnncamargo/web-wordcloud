"use server";

import { redirect } from "next/navigation";
import {
  authenticateSkyPassword,
  clearSkySessionCookie,
  createSkySession,
  setSkySessionCookie,
} from "@/lib/sky/auth";

export type SkyLoginState = {
  error: string | null;
};

export async function loginSky(_previousState: SkyLoginState, formData: FormData): Promise<SkyLoginState> {
  const passwordValue = formData.get("password");
  const password = typeof passwordValue === "string" ? passwordValue : "";
  const session = createSkySession();

  if (!session || !authenticateSkyPassword(password)) {
    return { error: "Não foi possível entrar. Verifique a senha." };
  }

  await setSkySessionCookie(session);
  redirect("/sky");
}

export async function logoutSky() {
  await clearSkySessionCookie();
  redirect("/sky/login");
}
