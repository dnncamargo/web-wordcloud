import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Mapa Meteorológico - Nuvem Digital",
  description: "Mapa de rotas da Nuvem Digital.",
};

const routes = [
  {
    title: "Evaporação de Ideias",
    path: "/",
    description: "Página usada pelos participantes para evaporar novas ideias.",
    status: "Pública",
  },
  {
    title: "Zona de Precipitação",
    path: "/rain-area",
    description: "Visualização principal das ideias aprovadas em tempo real.",
    status: "Projeção",
  },
  {
    title: "Gerenciamento do Céu",
    path: "/sky",
    description: "Área administrativa para criar, precipitar, arquivar e moderar nuvens.",
    status: "Admin",
  },
  {
    title: "Teste do Firebase",
    path: "/firebase-test",
    description: "Página técnica para testar leitura e escrita no Firestore.",
    status: "Debug",
  },
  {
    title: "API",
    path: "/api/rain-snapshot",
    description: "Endpoint JSON usado para obter o estado atual da nuvem em precipitação.",
    status: "Sistema",
  },
  {
    title: "Zona de Precipitação (Legado)",
    path: "/rain-area-legacy",
    description: "Versão alternativa para telas antigas ou navegadores com baixa compatibilidade.",
    status: "Legado",
  },
];

export default function WeatherMapPage() {
  return (
    <main className="weathermap-page">
      <header className="weathermap-header">
        <p>Nuvem Digital</p>
        <h1>Mapa Meteorológico</h1><br />
        <span>Mapa das rotas do projeto</span>
      </header>

      <section className="weathermap-grid">
        {routes.map((route) => (
          <Link key={route.path} href={route.path} className="weathermap-card">
            <div>
              <span className="weathermap-status">{route.status}</span>
              <h2>{route.title}</h2>
              <p>{route.description}</p>
            </div>

            <code>{route.path}</code>
          </Link>
        ))}
      </section>
    </main>
  );
}