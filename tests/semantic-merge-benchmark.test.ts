import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  evaluateSemanticMergePredictions,
  importCalibrationCorpus,
  loadCalibrationExport,
  parseCalibrationExport,
  semanticMergePairIdentity,
  summarizeAnnotationCoverage,
  validateSemanticMergeCase,
  type BenchmarkIdea,
  type SemanticMergeBenchmarkCase,
} from "../scripts/semantic-merge-benchmark";

function idea(kind: BenchmarkIdea["reference"]["kind"], pseudonym: string, text: string): BenchmarkIdea {
  return { reference: { kind, pseudonym }, text };
}

function benchmarkCase(
  caseId: string,
  label: SemanticMergeBenchmarkCase["humanLabel"],
  confidence: SemanticMergeBenchmarkCase["confidence"],
  adjudicationStatus: SemanticMergeBenchmarkCase["adjudicationStatus"],
): SemanticMergeBenchmarkCase {
  const first = idea("accepted_word", `${caseId}-a`, "first synthetic idea");
  const second = idea("accepted_word", `${caseId}-b`, "second synthetic idea");

  return {
    benchmarkVersion: "semantic-merge-v1",
    caseId,
    question: "Synthetic question",
    pair: {
      first,
      second,
      identity: semanticMergePairIdentity(first.reference, second.reference),
    },
    humanLabel: label,
    confidence,
    administrativeDecision: "not_recorded",
    adjudicationStatus,
    source: {
      cloudPseudonym: `${caseId}-cloud`,
      firstRecordPseudonym: first.reference.pseudonym,
      secondRecordPseudonym: second.reference.pseudonym,
      historicalMergeCandidate: false,
    },
  };
}

test("pair identity is unambiguous and independent of order", () => {
  const first = { kind: "accepted_word" as const, pseudonym: "a]\\b" };
  const second = { kind: "submission" as const, pseudonym: "a,b" };

  assert.equal(
    semanticMergePairIdentity(first, second),
    semanticMergePairIdentity(second, first),
  );
  assert.notEqual(
    semanticMergePairIdentity(first, second),
    semanticMergePairIdentity(
      { kind: "accepted_word", pseudonym: "a]" },
      { kind: "submission", pseudonym: "\\b,a,b" },
    ),
  );
  assert.throws(
    () => semanticMergePairIdentity(first, first),
    /cannot contain itself/,
  );
});

test("validates the versioned calibration export and records missing merge targets", () => {
  const exportData = parseCalibrationExport({
    schemaVersion: 1,
    clouds: [
      {
        id: "cloud-1",
        title: "Synthetic title",
        publicTitle: "Synthetic question",
        status: "open",
        acceptedWords: [
          { id: "word-1", text: "First", normalized: "first", count: 1, aliases: [] },
        ],
        submissions: [
          {
            id: "submission-1",
            text: "Historical source",
            normalized: "historical source",
            status: "merged",
            mergedIntoWordId: "missing-word",
          },
        ],
      },
    ],
  });
  const imported = importCalibrationCorpus(exportData, "synthetic-salt");

  assert.deepEqual(imported.summary, {
    cloudCount: 1,
    acceptedWordCount: 1,
    submissionCount: 1,
    historicalMergeCount: 1,
    extractedCandidateCount: 0,
    missingMergeTargetCount: 1,
  });
  assert.equal(imported.originIssues.length, 1);
  assert.equal(imported.cases.length, 0);
  assert.equal("text" in imported.originIssues[0]!, false);
});

test("scores only adjudicated human labels and ignores unannotated predictions", () => {
  const cases = [
    benchmarkCase("equivalent-found", "equivalent", "high", "adjudicated"),
    benchmarkCase("equivalent-missing", "equivalent", "high", "agreed"),
    benchmarkCase("related-predicted", "related_but_distinct", "high", "adjudicated"),
    benchmarkCase("uncertain", "uncertain", "medium", "adjudicated"),
    benchmarkCase("unjudged", null, null, "unadjudicated"),
  ];
  const predicted = [
    cases[0]!.pair.identity,
    cases[0]!.pair.identity,
    cases[2]!.pair.identity,
    cases[3]!.pair.identity,
    cases[4]!.pair.identity,
    "unannotated-pair",
  ];
  const report = evaluateSemanticMergePredictions(cases, predicted);

  assert.equal(report.truePositives, 1);
  assert.equal(report.falsePositives, 1);
  assert.equal(report.falseNegatives, 1);
  assert.equal(report.precision, 0.5);
  assert.equal(report.recall, 0.5);
  assert.equal(report.duplicatePredictions, 1);
  assert.equal(report.ignoredUnannotatedPredictions, 1);
  assert.equal(report.ignoredUncertainPredictions, 1);
  assert.equal(report.ignoredUnjudgedPredictions, 1);
  assert.equal(report.scorableCases, 3);
  assert.equal(report.uncertainCases, 1);
  assert.equal(report.unjudgedCases, 1);
  assert.equal(report.humanLabeledCases, 4);
});

test("rejects a human label without confidence", () => {
  const invalid = benchmarkCase("invalid", "equivalent", null, "adjudicated");

  assert.throws(() => validateSemanticMergeCase(invalid), /provided together/);
});

test("annotation coverage is available without scoring predictions", () => {
  const cases = [
    benchmarkCase("one", "equivalent", "high", "adjudicated"),
    benchmarkCase("two", "uncertain", "medium", "adjudicated"),
    benchmarkCase("three", null, null, "unadjudicated"),
  ];

  assert.deepEqual(summarizeAnnotationCoverage(cases), {
    totalCases: 3,
    humanLabeledCases: 2,
    scorableCases: 1,
    uncertainCases: 1,
    unjudgedCases: 1,
    lowConfidenceCases: 0,
    duplicateCaseIds: 0,
    duplicatePairCases: 0,
  });
});

test("imports the authorized real corpus offline when a path is provided", async (context) => {
  const corpusPath = process.env.SEMANTIC_MERGE_CORPUS_PATH;

  if (!corpusPath) {
    context.skip("SEMANTIC_MERGE_CORPUS_PATH is not set.");
    return;
  }

  const exportData = await loadCalibrationExport(corpusPath);
  const imported = importCalibrationCorpus(exportData, "offline-validation-salt");

  assert.deepEqual(imported.summary, {
    cloudCount: 12,
    acceptedWordCount: 208,
    submissionCount: 384,
    historicalMergeCount: 61,
    extractedCandidateCount: 60,
    missingMergeTargetCount: 1,
  });
  assert.equal(imported.originIssues.length, 1);
  assert.equal(imported.cases.every((item) => item.humanLabel === null), true);
  assert.equal(imported.cases.every((item) => item.adjudicationStatus === "unadjudicated"), true);
  assert.equal(imported.cases.every((item) => item.source.historicalMergeCandidate), true);

  const fileText = await readFile(corpusPath, "utf8");
  assert.ok(fileText.length > 0);
});
