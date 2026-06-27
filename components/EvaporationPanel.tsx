"use client";

import { useEffect, useState } from "react";
import {
  listenGlobalSettings,
  submitNewWord,
} from "@/lib/firebase/cloudService";
import { normalizeWord } from "@/lib/normalizeWord";

type LocalIdeaStatus = "local" | "sent" | "error";

type LocalIdea = {
  id: string;
  text: string;
  status: LocalIdeaStatus;
  cloudId: string | null;
  createdAt: string;
};

type LocalStorageData = {
  cloudId: string | null;
  ideas: LocalIdea[];
};

const STORAGE_KEY = "nuvem-digital-local-ideas";
const DEVICE_KEY = "nuvem-digital-device-id";

function getDeviceId() {
  const stored = localStorage.getItem(DEVICE_KEY);

  if (stored) return stored;

  const created = crypto.randomUUID();
  localStorage.setItem(DEVICE_KEY, created);

  return created;
}

function readLocalData(activeCloudId: string | null): LocalIdea[] {
  const stored = localStorage.getItem(STORAGE_KEY);

  if (!stored) return [];

  try {
    const data = JSON.parse(stored) as LocalStorageData;

    if (data.cloudId !== activeCloudId) {
      localStorage.removeItem(STORAGE_KEY);
      return [];
    }

    return Array.isArray(data.ideas) ? data.ideas : [];
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return [];
  }
}

function writeLocalData(activeCloudId: string | null, ideas: LocalIdea[]) {
  const data: LocalStorageData = {
    cloudId: activeCloudId,
    ideas,
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export default function EvaporationPanel() {
  const [text, setText] = useState("");
  const [ideas, setIdeas] = useState<LocalIdea[]>([]);
  const [activeCloudId, setActiveCloudId] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("Carregando nuvem ativa...");

  useEffect(() => {
    setDeviceId(getDeviceId());

    const unsubscribe = listenGlobalSettings((cloudId) => {
      setActiveCloudId(cloudId);
      setIdeas(readLocalData(cloudId));

      if (cloudId) {
        setFeedback("Nuvem ativa encontrada. Evapore uma ideia.");
      } else {
        setFeedback("Dia ensolarado; sem nuvens abertas.");
      }
    });

    return () => unsubscribe();
  }, []);

  function saveIdeas(nextIdeas: LocalIdea[]) {
    setIdeas(nextIdeas);
    writeLocalData(activeCloudId, nextIdeas);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalized = normalizeWord(text);

    if (!normalized) return;

    const nextIdea: LocalIdea = {
      id: crypto.randomUUID(),
      text: text.trim(),
      status: "local",
      cloudId: activeCloudId,
      createdAt: new Date().toISOString(),
    };

    const nextIdeas = [nextIdea, ...ideas];

    saveIdeas(nextIdeas);
    setText("");

    if (!activeCloudId || !deviceId) {
      setFeedback("Ideia salva localmente. Nenhuma nuvem ativa no momento.");
      return;
    }

    try {
      await submitNewWord(activeCloudId, nextIdea.text, deviceId);

      const updatedIdeas = nextIdeas.map((idea) =>
        idea.id === nextIdea.id ? { ...idea, status: "sent" as const } : idea
      );

      saveIdeas(updatedIdeas);
      setFeedback("Ideia evaporada para aprovação.");
    } catch (error) {
      console.error(error);

      const updatedIdeas = nextIdeas.map((idea) =>
        idea.id === nextIdea.id ? { ...idea, status: "error" as const } : idea
      );

      saveIdeas(updatedIdeas);
      setFeedback("A ideia ficou salva nesta máquina, mas não foi enviada.");
    }
  }

  return (
    <main className="evaporation-stage">
      <section className="evaporation-sky" aria-label="Ideias evaporadas">
        {ideas.length === 0 ? (
          <div className="empty-evaporation">
            <span>☁</span>
            <p>Evapore a primeira ideia</p>
          </div>
        ) : (
          ideas.slice(0, 18).map((idea, index) => (
            <span
              key={idea.id}
              className={`floating-idea ${idea.status}`}
              style={
                {
                  "--idea-left": `${12 + ((index * 17) % 72)}%`,
                  "--idea-delay": `${index * -0.35}s`,
                  "--idea-drift": `${index % 2 === 0 ? 1 : -1}`,
                } as React.CSSProperties
              }
            >
              {idea.text}
            </span>
          ))
        )}
      </section>

      <section className="evaporation-bottom">
        <form onSubmit={handleSubmit} className="evaporation-form">
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Digite uma palavra ou ideia curta"
            maxLength={40}
            aria-label="Digite uma ideia"
          />

          <button type="submit">Evaporar</button>
        </form>

        <p className="cloud-feedback">{feedback}</p>
      </section>
    </main>
  );
}