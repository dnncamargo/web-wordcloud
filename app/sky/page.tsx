import { clouds, skySettings } from "../lib/mockData";

export default function SkyPage() {
  const activeCloud = clouds.find(
    (cloud) => cloud.id === skySettings.activeCloudId
  );

  return (
    <main className="sky-shell">
      <section className="sky-header">
        <p className="eyebrow">Sky</p>
        <h1>Painel de controle</h1>
        <p>
          Aqui serão criadas novas nuvens, aprovadas ideias e arquivadas nuvens
          antigas.
        </p>
      </section>

      <section className="sky-grid">
        <article className="sky-panel">
          <h2>Nuvem ativa</h2>

          {activeCloud ? (
            <>
              <strong>{activeCloud.title}</strong>
              <p>{activeCloud.publicTitle}</p>
              <span className="status-pill">{activeCloud.status}</span>
            </>
          ) : (
            <p>Dia ensolarado; sem nuvens.</p>
          )}
        </article>

        <article className="sky-panel">
          <h2>Nuvens</h2>

          <ul className="cloud-list">
            {clouds.map((cloud) => (
              <li key={cloud.id}>
                <strong>{cloud.title}</strong>
                <span>{cloud.status}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="sky-panel">
          <h2>Novas ideias</h2>
          <p>
            Na próxima etapa, esta área receberá as ideias pendentes do Firebase
            para aprovação ou rejeição.
          </p>
        </article>
      </section>
    </main>
  );
}