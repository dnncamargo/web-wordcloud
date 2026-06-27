"use client";

import { useEffect, useState } from "react";
import { normalizeWord } from "../lib/normalizeWord";

type LocalIdea = {
  id: string;
  text: string;
  status: "local";
  createdAt: string;
};

const STORAGE_KEY = "nuvem-digital-local-ideas";

export default function EvaporationPage() {
  const [text, setText] = useState("");
  const [ideas, setIdeas] = useState<LocalIdea[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);

    if (stored) {
      setIdeas(JSON.parse(stored));
    }
  }, []);

  function saveIdeas(nextIdeas: LocalIdea[]) {
    setIdeas(nextIdeas);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextIdeas));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalized = normalizeWord(text);

    if (!normalized) return;

    const nextIdea: LocalIdea = {
      id: crypto.randomUUID(),
      text: text.trim(),
      status: "local",
      createdAt: new Date().toISOString(),
    };

    saveIdeas([nextIdea, ...ideas]);
    setText("");
  }

  return (
    <main className="evaporation-shell">
      <section className="evaporation-card">
        <p className="eyebrow">Evaporação</p>

        <h1>Envie uma nova ideia</h1>

        <p>
          As ideias ficam registradas nesta máquina e, na próxima etapa, serão
          enviadas ao Firebase para aprovação no Sky.
        </p>

        <form onSubmit={handleSubmit} className="idea-form">
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Digite uma palavra ou ideia curta"
            maxLength={40}
          />

          <button type="submit">Evaporar</button>
        </form>

        <section className="local-list">
          <h2>Ideias desta máquina</h2>

          {ideas.length === 0 ? (
            <p className="empty-message">Nenhuma ideia evaporou ainda.</p>
          ) : (
            <ul>
              {ideas.map((idea) => (
                <li key={idea.id}>{idea.text}</li>
              ))}
            </ul>
          )}
        </section>
      </section>
    </main>
  );
}