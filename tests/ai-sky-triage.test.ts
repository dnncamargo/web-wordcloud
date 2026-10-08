import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createTriageSnapshot,
  isMeaningfullyDifferentSpelling,
  isTriageRequestEligible,
  isTriageSnapshotCurrent,
  orderTriageWords,
  readTriageResponse,
} from "../lib/ai/triage-client";
import {
  validateTriageResults,
  type TriageInput,
  type TriageResult,
} from "../lib/ai/triage-contract";
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
    mergeTargetId: null,
  };
}

test("client triage response requires exactly one valid result per pending id", () => {
  const valid = {
    results: [result("pending-1", 0.5), result("pending-2", 0.4), result("pending-3", 0.3)],
  };

  assert.doesNotThrow(() => validateTriageResults(valid, pendingWords, acceptedWords));
  assert.throws(() => validateTriageResults({ results: [result("unknown", 0.5), result("pending-2", 0.4), result("pending-3", 0.3)] }, pendingWords, acceptedWords));
  assert.throws(() => validateTriageResults({ results: [result("pending-1", 0.5), result("pending-1", 0.4), result("pending-3", 0.3)] }, pendingWords, acceptedWords));
  assert.throws(() => validateTriageResults({ results: [result("pending-1", 0.5)] }, pendingWords, acceptedWords));
});

test("client response reader validates the array returned by the route", async () => {
  const response = new Response(JSON.stringify([result("pending-1", 0.5), result("pending-2", 0.4), result("pending-3", 0.3)]));
  const results = await readTriageResponse(response, input);

  assert.equal(results.length, pendingWords.length);
});

test("relevance orders pending ideas stably while display data hides the score", () => {
  const displayItems = orderTriageWords(pendingWords, [
    result("pending-1", 0.7, true),
    result("pending-2", 0.7),
    result("pending-3", 0.2),
  ]);

  assert.deepEqual(displayItems.map((item) => item.word.id), ["pending-1", "pending-2", "pending-3"]);
  assert.equal(displayItems[0].attention, true);
  assert.deepEqual(Object.keys(displayItems[0]).sort(), ["attention", "mergeTargetId", "spellingSuggestion", "word"]);
  assert.doesNotMatch(JSON.stringify(displayItems), /relevance/);
});

test("analysis snapshot invalidates on context changes and remains current otherwise", () => {
  const snapshot = createTriageSnapshot("cloud-1", input.question, acceptedWords, pendingWords);

  assert.equal(isTriageSnapshotCurrent(snapshot, snapshot), true);
  assert.equal(isTriageSnapshotCurrent(snapshot, createTriageSnapshot("cloud-2", input.question, acceptedWords, pendingWords)), false);
  assert.equal(isTriageSnapshotCurrent(snapshot, createTriageSnapshot("cloud-1", "Outra pergunta", acceptedWords, pendingWords)), false);
  assert.equal(isTriageSnapshotCurrent(snapshot, createTriageSnapshot("cloud-1", input.question, acceptedWords, [{ ...pendingWords[0], text: "Escutar" }, ...pendingWords.slice(1)])), false);
});

test("local request eligibility blocks unauthenticated, empty, and oversized sets", () => {
  assert.equal(isTriageRequestEligible({ authenticated: false, cloudId: "cloud-1", input }), false);
  assert.equal(isTriageRequestEligible({ authenticated: true, cloudId: "cloud-1", input: { ...input, pendingWords: [] } }), false);
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
  assert.equal(isMeaningfullyDifferentSpelling("Caza", "Casa"), true);
  assert.equal(isMeaningfullyDifferentSpelling("Casa", " casa "), false);
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
