"use client";

import { useEffect, useState } from "react";
import {
  activateCloud,
  approveNewWord,
  archiveCloud,
  createCloud,
  deleteWord,
  FirebaseCloud,
  FirebaseNewWord,
  FirebaseWord,
  listenClouds,
  listenGlobalSettings,
  listenNewWords,
  listenWords,
  mergeNewWordIntoWord,
  rejectNewWord,
  updateCloudText,
  updateWordText,
} from "@/lib/firebase/cloudService";

export default function SkyPanel() {
  const [clouds, setClouds] = useState<FirebaseCloud[]>([]);
  const [activeCloudId, setActiveCloudId] = useState<string | null>(null);
  const [words, setWords] = useState<FirebaseWord[]>([]);
  const [newWords, setNewWords] = useState<FirebaseNewWord[]>([]);
  const [titleDraft, setTitleDraft] = useState("");
  const [questionDraft, setQuestionDraft] = useState("");
  const [feedback, setFeedback] = useState("");

  const activeCloud = clouds.find((cloud) => cloud.id === activeCloudId) ?? null;

  useEffect(() => {
    const unsubscribeClouds = listenClouds(setClouds);
    const unsubscribeSettings = listenGlobalSettings(setActiveCloudId);

    return () => {
      unsubscribeClouds();
      unsubscribeSettings();
    };
  }, []);

  useEffect(() => {
    if (!activeCloudId) {
      setWords([]);
      setNewWords([]);
      return;
    }

    const unsubscribeWords = listenWords(activeCloudId, setWords);
    const unsubscribeNewWords = listenNewWords(activeCloudId, setNewWords);

    return () => {
      unsubscribeWords();
      unsubscribeNewWords();
    };
  }, [activeCloudId]);

  useEffect(() => {
    setTitleDraft(activeCloud?.title ?? "");
    setQuestionDraft(activeCloud?.publicTitle ?? "");
  }, [activeCloud?.id, activeCloud?.title, activeCloud?.publicTitle]);

  async function handleCreateCloud() {
    const id = await createCloud();
    await activateCloud(id);
    setFeedback("Nova nuvem criada.");
  }

  async function saveCloudField(field: "title" | "publicTitle", value: string) {
    if (!activeCloudId || !activeCloud) return;

    const cleanValue = value.trim();

    if (!cleanValue) return;

    const currentValue =
      field === "title" ? activeCloud.title : activeCloud.publicTitle;

    if (cleanValue === currentValue) return;

    await updateCloudText(activeCloudId, field, cleanValue);
    setFeedback("Nuvem atualizada.");
  }

  async function handleMerge(newWord: FirebaseNewWord, targetWordId: string) {
    if (!activeCloudId || !targetWordId) return;

    const targetWord = words.find((word) => word.id === targetWordId);

    if (!targetWord) return;

    await mergeNewWordIntoWord(activeCloudId, newWord, targetWord);
    setFeedback(`"${newWord.text}" foi mesclada com "${targetWord.text}".`);
  }

  async function handleUpdateAcceptedWord(word: FirebaseWord, value: string) {
    if (!activeCloudId) return;

    const cleanValue = value.trim();

    if (!cleanValue || cleanValue === word.text) return;

    await updateWordText(activeCloudId, word, cleanValue);
    setFeedback("Palavra atualizada.");
  }

  return (
    <main className="sky-clean">
      <aside className="sky-clean-column sky-clouds-column">
        <header className="sky-clean-header">
          <div>
            <span>Sky</span>
            <h1>Gerenciamento do céu</h1>
          </div>

          <button className="primary-clean-button" onClick={handleCreateCloud}>
            Nova
          </button>
        </header>

        <section className="clean-list">
          {clouds.length === 0 ? (
            <p className="clean-empty">Nenhuma nuvem criada.</p>
          ) : (
            clouds.map((cloud) => {
              const isActive = cloud.id === activeCloudId;
              const isArchived = cloud.status === "archived";

              return (
                <article
                  key={cloud.id}
                  className={[
                    "clean-cloud-item",
                    isActive ? "active" : "",
                    isArchived ? "archived" : "",
                  ].join(" ")}
                >
                  <button
                    className="cloud-name-button"
                    onClick={() => !isArchived && activateCloud(cloud.id)}
                    disabled={isArchived}
                  >
                    <strong>{cloud.title || "Sem título"}</strong>
                    <small>
                      {isActive
                        ? "ativa"
                        : isArchived
                          ? "arquivada"
                          : "inativa"}
                    </small>
                  </button>

                  {isActive && (
                    <button
                      className="ghost-danger-button"
                      onClick={() => archiveCloud(cloud.id)}
                    >
                      arquivar
                    </button>
                  )}
                </article>
              );
            })
          )}
        </section>
      </aside>

      <section className="sky-clean-column sky-current-column">
        {activeCloud ? (
          <>
            <header className="current-cloud-clean-header">
              <input
                className="clean-title-input"
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => saveCloudField("title", titleDraft)}
                placeholder="Nome da nuvem"
              />

              <textarea
                className="clean-question-input"
                value={questionDraft}
                onChange={(event) => setQuestionDraft(event.target.value)}
                onBlur={() => saveCloudField("publicTitle", questionDraft)}
                placeholder="Pergunta investigadora"
                rows={2}
              />
            </header>

            <section className="clean-section">
              <div className="clean-section-title">
                <h2>Palavras aceitas</h2>
                <span>{words.length}</span>
              </div>

              {words.length === 0 ? (
                <p className="clean-empty">Nenhuma palavra aceita ainda.</p>
              ) : (
                <div className="accepted-clean-list">
                  {words.map((word) => (
                    <article key={word.id} className="accepted-clean-word">
                      <input
                        defaultValue={word.text}
                        onBlur={(event) =>
                          handleUpdateAcceptedWord(word, event.target.value)
                        }
                      />

                      <span>{word.count}</span>

                      {(word.aliases?.length ?? 0) > 0 && (
                        <small title={word.aliases?.join(", ")}>
                          {word.aliases?.length} mesclada
                          {word.aliases?.length === 1 ? "" : "s"}
                        </small>
                      )}

                      <button
                        className="ghost-danger-button"
                        onClick={() => deleteWord(activeCloud.id, word.id)}
                      >
                        remover
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : (
          <section className="clean-empty-state">
            <h2>Dia ensolarado.</h2>
            <p>Nenhuma nuvem ativa no momento.</p>
            <button className="primary-clean-button" onClick={handleCreateCloud}>
              Criar nuvem
            </button>
          </section>
        )}
      </section>

      <section className="sky-clean-column sky-new-column">
        <div className="clean-section-title">
          <h2>Novas ideias</h2>
          <span>{newWords.length}</span>
        </div>

        {!activeCloudId ? (
          <p className="clean-empty">Ative uma nuvem para receber ideias.</p>
        ) : newWords.length === 0 ? (
          <p className="clean-empty">Nenhuma ideia pendente.</p>
        ) : (
          <div className="new-clean-list">
            {newWords.map((word) => (
              <article key={word.id} className="new-clean-word">
                <strong>{word.text}</strong>

                <div className="clean-action-row">
                  <button
                    onClick={() => approveNewWord(activeCloudId, word.id, word.text)}
                  >
                    aceitar
                  </button>

                  <button onClick={() => rejectNewWord(activeCloudId, word.id)}>
                    recusar
                  </button>
                </div>

                <select
                  defaultValue=""
                  onChange={(event) => handleMerge(word, event.target.value)}
                  disabled={words.length === 0}
                >
                  <option value="" disabled>
                    mesclar com...
                  </option>

                  {words.map((acceptedWord) => (
                    <option key={acceptedWord.id} value={acceptedWord.id}>
                      {acceptedWord.text}
                    </option>
                  ))}
                </select>
              </article>
            ))}
          </div>
        )}

        {feedback && <p className="clean-feedback">{feedback}</p>}
      </section>
    </main>
  );
}