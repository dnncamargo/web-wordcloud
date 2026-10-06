import type { Metadata } from "next";
import { redirect } from "next/navigation";
import SkyPanel from "@/components/SkyPanel";
import { logoutSky } from "@/app/sky/actions";
import { getSkySession } from "@/lib/sky/auth";

export const metadata: Metadata = {
  title: "Gerenciamento do Céu - Nuvem Digital",
};

export default async function SkyPage() {
  if (!(await getSkySession())) redirect("/sky/login");

  return (
    <div className="sky-authenticated-shell">
      <SkyPanel />

      <form action={logoutSky} className="sky-logout-form">
        <button className="button" type="submit">
          Sair
        </button>
      </form>
    </div>
  );
}
