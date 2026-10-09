import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import {
  evaluateAcceptedMerges,
  evaluateSpelling,
  parseCalibration,
  selectedCalibrations,
  spellingSuggestionMatches,
  structuralRecoveryCounters,
  summarizeAcceptedMerges,
} from "../scripts/evaluate-ai-triage";
import { evaluationScenarios } from "../scripts/ai-triage-fixtures-v3";

const mergeScenario = evaluationScenarios.find(
  (scenario) => scenario.id === "accepted-merges",
);
const spellingScenario = evaluationScenarios.find(
  (scenario) => scenario.id === "spelling",
);
const relevanceScenario = evaluationScenarios.find(
  (scenario) => scenario.id === "relevance",
);

if (!mergeScenario || !spellingScenario || !relevanceScenario) {
  throw new Error("Expected the v3 merge, spelling, and relevance fixtures.");
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

test("calibration selection preserves both as A+B and all as A+B+C", () => {
  assert.equal(parseCalibration("A"), "A");
  assert.equal(parseCalibration("B"), "B");
  assert.equal(parseCalibration("C"), "C");
  assert.equal(parseCalibration("D"), "D");
  assert.equal(parseCalibration("both"), "both");
  assert.equal(parseCalibration("all"), "all");
  assert.deepEqual(selectedCalibrations("both").map(({ id }) => id), ["A", "B"]);
  assert.deepEqual(selectedCalibrations("all").map(({ id }) => id), ["A", "B", "C"]);
  assert.deepEqual(selectedCalibrations("D").map(({ id }) => id), ["D"]);
});

test("structural recovery counters separate clean, recovered, and rejected responses", () => {
  const clean = structuralRecoveryCounters("clean");
  const selfPair = structuralRecoveryCounters("recovered", {
    discardedSelfPairs: 1,
    discardedDuplicatePairs: 0,
  });
  const duplicatePair = structuralRecoveryCounters("recovered", {
    discardedSelfPairs: 0,
    discardedDuplicatePairs: 1,
  });
  const both = structuralRecoveryCounters("recovered", {
    discardedSelfPairs: 1,
    discardedDuplicatePairs: 2,
  });
  const rejected = structuralRecoveryCounters("rejected");

  assert.deepEqual(clean, {
    responsesClean: 1,
    responsesRecovered: 0,
    discardedSelfPairs: 0,
    discardedDuplicatePairs: 0,
    responsesRejected: 0,
  });
  assert.equal(selfPair.responsesClean, 0);
  assert.equal(selfPair.responsesRecovered, 1);
  assert.equal(selfPair.discardedSelfPairs, 1);
  assert.equal(duplicatePair.responsesRecovered, 1);
  assert.equal(duplicatePair.discardedDuplicatePairs, 1);
  assert.equal(both.responsesRecovered, 1);
  assert.equal(both.discardedSelfPairs, 1);
  assert.equal(both.discardedDuplicatePairs, 2);
  assert.deepEqual(rejected, {
    responsesClean: 0,
    responsesRecovered: 0,
    discardedSelfPairs: 0,
    discardedDuplicatePairs: 0,
    responsesRejected: 1,
  });

  const attempted = [clean, both, rejected];
  assert.equal(
    attempted.reduce(
      (total, counters) =>
        total + counters.responsesClean + counters.responsesRecovered + counters.responsesRejected,
      0,
    ),
    3,
  );
  assert.equal(JSON.stringify(both).includes("student"), false);
  assert.equal(JSON.stringify(both).includes("payload"), false);
});

test("fixture v3 uses an unambiguous braille pair and rejects Mais livros overlap", () => {
  assert.deepEqual(
    relevanceScenario.input.acceptedWords.filter((word) => word.id === "rel-c" || word.id === "rel-d"),
    [
      { id: "rel-c", text: "Disponibilizar livros em braile" },
      { id: "rel-d", text: "Oferecer livros em braile aos leitores" },
    ],
  );
  assert.deepEqual(relevanceScenario.expectations.acceptedMerges.forbiddenPairs, [
    ["rel-a", "rel-c"],
    ["rel-a", "rel-d"],
  ]);

  const validMetric = evaluateAcceptedMerges(relevanceScenario, {
    results: [],
    acceptedMergeSuggestions: [{ firstId: "rel-d", secondId: "rel-c" }],
  });
  assert.equal(validMetric.failed, 0);

  const invalidMetric = evaluateAcceptedMerges(relevanceScenario, {
    results: [],
    acceptedMergeSuggestions: [{ firstId: "rel-a", secondId: "rel-c" }],
  });
  assert.ok(invalidMetric.failures.some((failure) => failure.includes("forbidden merge")));
});

test("v3 accepted merge expectations have no accepted/forbidden overlap", () => {
  for (const scenario of evaluationScenarios) {
    const accepted = new Set(
      scenario.expectations.acceptedMerges.allowedPairs.map((pair) => [...pair].sort().join("\u0000")),
    );
    const forbidden = scenario.expectations.acceptedMerges.forbiddenPairs.map((pair) => [...pair].sort().join("\u0000"));
    const required = scenario.expectations.acceptedMerges.requiredPairs.map((pair) => [...pair].sort().join("\u0000"));

    assert.ok(forbidden.every((key) => !accepted.has(key)), `${scenario.id} has accepted/forbidden overlap`);
    assert.ok(required.every((key) => !forbidden.includes(key)), `${scenario.id} has required/forbidden overlap`);
  }
});

test("dry-run reports selected calibrations, maximum calls, and zero actual calls", () => {
  const runDryRun = (selection: string): string => execFileSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      resolve("scripts/evaluate-ai-triage.ts"),
      "--dry-run",
      "--calibration",
      selection,
    ],
    { cwd: resolve("."), encoding: "utf8" },
  );

  const bothOutput = runDryRun("both");
  assert.match(bothOutput, /selected_calibrations=A,B/);
  assert.match(bothOutput, /max_openrouter_calls=8/);
  assert.match(bothOutput, /openrouter_calls=0/);

  const allOutput = runDryRun("all");
  assert.match(allOutput, /selected_calibrations=A,B,C/);
  assert.match(allOutput, /max_openrouter_calls=12/);
  assert.match(allOutput, /openrouter_calls=0/);

  const dOutput = runDryRun("D");
  assert.match(dOutput, /selected_calibrations=D/);
  assert.match(dOutput, /max_openrouter_calls=4/);
  assert.match(dOutput, /openrouter_calls=0/);
});
