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

type WordPlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function getWordBoxSize(word: FirebaseWord, fontSizeRem: number, rotation: number) {
  const textLength = word.text.trim().length;
  const wordCount = word.text.trim().split(/\s+/).filter(Boolean).length;

  const baseWidth = textLength * fontSizeRem * 1.15;
  const baseHeight = fontSizeRem * (wordCount > 1 ? 2.2 : 1.55);

  const isVertical = Math.abs(rotation) > 60;

  const width = isVertical ? baseHeight : baseWidth;
  const height = isVertical ? baseWidth : baseHeight;

  const margin = textLength <= 8 ? 3.5 : textLength <= 16 ? 5 : textLength <= 28 ? 7 : 9;

  return {
    width: width + margin,
    height: height + margin,
  };
}

function boxesOverlap(a: WordPlacement, b: WordPlacement) {
  const aLeft = a.x - a.width / 2;
  const aRight = a.x + a.width / 2;
  const aTop = a.y - a.height / 2;
  const aBottom = a.y + a.height / 2;

  const bLeft = b.x - b.width / 2;
  const bRight = b.x + b.width / 2;
  const bTop = b.y - b.height / 2;
  const bBottom = b.y + b.height / 2;

  return !(aRight < bLeft || aLeft > bRight || aBottom < bTop || aTop > bBottom);
}

function getCandidatePositions(total: number, seed: number) {
  const random = createRandom(seed + 700);

  const columns = total <= 3 ? 3 : total <= 8 ? 4 : total <= 16 ? 5 : total <= 28 ? 6 : 8;

  const rows = total <= 3 ? 2 : total <= 8 ? 3 : Math.ceil(total / columns);

  const candidates: LayoutSlot[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const baseX = ((column + 0.5) / columns) * 100;
      const baseY = 10 + ((row + 0.5) / rows) * 78;

      candidates.push({
        x: clamp(baseX + (random() - 0.5) * 8, 6, 94),
        y: clamp(baseY + (random() - 0.5) * 8, 10, 90),
      });
    }
  }

  for (let index = 0; index < total * 8; index += 1) {
    candidates.push({
      x: 7 + random() * 86,
      y: 12 + random() * 76,
    });
  }

  return shuffle(candidates, seed + 900);
}

function getSafePlacement(word: FirebaseWord, index: number, total: number, layoutSeed: number, occupied: WordPlacement[], fontSizeRem: number, rotation: number) {
  const random = createRandom(layoutSeed + index * 131);
  const box = getWordBoxSize(word, fontSizeRem, rotation);

  const candidates = getCandidatePositions(total, layoutSeed + index * 17);

  let bestCandidate: WordPlacement | null = null;
  let bestCollisionCount = Infinity;

  for (const candidate of candidates) {
    const safeX = clamp(candidate.x, box.width / 2 + 2, 100 - box.width / 2 - 2);
    const safeY = clamp(candidate.y, box.height / 2 + 4, 100 - box.height / 2 - 4);

    const placement: WordPlacement = {
      x: safeX,
      y: safeY,
      width: box.width,
      height: box.height,
    };

    const collisionCount = occupied.filter((item) => boxesOverlap(placement, item)).length;

    if (collisionCount === 0) {
      occupied.push(placement);
      return placement;
    }

    if (collisionCount < bestCollisionCount) {
      bestCollisionCount = collisionCount;
      bestCandidate = placement;
    }
  }

  const fallbackPlacement: WordPlacement = bestCandidate ?? {
    x: 15 + random() * 70,
    y: 18 + random() * 64,
    width: box.width,
    height: box.height,
  };

  occupied.push(fallbackPlacement);

  return fallbackPlacement;
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

  const totalWords = words.reduce((total, word) => total + word.count, 0);
  const maxCount = words.reduce((max, word) => Math.max(max, word.count), 1);
  const weather = getWeatherStatus(totalWords);

  const wordLayouts = useMemo(() => {
    const occupied: WordPlacement[] = [];

    return sortedWords.map((word, index) => {
      const fontSizeRem = getFontSizeRem(word, maxCount, sortedWords.length);
      const rotation = getRotation(word.text, layoutSeed, index);

      const placement = getSafePlacement(word, index, sortedWords.length, layoutSeed, occupied, fontSizeRem, rotation);

      const random = createRandom(layoutSeed + index * 41);

      return {
        word,
        x: placement.x,
        y: placement.y,
        fontSizeRem,
        rotation,
        side: random() > 0.5 ? 1 : -1,
        sway: 6 + Math.round(random() * 14),
        lift: -5 - Math.round(random() * 12),
        delay: -random() * 4,
      };
    });
  }, [sortedWords, maxCount, layoutSeed]);

  if (!activeCloudId || !activeCloud) {
    return (
      <main className="rain-stage sunny-rain">
        <section>
          <h1>Dia ensolarado</h1>
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
        {wordLayouts.length === 0 ? (
          <p className="empty-rain-message">Aguardando as primeiras ideias...</p>
        ) : (
          wordLayouts.map((layout) => (
            <span
              key={layout.word.id}
              className="rain-word-free"
              style={
                {
                  "--x": `${layout.x}%`,
                  "--y": `${layout.y}%`,
                  "--rotation": `${layout.rotation}deg`,
                  "--font-size": `${layout.fontSizeRem}rem`,
                  "--side": layout.side,
                  "--sway": `${layout.sway}px`,
                  "--lift": `${layout.lift}px`,
                  "--delay": `${layout.delay}s`,
                  "--weight": layout.word.count,
                } as React.CSSProperties
              }
            >
              {layout.word.text}
            </span>
          ))
        )}
      </section>

      <footer className="weather-footer">
        <span>{weather}</span>

        <small>
          {totalWords} evaporações · {words.length} ideias únicas
        </small>
        <button className="button" onClick={() => setLayoutSeed(Date.now())} title="Ventar" aria-label="Ventar">
          Ventar
        </button>
      </footer>
    </main>
  );
}
