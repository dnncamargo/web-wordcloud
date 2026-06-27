import { clouds, skySettings } from "../lib/mockData";
import type { Word } from "../types/cloud";

export default function RainAreaPage() {
  const activeCloud = clouds.find(
    (cloud) => cloud.id === skySettings.activeCloudId
  );

  if (!activeCloud) {
    return (
      <main className="rain-area sunny">
        <h1>Dia ensolarado;</h1>
        <p>sem nuvens.</p>
      </main>
    );
  }

  const totalWords = activeCloud.words.reduce<number>(
    (total, word) => total + word.count,
    0
  );

  const weather =
    totalWords >= 18
      ? "Tempestade de ideias"
      : totalWords >= 10
        ? "Chuva de ideias"
        : "Nublado";

  return (
    <main className="rain-area">
      <header className="rain-header">
        <p>{skySettings.rainAreaTitle}</p>
        <h1>{activeCloud.publicTitle}</h1>
        <span>{weather}</span>
      </header>

      <section className="word-cloud" aria-label="Nuvem de palavras">
        {activeCloud.words.map((word) => (
          <span
            key={word.id}
            className="cloud-word"
            style={{
              fontSize: `${1 + word.count * 0.25}rem`,
              opacity: Math.min(1, 0.45 + word.count * 0.08),
            }}
          >
            {word.text}
          </span>
        ))}
      </section>
    </main>
  );
}