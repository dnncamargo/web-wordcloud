import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateAcceptedMerges,
  evaluateSpelling,
  spellingSuggestionMatches,
  summarizeAcceptedMerges,
} from "../scripts/evaluate-ai-triage";
import { evaluationScenarios } from "../scripts/ai-triage-fixtures-v3";

const mergeScenario = evaluationScenarios.find(
  (scenario) => scenario.id === "accepted-merges",
);
const spellingScenario = evaluationScenarios.find(
  (scenario) => scenario.id === "spelling",
);

if (!mergeScenario || !spellingScenario) {
  throw new Error("Expected the v2 merge and spelling fixtures.");
}

const emptyResults = spellingScenario.input.pendingWords.map((word) => ({
  id: word.id,
  relevance: 0.5,
  attention: false,
  spellingSuggestion: null,
}));

test("evaluator treats accepted merge pairs as unordered and reports duplicate pairs", () => {
  const validMetric = evaluateAcceptedMerges(mergeScenario, {
    results: [],
    acceptedMergeSuggestions: [
      { firstId: "merge-b", secondId: "merge-a" },
    ],
  });

  assert.equal(validMetric.failed, 0);

  const duplicateMetric = evaluateAcceptedMerges(mergeScenario, {
    results: [],
    acceptedMergeSuggestions: [
      { firstId: "merge-a", secondId: "merge-b" },
      { firstId: "merge-b", secondId: "merge-a" },
    ],
  });

  assert.ok(duplicateMetric.failures.some((failure) => failure.includes("duplicate merge pairs")));
});

test("evaluator reports forbidden and unexpected accepted merge pairs", () => {
  const metric = evaluateAcceptedMerges(mergeScenario, {
    results: [],
    acceptedMergeSuggestions: [
      { firstId: "merge-a", secondId: "merge-d" },
      { firstId: "merge-a", secondId: "merge-c" },
    ],
  });

  assert.ok(metric.failures.some((failure) => failure.includes("forbidden merge")));
  assert.ok(metric.failures.some((failure) => failure.includes("unexpected merge")));
});

test("merge summary separates correct, omitted, and false-positive pairs", () => {
  const summary = summarizeAcceptedMerges(mergeScenario, {
    results: [],
    acceptedMergeSuggestions: [
      { firstId: "merge-b", secondId: "merge-a" },
      { firstId: "merge-a", secondId: "merge-c" },
    ],
  });

  assert.deepEqual(summary.correctPairsFound, [["merge-a", "merge-b"]]);
  assert.deepEqual(summary.expectedPairsOmitted, []);
  assert.deepEqual(summary.falsePositives, [["merge-a", "merge-c"]]);
  assert.deepEqual(summary.falseNegatives, []);
});

test("spelling comparison ignores only capitalization and preserves null checks", () => {
  assert.equal(spellingSuggestionMatches("OuVir Os Colegas", "ouvir os colegas"), true);
  assert.equal(spellingSuggestionMatches("ouvir os coleges", "ouvir os colegas"), false);
  assert.equal(spellingSuggestionMatches(null, null), true);
  assert.equal(spellingSuggestionMatches("ouvir os colegas", null), false);

  const metric = evaluateSpelling(spellingScenario, {
    results: emptyResults.map((result) =>
      result.id === "spell-1"
        ? { ...result, spellingSuggestion: "OuVir Os Colegas" }
        : result.id === "spell-2"
          ? { ...result, spellingSuggestion: "Biblioteca" }
          : result,
    ),
    acceptedMergeSuggestions: [],
  });

  assert.equal(metric.failed, 0);
});
