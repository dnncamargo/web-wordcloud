import type { Metadata } from "next";
import { redirect } from "next/navigation";
import SkyLoginForm from "@/components/SkyLoginForm";
import { getSkySession } from "@/lib/sky/auth";

export const metadata: Metadata = {
  title: "Entrar no Céu - Nuvem Digital",
};

export default async function SkyLoginPage() {
  if (await getSkySession()) redirect("/sky");

  return (
    <main className="sky-login-page">
      <SkyLoginForm />
    </main>
  );
}
