"use client";

import { useEffect, useMemo, useState } from "react";
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
  unarchiveCloud,
  updateCloudText,
  updateWordText,
  blowWind,
} from "@/lib/firebase/cloudService";

function getStatusLabel(status: FirebaseCloud["status"]) {
  if (status === "open") return "aberta";
  if (status === "draft") return "rascunho";
  if (status === "closed") return "fechada";
  return "arquivada";
}

function getDeviceShortId(deviceId: string) {
  if (!deviceId) return "????";

  return deviceId.replaceAll("-", "").slice(0, 4).toUpperCase();
}

export default function SkyPanel() {
  const [clouds, setClouds] = useState<FirebaseCloud[]>([]);
  const [activeCloudId, setActiveCloudId] = useState<string | null>(null);
  const [selectedCloudId, setSelectedCloudId] = useState<string | null>(null);
  const [words, setWords] = useState<FirebaseWord[]>([]);
  const [newWords, setNewWords] = useState<FirebaseNewWord[]>([]);
  const [titleDraft, setTitleDraft] = useState("");
  const [questionDraft, setQuestionDraft] = useState("");
  const [feedback, setFeedback] = useState("");

  const selectedCloud = clouds.find((cloud) => cloud.id === selectedCloudId) ?? null;

  useEffect(() => {
    const unsubscribeClouds = listenClouds(setClouds);
    const unsubscribeSettings = listenGlobalSettings((cloudId) => {
      setActiveCloudId(cloudId);

      setSelectedCloudId((currentSelectedId) => {
        if (currentSelectedId) return currentSelectedId;
        return cloudId;
      });
    });

    return () => {
      unsubscribeClouds();
      unsubscribeSettings();
    };
  }, []);

  useEffect(() => {
    if (selectedCloudId) return;

    const firstAvailableCloud = clouds[0];

    if (firstAvailableCloud) {
      setSelectedCloudId(firstAvailableCloud.id);
    }
  }, [clouds, selectedCloudId]);

  useEffect(() => {
    if (!selectedCloudId) {
      setWords([]);
      setNewWords([]);
      return;
    }

    const unsubscribeWords = listenWords(selectedCloudId, setWords);
    const unsubscribeNewWords = listenNewWords(selectedCloudId, setNewWords);

    return () => {
      unsubscribeWords();
      unsubscribeNewWords();
    };
  }, [selectedCloudId]);

  useEffect(() => {
    setTitleDraft(selectedCloud?.title ?? "");
    setQuestionDraft(selectedCloud?.publicTitle ?? "");
  }, [selectedCloud?.id, selectedCloud?.title, selectedCloud?.publicTitle]);

  async function handleCreateCloud() {
    const id = await createCloud();

    setSelectedCloudId(id);
    setFeedback("Rascunho criado. Edite e ative quando estiver pronto.");
  }

  async function handleActivateCloud(cloudId: string) {
    await activateCloud(cloudId);

    setSelectedCloudId(cloudId);
    setFeedback("Nuvem ativada.");
  }

  async function handleArchiveCloud(cloudId: string) {
    await archiveCloud(cloudId);

    setSelectedCloudId(cloudId);
    setFeedback("Nuvem arquivada.");
  }

  async function handleUnarchiveCloud(cloudId: string) {
    await unarchiveCloud(cloudId);

    setSelectedCloudId(cloudId);
    setFeedback("Nuvem desarquivada.");
  }

  async function saveCloudField(field: "title" | "publicTitle", value: string) {
    if (!selectedCloudId || !selectedCloud) return;

    const cleanValue = value.trim();

    if (!cleanValue) return;

    const currentValue = field === "title" ? selectedCloud.title : selectedCloud.publicTitle;

    if (cleanValue === currentValue) return;

    await updateCloudText(selectedCloudId, field, cleanValue);
    setFeedback("Nuvem atualizada.");
  }

  async function handleMerge(newWord: FirebaseNewWord, targetWordId: string) {
    if (!selectedCloudId || !targetWordId) return;

    const targetWord = words.find((word) => word.id === targetWordId);

    if (!targetWord) return;

    await mergeNewWordIntoWord(selectedCloudId, newWord, targetWord);
    setFeedback(`"${newWord.text}" foi mesclada com "${targetWord.text}".`);
  }

  async function handleUpdateAcceptedWord(word: FirebaseWord, value: string) {
    if (!selectedCloudId) return;

    const cleanValue = value.trim();

    if (!cleanValue || cleanValue === word.text) return;

    await updateWordText(selectedCloudId, word, cleanValue);
    setFeedback("Palavra atualizada.");
  }

  const pendingIdeaStats = useMemo(() => {
    const byIdea = new Map<string, number>();
    const byDeviceAndIdea = new Map<string, number>();

    for (const word of newWords) {
      const ideaKey = word.normalized || word.text.trim().toLowerCase();
      const deviceKey = `${word.deviceId || "unknown"}::${ideaKey}`;

      byIdea.set(ideaKey, (byIdea.get(ideaKey) ?? 0) + 1);
      byDeviceAndIdea.set(deviceKey, (byDeviceAndIdea.get(deviceKey) ?? 0) + 1);
    }

    return {
      byIdea,
      byDeviceAndIdea,
    };
  }, [newWords]);

  return (
    <main className="sky-clean">
      {/* Gerenciamento de Nuvens */}
      <aside className="sky-clean-column sky-clouds-column">
        <header className="sky-clean-header">
          <h1>Gerenciamento do Céu</h1>
          <div className="sky-clean-header-actions">
            <button className="button" onClick={handleCreateCloud}>
              +
            </button>
            <button
              className="button"
              onClick={async () => {
                await blowWind();
                setFeedback("O vento reorganizou a chuva.");
              }}
              title="Ventar"
              aria-label="Ventar"
            >
              ≈
            </button>
          </div>
        </header>

        <section className="column-scroll-body clean-list">
          {clouds.length === 0 ? (
            <p className="clean-empty">Nenhuma nuvem criada.</p>
          ) : (
            clouds.map((cloud) => {
              const isActive = cloud.id === activeCloudId;
              const isSelected = cloud.id === selectedCloudId;
              const isArchived = cloud.status === "archived";

              return (
                <article key={cloud.id} className={["clean-cloud-item", isSelected ? "selected" : "", isActive ? "active" : "", isArchived ? "archived" : ""].join(" ")}>
                  <button className="cloud-name-button" onClick={() => setSelectedCloudId(cloud.id)}>
                    <strong>{cloud.title || "Sem título"}</strong>

                    <small>{isActive ? "em precipitação" : getStatusLabel(cloud.status)}</small>
                  </button>

                  <div className="cloud-row-actions">
                    {!isActive && !isArchived && (
                      <button className="button" onClick={() => handleActivateCloud(cloud.id)}>
                        Ativar
                      </button>
                    )}

                    {isActive && (
                      <button className="button" onClick={() => handleArchiveCloud(cloud.id)}>
                        Arquivar
                      </button>
                    )}

                    {isArchived && (
                      <button className="button" onClick={() => handleUnarchiveCloud(cloud.id)}>
                        Desarquivar
                      </button>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </section>
      </aside>

      {/* Gestão da Nuvem Selecionada */}
      <section className="sky-clean-column sky-current-column">
        {selectedCloud ? (
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

              <div className="column-scroll-body accepted-clean-list">
                {words.length === 0 ? (
                  <p className="clean-empty">Nenhuma palavra aceita ainda.</p>
                ) : (
                  words.map((word) => (
                    <article key={word.id} className="accepted-clean-word">
                      <input defaultValue={word.text} onBlur={(event) => handleUpdateAcceptedWord(word, event.target.value)} />

                      <span className={`merge-count ${(word.aliases?.length ?? 0) === 0 ? "empty" : ""}`} title={word.aliases?.join(", ")}>
                        (+{word.aliases?.length ?? 0})
                      </span>
                      <span className="word-count">{word.count}</span>

                      <button className="button remove-word-button" aria-label={`Remover ${word.text}`} title="Remover" onClick={() => deleteWord(selectedCloud.id, word.id)}>
                        ×
                      </button>
                    </article>
                  ))
                )}
              </div>
            </section>
          </>
        ) : (
          <section className="clean-empty-state">
            <h2>Dia ensolarado.</h2>
            <p>Nenhuma nuvem selecionada.</p>

            <button className="button" onClick={handleCreateCloud}>
              Criar nuvem
            </button>
          </section>
        )}
      </section>

      {/* Recepção de Palavras */}
      <section className="sky-clean-column sky-new-column">
        <div className="clean-section-title">
          <h2>Novas ideias</h2>
          <span>{newWords.length}</span>
        </div>

        <div className="column-scroll-body new-clean-list">
          {!selectedCloudId ? (
            <p className="clean-empty">Selecione uma nuvem.</p>
          ) : newWords.length === 0 ? (
            <p className="clean-empty">Nenhuma ideia pendente.</p>
          ) : (
            newWords.map((word) => (
              <article key={word.id} className="new-clean-word">
                <strong>{word.text}</strong>

                {(() => {
                  const ideaKey = word.normalized || word.text.trim().toLowerCase();
                  const deviceKey = `${word.deviceId || "unknown"}::${ideaKey}`;
                  const sameIdeaCount = pendingIdeaStats.byIdea.get(ideaKey) ?? 1;
                  const sameDeviceIdeaCount = pendingIdeaStats.byDeviceAndIdea.get(deviceKey) ?? 1;

                  return (
                    <div className="new-word-meta">
                      <span>{getDeviceShortId(word.deviceId)}</span>

                      {sameDeviceIdeaCount > 1 && <span className="warning-meta"> repetiu {sameDeviceIdeaCount}x</span>}

                      {sameIdeaCount > sameDeviceIdeaCount && <span>total {sameIdeaCount}x</span>}
                    </div>
                  );
                })()}

                <div className="clean-action-row">
                  <button className="button" onClick={() => approveNewWord(selectedCloudId, word.id, word.text)}>
                    Aceitar
                  </button>

                  <button className="button" onClick={() => rejectNewWord(selectedCloudId, word.id)}>
                    Recusar
                  </button>
                </div>

                <select defaultValue="" onChange={(event) => handleMerge(word, event.target.value)} disabled={words.length === 0}>
                  <option value="" disabled>
                    Mesclar com...
                  </option>

                  {words.map((acceptedWord) => (
                    <option key={acceptedWord.id} value={acceptedWord.id}>
                      {acceptedWord.text}
                    </option>
                  ))}
                </select>
              </article>
            ))
          )}
        </div>

        {feedback && <p className="clean-feedback">{feedback}</p>}
      </section>
    </main>
  );
}
