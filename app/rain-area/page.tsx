import type { Metadata } from "next";
import RainAreaPanel from "@/components/RainAreaPanel";

export const metadata: Metadata = {
  title: "Zona de Precipitação - Nuvem Digital",
};

export default function RainAreaPage() {
  return <RainAreaPanel />;
}