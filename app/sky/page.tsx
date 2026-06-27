import type { Metadata } from "next";
import SkyPanel from "@/components/SkyPanel";

export const metadata: Metadata = {
  title: "Gerenciamento do Céu - Nuvem Digital",
};

export default function SkyPage() {
  return <SkyPanel />;
}