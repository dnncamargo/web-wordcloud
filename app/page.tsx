import Link from "next/link";

export default function Home() {
  return (
    <main className="home-shell">
      <section className="home-card">
        <p className="eyebrow">Nuvem Digital</p>

        <h1>Ciclo de ideias em tempo real</h1>

        <p className="home-description">
          Crie nuvens, receba novas ideias, aprove palavras e acompanhe a chuva
          de respostas na tela pública.
        </p>

        <nav className="home-links">
          <Link href="/rain-area">Área de Precipitação</Link>
          <Link href="/evaporation">Evaporar ideias</Link>
          <Link href="/sky">Sky / Painel de controle</Link>
        </nav>
      </section>
    </main>
  );
}