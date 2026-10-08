"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  activateCloud,
  autoAggregateEquivalentNewWord,
  approveNewWord,
  approveNewWordAs,
  archiveCloud,
  createCloud,
  deleteWord,
  FirebaseCloud,
  FirebaseNewWord,
  FirebaseWord,
  chooseCanonicalWordForm,
  listenClouds,
  listenGlobalSettings,
  listenNewWords,
  listenWords,
  mergeAcceptedWords,
  mergeNewWordIntoWord,
  rejectNewWord,
  unarchiveCloud,
  updateCloudText,
  updateWordText,
  blowWind,
} from "@/lib/firebase/cloudService";
import { getCanonicalWordCandidates } from "@/lib/firebase/canonicalWord";
import {
  getAcceptedMergeCanonicalCandidates,
  getAcceptedMergePairKey,
} from "@/lib/firebase/acceptedWordMerge";
import { findUniqueExactAcceptedWord } from "@/lib/firebase/autoAggregation";
import {
  clearPendingSpelling,
  getPendingApprovalPlan,
  getPendingMergePlan,
  selectPendingSpelling,
  type PendingSpellingSelections,
} from "@/lib/reviewDecisions";
import AiAdminControl from "@/components/AiAdminControl";
import type { AiSessionState } from "@/lib/ai/admin-session-contract";
import {
  createTriageSnapshot,
  isMeaningfullyDifferentSpelling,
  isTriageQuestionDraftCurrent,
  isTriageRequestEligible,
  isTriageSnapshotCurrent,
  orderTriageWords,
  readTriageResponse,
  type TriageDisplayItem,
  type TriageSnapshot,
} from "@/lib/ai/triage-client";
import type {
  AcceptedMergeSuggestion,
  TriageInput,
} from "@/lib/ai/triage-contract";
import { Archive, ArchiveRestore, Plus, Sparkles, Wind, X } from "lucide-react";

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
  const [showArchivedClouds, setShowArchivedClouds] = useState(false);
  const [aiSession, setAiSession] = useState<AiSessionState | null>(null);
  const [aiSessionInvalidationToken, setAiSessionInvalidationToken] = useState(0);
  const [analysisSnapshot, setAnalysisSnapshot] = useState<TriageSnapshot | null>(null);
  const [analysisItems, setAnalysisItems] = useState<TriageDisplayItem<FirebaseNewWord>[] | null>(null);
  const [analysisState, setAnalysisState] = useState<"idle" | "loading">("idle");
  const [analysisError, setAnalysisError] = useState("");
  const [analysisRevision, setAnalysisRevision] = useState(0);
  const [analysisResultRevision, setAnalysisResultRevision] = useState<number | null>(null);
  const [acceptedMergeSuggestions, setAcceptedMergeSuggestions] = useState<AcceptedMergeSuggestion[]>([]);
  const [acceptedMergeCanonicalSelections, setAcceptedMergeCanonicalSelections] = useState<Record<string, string>>({});
  const [selectedSpellings, setSelectedSpellings] = useState<PendingSpellingSelections>({});
  const analysisInFlightRef = useRef(false);
  const analysisRevisionRef = useRef(0);
  const autoAggregationStateRef = useRef(new Map<string, "processing" | "completed">());

  const selectedCloud = clouds.find((cloud) => cloud.id === selectedCloudId) ?? null;
  const visibleClouds = clouds.filter((cloud) => (showArchivedClouds ? cloud.status === "archived" : cloud.status !== "archived"));
  const currentTriageSnapshot = useMemo(
    () =>
      createTriageSnapshot(
        selectedCloudId,
        selectedCloud?.publicTitle ?? "",
        words,
        newWords,
      ),
    [newWords, selectedCloud?.publicTitle, selectedCloudId, words],
  );
  const latestTriageSnapshotRef = useRef(currentTriageSnapshot);

  const currentAnalysisItems =
    analysisResultRevision === analysisRevision &&
    isTriageQuestionDraftCurrent(selectedCloud?.publicTitle ?? "", questionDraft) &&
    analysisSnapshot &&
    analysisItems &&
    isTriageSnapshotCurrent(analysisSnapshot, currentTriageSnapshot)
      ? analysisItems
      : null;
  const currentAcceptedMergeSuggestions = useMemo(
    () =>
      currentAnalysisItems && analysisSnapshot && isTriageSnapshotCurrent(analysisSnapshot, currentTriageSnapshot)
        ? acceptedMergeSuggestions
        : [],
    [acceptedMergeSuggestions, analysisSnapshot, currentAnalysisItems, currentTriageSnapshot],
  );
  const displayPendingItems =
    currentAnalysisItems ??
    newWords.map((word) => ({
      word,
      attention: false,
      spellingSuggestion: null,
    }));

  useEffect(() => {
    latestTriageSnapshotRef.current = currentTriageSnapshot;
  }, [currentTriageSnapshot]);

  const invalidateAnalysis = useCallback(() => {
    analysisRevisionRef.current += 1;
    setAnalysisRevision((current) => current + 1);
    setAnalysisResultRevision(null);
    setAnalysisSnapshot(null);
    setAnalysisItems(null);
    setAcceptedMergeSuggestions([]);
    setAcceptedMergeCanonicalSelections({});
    setAnalysisError("");
    setSelectedSpellings({});
  }, []);

  useEffect(() => {
    const unsubscribeClouds = listenClouds((nextClouds) => {
      invalidateAnalysis();
      setClouds(nextClouds);
    });
    const unsubscribeSettings = listenGlobalSettings((cloudId) => {
      invalidateAnalysis();
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
  }, [invalidateAnalysis]);

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

    const unsubscribeWords = listenWords(selectedCloudId, (nextWords) => {
      invalidateAnalysis();
      setWords(nextWords);
    });
    const unsubscribeNewWords = listenNewWords(selectedCloudId, (nextNewWords) => {
      invalidateAnalysis();
      setNewWords(nextNewWords);
    });

    return () => {
      unsubscribeWords();
      unsubscribeNewWords();
    };
  }, [invalidateAnalysis, selectedCloudId]);

  useEffect(() => {
    if (!selectedCloudId) return;

    const pendingWordIds = new Set(newWords.map((word) => word.id));

    for (const key of autoAggregationStateRef.current.keys()) {
      const [cloudId, newWordId] = key.split("::");

      if (cloudId === selectedCloudId && !pendingWordIds.has(newWordId)) {
        autoAggregationStateRef.current.delete(key);
      }
    }

    if (words.length === 0 || newWords.length === 0) return;

    for (const newWord of newWords) {
      const targetWord = findUniqueExactAcceptedWord(newWord.text, words);

      if (!targetWord) continue;

      const key = `${selectedCloudId}::${newWord.id}`;

      if (autoAggregationStateRef.current.has(key)) continue;

      autoAggregationStateRef.current.set(key, "processing");

      void autoAggregateEquivalentNewWord(selectedCloudId, newWord.id, targetWord.id)
        .then((didAggregate) => {
          if (didAggregate) {
            autoAggregationStateRef.current.set(key, "completed");
          } else {
            autoAggregationStateRef.current.delete(key);
          }
        })
        .catch((error) => {
          autoAggregationStateRef.current.delete(key);
          console.error("Não foi possível autoagregar a nova ideia.", error);
        });
    }
  }, [newWords, selectedCloudId, words]);

  useEffect(() => {
    setTitleDraft(selectedCloud?.title ?? "");
    setQuestionDraft(selectedCloud?.publicTitle ?? "");
  }, [selectedCloud?.id, selectedCloud?.title, selectedCloud?.publicTitle]);

  async function handleCreateCloud() {
    const id = await createCloud();

    invalidateAnalysis();
    setSelectedCloudId(id);
    setFeedback("Rascunho criado. Edite e ative quando estiver pronto.");
  }

  async function handleActivateCloud(cloudId: string) {
    await activateCloud(cloudId);

    invalidateAnalysis();
    setSelectedCloudId(cloudId);
    setFeedback("Nuvem em precipitação.");
  }

  async function handleArchiveCloud(cloudId: string) {
    await archiveCloud(cloudId);

    invalidateAnalysis();
    setSelectedCloudId(cloudId);
    setFeedback("Nuvem arquivada.");
  }

  async function handleUnarchiveCloud(cloudId: string) {
    await unarchiveCloud(cloudId);

    invalidateAnalysis();
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

  async function handleAiAnalysis() {
    if (analysisInFlightRef.current) return;

    if (selectedCloud && questionDraft !== selectedCloud.publicTitle) {
      setAnalysisError("Finalize e salve a pergunta antes de analisar.");
      return;
    }

    const input: TriageInput | null = selectedCloud
      ? {
          question: selectedCloud.publicTitle,
          acceptedWords: words.map(({ id, text }) => ({ id, text })),
          pendingWords: newWords.map(({ id, text }) => ({ id, text })),
        }
      : null;

    if (!input || !isTriageRequestEligible({
      authenticated: aiSession?.authenticated === true,
      cloudId: selectedCloudId,
      input,
    })) {
      if (!aiSession?.authenticated) {
        setAnalysisError("Ative a IA pelo controle no cabeçalho para solicitar uma análise.");
      } else if (!selectedCloudId) {
        setAnalysisError("Selecione uma nuvem antes de analisar.");
      } else if (newWords.length === 0 && words.length < 2) {
        setAnalysisError("Não há ideias pendentes nem palavras aceitas suficientes para analisar.");
      } else {
        setAnalysisError("O conjunto atual não pode ser analisado como uma única solicitação.");
      }
      return;
    }

    const requestedSnapshot = createTriageSnapshot(
      selectedCloudId,
      input.question,
      words,
      newWords,
    );
    const requestedRevision = analysisRevisionRef.current;

    analysisInFlightRef.current = true;
    setAnalysisState("loading");
    setAnalysisError("");

    try {
      const response = await fetch("/api/ai/triage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(input),
      });

      if (response.status === 401) {
        setAiSession(null);
        setAiSessionInvalidationToken((current) => current + 1);
        invalidateAnalysis();
        setAnalysisError("A sessão da IA expirou. Reative-a pelo controle no cabeçalho.");
        return;
      }

      if (response.status === 429) {
        setAnalysisError("O limite de uso da IA foi atingido.");
        return;
      }

      if (response.status === 503) {
        setAnalysisError("A IA está temporariamente indisponível.");
        return;
      }

      if (response.status === 400 || response.status === 413) {
        setAnalysisError("O conjunto atual não pode ser analisado como uma única solicitação.");
        return;
      }

      if (!response.ok) {
        setAnalysisError("Não foi possível concluir a análise.");
        return;
      }

      const analysisResponse = await readTriageResponse(response, input);
      const currentSnapshotAfterRequest = latestTriageSnapshotRef.current;

      if (
        requestedRevision !== analysisRevisionRef.current ||
        !isTriageSnapshotCurrent(requestedSnapshot, currentSnapshotAfterRequest)
      ) return;

      setAnalysisSnapshot(requestedSnapshot);
      setAnalysisItems(orderTriageWords(newWords, analysisResponse.results));
      setAcceptedMergeSuggestions([...analysisResponse.acceptedMergeSuggestions]);
      setAnalysisResultRevision(requestedRevision);
    } catch {
      setAnalysisError("Não foi possível concluir a análise.");
    } finally {
      analysisInFlightRef.current = false;
      setAnalysisState("idle");
    }
  }

  async function handleMerge(newWord: FirebaseNewWord, targetWordId: string) {
    const plan = getPendingMergePlan(targetWordId);

    if (!selectedCloudId || !plan) return;

    const targetWord = words.find((word) => word.id === plan.targetWordId);

    if (!targetWord) return;

    const didMerge = await mergeNewWordIntoWord(selectedCloudId, newWord, targetWord);

    if (didMerge) {
      setFeedback(`"${newWord.text}" foi mesclada com "${targetWord.text}".`);
    }
  }

  async function handleChooseCanonicalWordForm(word: FirebaseWord, candidate: string) {
    if (!selectedCloudId || candidate === word.text) return;

    const didChange = await chooseCanonicalWordForm(selectedCloudId, word.id, candidate);

    if (didChange) setFeedback(`Forma canônica alterada para "${candidate}".`);
  }

  async function handleMergeAcceptedWords(
    firstWord: FirebaseWord,
    secondWord: FirebaseWord,
    pairKey: string,
  ) {
    if (!selectedCloudId) return;

    const canonicalText = acceptedMergeCanonicalSelections[pairKey];

    if (!canonicalText) return;

    const didMerge = await mergeAcceptedWords(
      selectedCloudId,
      firstWord.id,
      secondWord.id,
      canonicalText,
    );

    if (didMerge) {
      setAcceptedMergeCanonicalSelections((current) => {
        const next = { ...current };
        delete next[pairKey];
        return next;
      });
      setFeedback(`Ideias mescladas com forma canônica "${canonicalText}".`);
    }
  }

  async function handleUpdateAcceptedWord(word: FirebaseWord, value: string) {
    if (!selectedCloudId) return;

    const cleanValue = value.trim();

    if (!cleanValue || cleanValue === word.text) return;

    await updateWordText(selectedCloudId, word, cleanValue);
    setFeedback("Palavra atualizada.");
  }

  function handleSelectSpelling(word: FirebaseNewWord, spelling: string) {
    setSelectedSpellings((current) => selectPendingSpelling(current, word.id, word.text, spelling));
  }

  function handleClearSpelling(wordId: string) {
    setSelectedSpellings((current) => clearPendingSpelling(current, wordId));
  }

  async function handleApprovePendingWord(word: FirebaseNewWord) {
    if (!selectedCloudId) return;

    const plan = getPendingApprovalPlan(word.text, selectedSpellings[word.id]);
    let didApprove = true;

    if (plan.operation === "approveNewWordAs") {
      didApprove = await approveNewWordAs(selectedCloudId, word.id, plan.text);
    } else {
      await approveNewWord(selectedCloudId, word.id, plan.text);
    }

    if (didApprove) {
      setSelectedSpellings((current) => clearPendingSpelling(current, word.id));
      setFeedback(
        plan.operation === "approveNewWordAs"
          ? `"${plan.text.trim()}" foi aceita com a grafia escolhida.`
          : `"${plan.text.trim()}" foi aceita.`,
      );
    }
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

  const visibleAcceptedMergeSuggestions = useMemo(() => {
    const seenPairs = new Set<string>();

    return currentAcceptedMergeSuggestions.flatMap((suggestion) => {
      const firstWord = words.find((word) => word.id === suggestion.firstId);
      const secondWord = words.find((word) => word.id === suggestion.secondId);

      if (!firstWord || !secondWord || firstWord.id === secondWord.id) return [];

      const pairKey = getAcceptedMergePairKey(firstWord.id, secondWord.id);

      if (seenPairs.has(pairKey)) return [];

      seenPairs.add(pairKey);
      return [{ suggestion, firstWord, secondWord, pairKey }];
    });
  }, [currentAcceptedMergeSuggestions, words]);

  return (
    <main className="sky-clean">
      {/* Gerenciamento de Nuvens */}
      <aside className="sky-clean-column sky-clouds-column">
        <header className="sky-clean-header">
          <h1>Gerenciamento do Céu</h1>

          <div className="sky-clean-header-actions">
            <AiAdminControl
              onSessionChange={setAiSession}
              sessionInvalidationToken={aiSessionInvalidationToken}
            />

            <button
              className={`button icon-button ${showArchivedClouds ? "active" : ""}`}
              onClick={() => {
                setShowArchivedClouds((currentValue) => !currentValue);
                invalidateAnalysis();
                setSelectedCloudId(null);
              }}
              title={showArchivedClouds ? "Ver nuvens ativas e fechadas" : "Ver arquivo"}
              aria-label={showArchivedClouds ? "Ver nuvens ativas e fechadas" : "Ver arquivo"}
            >
              <Archive size={15} strokeWidth={2.2} />
            </button>

            <button className="highlight-button icon-button" onClick={handleCreateCloud} title="Adicionar nuvem" aria-label="Adicionar nuvem">
              <Plus size={16} strokeWidth={2.5} />
            </button>
          </div>
        </header>

        <section className="column-scroll-body clean-list">
          {visibleClouds.length === 0 ? (
            <p className="clean-empty">{showArchivedClouds ? "Nenhuma nuvem arquivada." : "Nenhuma nuvem ativa ou fechada."}</p>
          ) : (
            visibleClouds.map((cloud) => {
              const isActive = cloud.id === activeCloudId;
              const isSelected = cloud.id === selectedCloudId;
              const isArchived = cloud.status === "archived";

              return (
                <article key={cloud.id} className={["clean-cloud-item", isSelected ? "selected" : "", isActive ? "active" : "", isArchived ? "archived" : ""].join(" ")}>
                  <button className="cloud-name-button" onClick={() => {
                    invalidateAnalysis();
                    setSelectedCloudId(cloud.id);
                  }}>
                    <strong>{cloud.title || "Sem título"}</strong>

                    <small>{isActive ? "em precipitação" : getStatusLabel(cloud.status)}</small>
                  </button>

                  <div className="cloud-row-actions">
                    {!isActive && !isArchived && (
                      <button className="button" onClick={() => handleActivateCloud(cloud.id)} title="Precipitar" aria-label="Precipitar">
                        Precipitar
                      </button>
                    )}

                    {isActive && (
                      <>
                        <button className="button" onClick={() => handleArchiveCloud(cloud.id)} title="Arquivar" aria-label="Arquivar">
                          Arquivar
                        </button>

                        <button
                          className="button icon-button"
                          onClick={async () => {
                            await blowWind();
                            setFeedback("O vento reorganizou a chuva.");
                          }}
                          title="Ventar"
                          aria-label="Ventar"
                        >
                          <Wind size={14} strokeWidth={2.2} />
                        </button>
                      </>
                    )}

                    {isArchived && (
                      <button className="button icon-button" onClick={() => handleUnarchiveCloud(cloud.id)} title="Desarquivar" aria-label="Desarquivar">
                        <ArchiveRestore size={17} strokeWidth={2.2} />
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
                onChange={(event) => {
                  invalidateAnalysis();
                  setQuestionDraft(event.target.value);
                }}
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

              {visibleAcceptedMergeSuggestions.length > 0 && (
                <div className="accepted-merge-suggestions">
                  {visibleAcceptedMergeSuggestions.map(({ firstWord, secondWord, pairKey }) => {
                    const candidates = getAcceptedMergeCanonicalCandidates(firstWord, secondWord);
                    const selectedCanonical = acceptedMergeCanonicalSelections[pairKey] ?? "";

                    return (
                      <article key={pairKey} className="ai-suggestion-row accepted-merge-suggestion">
                        <span>
                          IA sugere mesclar: <strong>{firstWord.text}</strong> ↔ <strong>{secondWord.text}</strong>
                        </span>

                        <select
                          aria-label={`Escolher forma canônica para mesclar ${firstWord.text} e ${secondWord.text}`}
                          value={selectedCanonical}
                          onChange={(event) => {
                            const candidate = event.target.value;
                            setAcceptedMergeCanonicalSelections((current) => ({
                              ...current,
                              [pairKey]: candidate,
                            }));
                          }}
                        >
                          <option value="" disabled>Escolher forma canônica...</option>
                          {candidates.map((candidate) => (
                            <option key={candidate} value={candidate}>{candidate}</option>
                          ))}
                        </select>

                        <button
                          className="button"
                          disabled={!selectedCanonical}
                          onClick={() => handleMergeAcceptedWords(firstWord, secondWord, pairKey)}
                          type="button"
                        >
                          Mesclar
                        </button>
                      </article>
                    );
                  })}
                </div>
              )}

              <div className="column-scroll-body accepted-clean-list">
                {words.length === 0 ? (
                  <p className="clean-empty">Nenhuma palavra aceita ainda.</p>
                ) : (
                  words.map((word) => (
                    <article key={word.id} className="accepted-clean-word">
                      <input key={`${word.id}:${word.text}`} defaultValue={word.text} onBlur={(event) => handleUpdateAcceptedWord(word, event.target.value)} />

                      {(word.aliases?.length ?? 0) > 0 && (
                        <select
                          aria-label={`Escolher forma canônica de ${word.text}`}
                          className="canonical-form-select"
                          onChange={(event) => handleChooseCanonicalWordForm(word, event.target.value)}
                          value={word.text}
                        >
                          {getCanonicalWordCandidates(word.text, word.aliases).map((candidate) => (
                            <option key={candidate} value={candidate}>
                              {candidate}
                            </option>
                          ))}
                        </select>
                      )}

                      <span className={`merge-count ${(word.aliases?.length ?? 0) === 0 ? "empty" : ""}`} title={word.aliases?.join(", ")}>
                        (+{word.aliases?.length ?? 0})
                      </span>
                      <span className="word-count">{word.count}</span>

                      <button className="button icon-button remove-word-button" aria-label={`Remover ${word.text}`} title="Remover" onClick={() => deleteWord(selectedCloud.id, word.id)}>
                        <X size={15} strokeWidth={2.4} />
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
          <div className="new-ideas-title">
            <h2>Novas ideias</h2>
            <span>{newWords.length}</span>
          </div>

          <button
            className="button ai-triage-action"
            onClick={handleAiAnalysis}
            disabled={analysisState === "loading" || !selectedCloudId || (newWords.length === 0 && words.length < 2)}
            type="button"
            title="Analisar ideias com IA"
          >
            <Sparkles size={14} strokeWidth={2.2} />
            {analysisState === "loading" ? "Analisando..." : "Analisar"}
          </button>
        </div>

        {analysisError && <p className="ai-triage-error" role="alert">{analysisError}</p>}

        <div className="column-scroll-body new-clean-list">
          {!selectedCloudId ? (
            <p className="clean-empty">Selecione uma nuvem.</p>
          ) : newWords.length === 0 ? (
            <p className="clean-empty">Nenhuma ideia pendente.</p>
          ) : (
            displayPendingItems.map(({ word, attention, spellingSuggestion }) => {
              const hasSpellingSuggestion = isMeaningfullyDifferentSpelling(word.text, spellingSuggestion);
              const selectedSpelling = selectedSpellings[word.id];

              return (
              <article key={word.id} className={`new-clean-word ${attention ? "ai-needs-attention" : ""}`}>
                <strong>{word.text}</strong>

                {attention && <span className="ai-attention-note">Revisar com atenção</span>}

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

                {hasSpellingSuggestion && (
                  <div className="ai-suggestion-row">
                    <span>IA sugere ortografia: <strong>{spellingSuggestion}</strong></span>
                    <button className="button" onClick={() => handleSelectSpelling(word, spellingSuggestion ?? "")} type="button">
                      {selectedSpelling === spellingSuggestion ? "Selecionada" : "Usar sugestão"}
                    </button>
                  </div>
                )}

                {selectedSpelling && (
                  <div className="selected-spelling-row">
                    <span>Grafia selecionada: <strong>{selectedSpelling}</strong></span>
                    <button className="button" onClick={() => handleClearSpelling(word.id)} type="button">
                      Cancelar
                    </button>
                  </div>
                )}

                <div className="clean-action-row">
                  <button className="button" onClick={() => handleApprovePendingWord(word)} type="button">
                    {selectedSpelling ? `Aceitar como "${selectedSpelling}"` : "Aceitar"}
                  </button>

                  <button className="button" onClick={() => rejectNewWord(selectedCloudId, word.id)} type="button">
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
              );
            })
          )}
        </div>

        {feedback && <p className="clean-feedback">{feedback}</p>}
      </section>
    </main>
  );
}
