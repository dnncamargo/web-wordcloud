import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createTriageSnapshot,
  isMeaningfullyDifferentSpelling,
  isTriageQuestionDraftCurrent,
  isTriageRequestEligible,
  isTriageSnapshotCurrent,
  orderTriageWords,
  getPendingManualMergeUiState,
  readTriageResponse,
} from "../lib/ai/triage-client";
import {
  validateTriageResults,
  type TriageInput,
  type TriageResult,
} from "../lib/ai/triage-contract";
import {
  findUniqueExactAcceptedWord,
} from "../lib/firebase/autoAggregation";
import {
  prepareApprovedWordReplacement,
  prepareOriginalApprovedWord,
} from "../lib/firebase/wordApproval";

const acceptedWords = [
  { id: "accepted-1", text: "Cuidado" },
  { id: "accepted-2", text: "Respeito" },
];
const pendingWords = [
  { id: "pending-1", text: "Escuta" },
  { id: "pending-2", text: "Ajuda" },
  { id: "pending-3", text: "Apoio" },
];
const input: TriageInput = {
  question: "Como cuidar da turma?",
  acceptedWords,
  pendingWords,
};

function result(id: string, relevance: number, attention = false): TriageResult {
  return {
    id,
    relevance,
    attention,
    spellingSuggestion: null,
  };
}

test("client triage response requires exactly one valid result per pending id", () => {
  const valid = {
    results: [result("pending-1", 0.5), result("pending-2", 0.4), result("pending-3", 0.3)],
    acceptedMergeSuggestions: [],
  };

  assert.doesNotThrow(() => validateTriageResults(valid, pendingWords, acceptedWords));
  assert.throws(() => validateTriageResults({ results: [result("unknown", 0.5), result("pending-2", 0.4), result("pending-3", 0.3)] }, pendingWords, acceptedWords));
  assert.throws(() => validateTriageResults({ results: [result("pending-1", 0.5), result("pending-1", 0.4), result("pending-3", 0.3)] }, pendingWords, acceptedWords));
  assert.throws(() => validateTriageResults({ results: [result("pending-1", 0.5)] }, pendingWords, acceptedWords));
});

test("accepted merge validation is limited to distinct accepted ids and deduplicates reversed pairs", () => {
  const validated = validateTriageResults({
    results: pendingWords.map((word, index) => result(word.id, 0.5 - index / 10)),
    acceptedMergeSuggestions: [
      { firstId: "accepted-1", secondId: "accepted-2" },
      { firstId: "accepted-2", secondId: "accepted-1" },
    ],
  }, pendingWords, acceptedWords);

  assert.deepEqual(validated.acceptedMergeSuggestions, [
    { firstId: "accepted-1", secondId: "accepted-2" },
  ]);
  assert.throws(() => validateTriageResults({
    results: pendingWords.map((word) => result(word.id, 0.5)),
    acceptedMergeSuggestions: [{ firstId: "accepted-1", secondId: "accepted-1" }],
  }, pendingWords, acceptedWords));
  assert.throws(() => validateTriageResults({
    results: pendingWords.map((word) => result(word.id, 0.5)),
    acceptedMergeSuggestions: [{ firstId: "accepted-1", secondId: "pending-1" }],
  }, pendingWords, acceptedWords));
});

test("client response reader validates the object returned by the route", async () => {
  const response = new Response(JSON.stringify({
    results: [result("pending-1", 0.5), result("pending-2", 0.4), result("pending-3", 0.3)],
    acceptedMergeSuggestions: [],
  }));
  const results = await readTriageResponse(response, input);

  assert.equal(results.results.length, pendingWords.length);
});

test("relevance orders pending ideas stably while display data hides the score", () => {
  const displayItems = orderTriageWords(pendingWords, [
    result("pending-1", 0.7, true),
    result("pending-2", 0.7),
    result("pending-3", 0.2),
  ]);

  assert.deepEqual(displayItems.map((item) => item.word.id), ["pending-1", "pending-2", "pending-3"]);
  assert.equal(displayItems[0].attention, true);
  assert.deepEqual(Object.keys(displayItems[0]).sort(), ["attention", "spellingSuggestion", "word"]);
  assert.doesNotMatch(JSON.stringify(displayItems), /relevance/);
});

test("without current analysis, pending ideas keep the permanent manual merge selector", () => {
  assert.deepEqual(
    getPendingManualMergeUiState({
      hasCurrentAnalysis: false,
      pendingWordId: "pending-1",
      expandedPendingWordId: null,
      acceptedWordCount: acceptedWords.length,
    }),
    {
      mode: "permanent",
      canMerge: true,
      isExpanded: false,
      showSelector: true,
      showCompactAction: false,
      compactActionDisabled: false,
    },
  );
});

test("current analysis collapses manual merge and keeps a compact action", () => {
  assert.deepEqual(
    getPendingManualMergeUiState({
      hasCurrentAnalysis: true,
      pendingWordId: "pending-1",
      expandedPendingWordId: null,
      acceptedWordCount: acceptedWords.length,
    }),
    {
      mode: "compact",
      canMerge: true,
      isExpanded: false,
      showSelector: false,
      showCompactAction: true,
      compactActionDisabled: false,
    },
  );
});

test("opening manual merge expands only the selected pending idea and cancel is ephemeral", () => {
  const opened = getPendingManualMergeUiState({
    hasCurrentAnalysis: true,
    pendingWordId: "pending-1",
    expandedPendingWordId: "pending-1",
    acceptedWordCount: acceptedWords.length,
  });
  const sibling = getPendingManualMergeUiState({
    hasCurrentAnalysis: true,
    pendingWordId: "pending-2",
    expandedPendingWordId: "pending-1",
    acceptedWordCount: acceptedWords.length,
  });
  const cancelled = getPendingManualMergeUiState({
    hasCurrentAnalysis: true,
    pendingWordId: "pending-1",
    expandedPendingWordId: null,
    acceptedWordCount: acceptedWords.length,
  });

  assert.equal(opened.showSelector, true);
  assert.equal(sibling.showSelector, false);
  assert.equal(cancelled.showSelector, false);
});

test("manual merge availability is identical for attention and non-attention items", () => {
  const states = [false, true].map((attention) => {
    const [item] = orderTriageWords(
      [pendingWords[0]],
      [result("pending-1", 0.5, attention)],
    );

    assert.equal(item.attention, attention);

    return getPendingManualMergeUiState({
      hasCurrentAnalysis: true,
      pendingWordId: item.word.id,
      expandedPendingWordId: null,
      acceptedWordCount: acceptedWords.length,
    });
  });

  assert.deepEqual(states[0], states[1]);
  assert.equal(states[0].showCompactAction, true);
});

test("stale analysis restores the permanent selector even if an old item was expanded", () => {
  assert.deepEqual(
    getPendingManualMergeUiState({
      hasCurrentAnalysis: false,
      pendingWordId: "pending-1",
      expandedPendingWordId: "pending-1",
      acceptedWordCount: acceptedWords.length,
    }),
    {
      mode: "permanent",
      canMerge: true,
      isExpanded: false,
      showSelector: true,
      showCompactAction: false,
      compactActionDisabled: false,
    },
  );
});

test("without accepted words, manual merge has no target selector and compact action is disabled", () => {
  const normalState = getPendingManualMergeUiState({
    hasCurrentAnalysis: false,
    pendingWordId: "pending-1",
    expandedPendingWordId: null,
    acceptedWordCount: 0,
  });
  const analyzedState = getPendingManualMergeUiState({
    hasCurrentAnalysis: true,
    pendingWordId: "pending-1",
    expandedPendingWordId: "pending-1",
    acceptedWordCount: 0,
  });

  assert.equal(normalState.showSelector, false);
  assert.equal(analyzedState.showSelector, false);
  assert.equal(analyzedState.showCompactAction, true);
  assert.equal(analyzedState.compactActionDisabled, true);
});

test("analysis snapshot invalidates on context changes and remains current otherwise", () => {
  const snapshot = createTriageSnapshot("cloud-1", input.question, acceptedWords, pendingWords);

  assert.equal(isTriageSnapshotCurrent(snapshot, snapshot), true);
  assert.equal(isTriageSnapshotCurrent(snapshot, createTriageSnapshot("cloud-2", input.question, acceptedWords, pendingWords)), false);
  assert.equal(isTriageSnapshotCurrent(snapshot, createTriageSnapshot("cloud-1", "Outra pergunta", acceptedWords, pendingWords)), false);
  assert.equal(isTriageSnapshotCurrent(snapshot, createTriageSnapshot("cloud-1", input.question, acceptedWords, [{ ...pendingWords[0], text: "Escutar" }, ...pendingWords.slice(1)])), false);
});

test("exact normalized aggregation selects only one canonical accepted word", () => {
  assert.deepEqual(
    findUniqueExactAcceptedWord("  Árvore  ", [
      { id: "word-1", text: "árvore" },
      { id: "word-2", text: "casa" },
    ]),
    { id: "word-1", text: "árvore" },
  );
  assert.equal(
    findUniqueExactAcceptedWord("arvore", [
      { id: "word-1", text: "árvore" },
      { id: "word-2", text: "ARVORE" },
    ]),
    null,
  );
});

test("analysis requires the visible question draft to be saved first", () => {
  assert.equal(isTriageQuestionDraftCurrent("Como cuidar?", "Como cuidar?"), true);
  assert.equal(isTriageQuestionDraftCurrent("Como cuidar?", "Como cuidar melhor?"), false);
});

test("local request eligibility allows accepted-only analysis but blocks no work", () => {
  assert.equal(isTriageRequestEligible({ authenticated: false, cloudId: "cloud-1", input }), false);
  assert.equal(isTriageRequestEligible({ authenticated: true, cloudId: "cloud-1", input: { ...input, acceptedWords: acceptedWords.slice(0, 1), pendingWords: [] } }), false);
  assert.equal(isTriageRequestEligible({ authenticated: true, cloudId: "cloud-1", input: { ...input, pendingWords: [] } }), true);
  assert.equal(isTriageRequestEligible({ authenticated: true, cloudId: "cloud-1", input: { ...input, pendingWords: Array.from({ length: 41 }, (_, index) => ({ id: `pending-${index}`, text: "Ideia" })) } }), false);
  assert.equal(isTriageRequestEligible({
    authenticated: true,
    cloudId: "cloud-1",
    input: {
      question: "Pergunta",
      acceptedWords: Array.from({ length: 100 }, (_, index) => ({ id: `accepted-${index}`, text: "x".repeat(256) })),
      pendingWords: Array.from({ length: 20 }, (_, index) => ({ id: `pending-${index}`, text: "y".repeat(256) })),
    },
  }), false);
  assert.equal(isTriageRequestEligible({ authenticated: true, cloudId: "cloud-1", input }), true);
});

test("spelling suggestions must be meaningfully different and replacement approval preserves source text", () => {
  assert.equal(isMeaningfullyDifferentSpelling("arvore", "árvore"), true);
  assert.equal(isMeaningfullyDifferentSpelling("voce", "você"), true);
  assert.equal(isMeaningfullyDifferentSpelling("Casa", " casa "), false);
  assert.equal(isMeaningfullyDifferentSpelling("Casa", "Casa"), false);
  assert.deepEqual(prepareApprovedWordReplacement("  Caza  ", " Casa ", false), {
    sourceText: "Caza",
    text: "Casa",
    normalized: "casa",
    action: "create",
  });
  assert.equal(prepareApprovedWordReplacement("Caza", "!!!", false), null);
  assert.equal(prepareApprovedWordReplacement("Caza", "Casa", true)?.action, "increment");
  assert.deepEqual(prepareOriginalApprovedWord(" Caza ", "Casa"), {
    text: "Caza",
    normalized: "caza",
  });
});
