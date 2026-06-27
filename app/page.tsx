import type { Metadata } from "next";
import EvaporationPanel from "@/components/EvaporationPanel";

export const metadata: Metadata = {
  title: "Evaporação de Ideias - Nuvem Digital",
};

export default function Home() {
  return <EvaporationPanel />;
}