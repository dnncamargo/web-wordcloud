"use client";

import { useEffect, useMemo, useState } from "react";
import {
  FirebaseCloud,
  FirebaseWord,
  listenCloud,
  listenGlobalSettings,
  listenWords,
} from "@/lib/firebase/cloudService";

function getWeatherStatus(totalWords: number, uniqueWords: number) {
  if (totalWords === 0) return "Sem ideias";
  if (totalWords < 5) return "Nublado";
  if (totalWords < 15) return "Chuva de ideias";
  if (totalWords < 30) return "Tempestade de ideias";

  return "Temporal criativo";
}

function hashString(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

function getWordLayout(word: FirebaseWord, index: number) {
  const hash = hashString(word.id);
  const x = 8 + ((hash + index * 19) % 78);
  const y = 18 + ((hash * 3 + index * 23) % 58);
  const rotate = hash % 7 === 0 ? 90 : hash % 9 === 0 ? -90 : (hash % 9) - 4;
  const scale = Math.min(3.2, 0.9 + word.count * 0.22);
  const delay = -((hash % 30) / 10);
  const drift = hash % 2 === 0 ? 1 : -1;

  return {
    x,
    y,
    rotate,
    scale,
    delay,
    drift,
  };
}

export default function RainAreaPanel() {
  const [activeCloudId, setActiveCloudId] = useState<string | null>(null);
  const [activeCloud, setActiveCloud] = useState<FirebaseCloud | null>(null);
  const [words, setWords] = useState<FirebaseWord[]>([]);

  useEffect(() => {
    const unsubscribe = listenGlobalSettings((cloudId) => {
      setActiveCloudId(cloudId);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!activeCloudId) {
      setActiveCloud(null);
      setWords([]);
      return;
    }

    const unsubscribeCloud = listenCloud(activeCloudId, (cloud) => {
      setActiveCloud(cloud);
    });

    const unsubscribeWords = listenWords(activeCloudId, (nextWords) => {
      setWords(nextWords);
    });

    return () => {
      unsubscribeCloud();
      unsubscribeWords();
    };
  }, [activeCloudId]);

  const totalWords = words.reduce<number>(
    (total, word) => total + word.count,
    0
  );

  const weather = getWeatherStatus(totalWords, words.length);

  const sortedWords = useMemo(
    () => [...words].sort((a, b) => b.count - a.count),
    [words]
  );

  if (!activeCloudId || !activeCloud) {
    return (
      <main className="rain-stage sunny-rain">
        <section>
          <h1>Dia ensolarado;</h1>
          <p>sem nuvens.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="rain-stage">
      <header className="rain-overlay-header">
        <p>{activeCloud.title}</p>
        <h1>{activeCloud.publicTitle}</h1>
      </header>

      <section className="organic-cloud" aria-label="Nuvem de palavras">
        <div className="cloud-glow" />

        {sortedWords.length === 0 ? (
          <p className="empty-rain-message">Aguardando as primeiras ideias...</p>
        ) : (
          sortedWords.map((word, index) => {
            const layout = getWordLayout(word, index);

            return (
              <span
                key={word.id}
                className="rain-word"
                style={
                  {
                    "--x": `${layout.x}%`,
                    "--y": `${layout.y}%`,
                    "--rotation": `${layout.rotate}deg`,
                    "--scale": layout.scale,
                    "--delay": `${layout.delay}s`,
                    "--drift": layout.drift,
                  } as React.CSSProperties
                }
              >
                {word.text}
              </span>
            );
          })
        )}
      </section>

      <footer className="weather-footer">
        <span>{weather}</span>
        <small>
          {totalWords} evaporações · {words.length} ideias únicas
        </small>
      </footer>
    </main>
  );
}