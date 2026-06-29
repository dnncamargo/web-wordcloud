"use client";

import { useEffect, useMemo, useState } from "react";
import { FirebaseCloud, FirebaseWord, listenCloud, listenGlobalSettings, listenWords } from "@/lib/firebase/cloudService";

type LayoutSlot = {
  x: number;
  y: number;
};

function getWeatherStatus(totalWords: number) {
  if (totalWords === 0) return "Sem ideias";
  if (totalWords < 5) return "Nublado";
  if (totalWords < 15) return "Chuva de ideias";
  if (totalWords < 30) return "Tempestade de ideias";

  return "Temporal criativo";
}

function createRandom(seed: number) {
  let value = seed;

  return function random() {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;

    let result = Math.imul(value ^ (value >>> 15), 1 | value);
    result = (result + Math.imul(result ^ (result >>> 7), 61 | result)) ^ result;

    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function shuffle<T>(items: T[], seed: number) {
  const random = createRandom(seed);
  const nextItems = [...items];

  for (let index = nextItems.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [nextItems[index], nextItems[target]] = [nextItems[target], nextItems[index]];
  }

  return nextItems;
}

function createSlots(total: number, seed: number): LayoutSlot[] {
  const columns = total <= 3 ? 3 : total <= 8 ? 4 : total <= 16 ? 5 : total <= 28 ? 6 : 8;

  const rows = total <= 3 ? 2 : total <= 8 ? 3 : Math.ceil(total / columns);

  const random = createRandom(seed + 101);
  const slots: LayoutSlot[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const baseX = ((column + 0.5) / columns) * 100;
      const baseY = 10 + ((row + 0.5) / rows) * 78;

      const jitterX = (random() - 0.5) * 8;
      const jitterY = (random() - 0.5) * 8;

      slots.push({
        x: clamp(baseX + jitterX, 7, 93),
        y: clamp(baseY + jitterY, 10, 90),
      });
    }
  }

  return shuffle(slots, seed + 303);
}

function getRotation(text: string, seed: number, index: number) {
  const cleanText = text.trim();
  const characterCount = cleanText.length;
  const wordCount = cleanText.split(/\s+/).filter(Boolean).length;

  const random = createRandom(seed + index * 97 + characterCount * 13);
  const direction = random() > 0.5 ? 1 : -1;

  if (wordCount === 1 && characterCount <= 7 && random() > 0.82) {
    return direction * 90;
  }

  if (wordCount === 1 && characterCount <= 10) {
    return direction * Math.round(8 + random() * 18);
  }

  if (wordCount === 1 && characterCount <= 14) {
    return direction * Math.round(random() * 12);
  }

  return direction * Math.round(random() * 5);
}

function getFontSizeRem(word: FirebaseWord, maxCount: number, uniqueCount: number) {
  const hasRepeatedIdeas = maxCount > 1;

  const minSize = uniqueCount <= 8 ? 1.35 : uniqueCount <= 18 ? 1.1 : uniqueCount <= 32 ? 0.95 : 0.82;

  const maxSize = uniqueCount <= 4 ? 6.8 : uniqueCount <= 10 ? 5.2 : uniqueCount <= 20 ? 3.8 : 2.8;

  if (!hasRepeatedIdeas) return minSize;

  const relativeWeight = Math.log1p(word.count - 1) / Math.log1p(maxCount - 1);

  const textLength = word.text.trim().length;

  const phraseFit = textLength <= 10 ? 1 : textLength <= 18 ? 0.82 : textLength <= 28 ? 0.64 : 0.5;

  const size = minSize + relativeWeight * (maxSize - minSize);

  return clamp(size * phraseFit, minSize, maxSize);
}

function getSafePosition(slot: LayoutSlot, word: FirebaseWord, fontSizeRem: number, rotation: number) {
  const textLength = word.text.trim().length;
  const isMostlyVertical = Math.abs(rotation) > 60;

  const horizontalPressure = isMostlyVertical ? fontSizeRem * 3 : textLength * fontSizeRem * 0.42;

  const verticalPressure = isMostlyVertical ? textLength * fontSizeRem * 0.28 : fontSizeRem * 3.2;

  const safeX = clamp(7 + horizontalPressure, 9, 38);
  const safeY = clamp(8 + verticalPressure, 12, 34);

  return {
    x: clamp(slot.x, safeX, 100 - safeX),
    y: clamp(slot.y, safeY, 100 - safeY),
  };
}

export default function RainAreaPanel() {
  const [activeCloudId, setActiveCloudId] = useState<string | null>(null);
  const [activeCloud, setActiveCloud] = useState<FirebaseCloud | null>(null);
  const [words, setWords] = useState<FirebaseWord[]>([]);
  const [layoutSeed, setLayoutSeed] = useState(1);

  useEffect(() => {
    const unsubscribe = listenGlobalSettings((cloudId, windSeed) => {
      setActiveCloudId(cloudId);
      setLayoutSeed(windSeed || Date.now());
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!activeCloudId) {
      setActiveCloud(null);
      setWords([]);
      return;
    }

    const unsubscribeCloud = listenCloud(activeCloudId, setActiveCloud);
    const unsubscribeWords = listenWords(activeCloudId, setWords);

    return () => {
      unsubscribeCloud();
      unsubscribeWords();
    };
  }, [activeCloudId]);

  const sortedWords = useMemo(() => [...words].sort((a, b) => b.count - a.count), [words]);

  const slots = useMemo(() => createSlots(sortedWords.length, layoutSeed), [sortedWords.length, layoutSeed]);

  const totalWords = words.reduce((total, word) => total + word.count, 0);
  const maxCount = words.reduce((max, word) => Math.max(max, word.count), 1);
  const weather = getWeatherStatus(totalWords);

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
    <main className="rain-stage free-rain-stage">
      <header className="rain-overlay-header">
        <p>{activeCloud.title}</p>
        <h1>{activeCloud.publicTitle}</h1>
      </header>

      <section className="free-rain-field" aria-label="Ideias em precipitação">
        {sortedWords.length === 0 ? (
          <p className="empty-rain-message">Aguardando as primeiras ideias...</p>
        ) : (
          sortedWords.map((word, index) => {
            const slot = slots[index] ?? { x: 50, y: 50 };
            const fontSizeRem = getFontSizeRem(word, maxCount, sortedWords.length);
            const rotation = getRotation(word.text, layoutSeed, index);
            const safePosition = getSafePosition(slot, word, fontSizeRem, rotation);
            const random = createRandom(layoutSeed + index * 41);
            const side = random() > 0.5 ? 1 : -1;
            const sway = 8 + Math.round(random() * 20);
            const lift = -6 - Math.round(random() * 18);
            const delay = -random() * 4;

            return (
              <span
                key={word.id}
                className="rain-word-free"
                style={
                  {
                    "--x": `${safePosition.x}%`,
                    "--y": `${safePosition.y}%`,
                    "--rotation": `${rotation}deg`,
                    "--font-size": `${fontSizeRem}rem`,
                    "--side": side,
                    "--sway": `${sway}px`,
                    "--lift": `${lift}px`,
                    "--delay": `${delay}s`,
                    "--weight": word.count,
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

        <button className="button" onClick={() => setLayoutSeed(Date.now())}>
          Ventar
        </button>
      </footer>
    </main>
  );
}
