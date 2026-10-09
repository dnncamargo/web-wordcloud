import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTHORIZED_CALIBRATION_CLOUD_COUNT,
  consolidateAnnotationRecords,
  evaluateSemanticMergePredictions,
  importCalibrationCorpus,
  loadCalibrationExport,
  parseCalibrationExport,
  selectSemanticMergeAnnotationQueue,
  semanticMergePairIdentity,
  summarizeAnnotationCoverage,
  validateHistoricalModerationCase,
  validateSemanticMergeCase,
  type AcceptedMergeBenchmarkCase,
  type BenchmarkIdea,
  type SemanticAnnotationRecord,
} from "../scripts/semantic-merge-benchmark";

function idea(
  kind: BenchmarkIdea["reference"]["kind"],
  pseudonym: string,
  text: string,
): BenchmarkIdea {
  return { reference: { kind, pseudonym }, text };
}

function benchmarkCase(
  caseId: string,
  label: AcceptedMergeBenchmarkCase["humanLabel"],
  confidence: AcceptedMergeBenchmarkCase["confidence"],
  adjudicationStatus: AcceptedMergeBenchmarkCase["adjudicationStatus"],
  cloudPseudonym = `${caseId}-cloud`,
  firstText = "first synthetic idea",
  secondText = "second synthetic idea",
): AcceptedMergeBenchmarkCase {
  const first = idea("accepted_word", `${caseId}-a`, firstText);
  const second = idea("accepted_word", `${caseId}-b`, secondText);

  return {
    benchmarkVersion: "semantic-merge-v1",
    dataset: "accepted_merge_benchmark",
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
      cloudPseudonym,
      firstRecordPseudonym: first.reference.pseudonym,
      secondRecordPseudonym: second.reference.pseudonym,
      historicalMergeCandidate: false,
    },
  };
}

function syntheticCloud(id: string, includeHistory = false) {
  return {
    id,
    title: `Title ${id}`,
    publicTitle: `Question ${id}`,
    status: "open" as const,
    acceptedWords: [
      { id: `${id}-a`, text: "First", normalized: "first", count: 1, aliases: [] },
      { id: `${id}-b`, text: "Second", normalized: "second", count: 1, aliases: [] },
    ],
    submissions: includeHistory
      ? [
          {
            id: `${id}-submission`,
            text: "Historical source",
            normalized: "historical source",
            status: "merged" as const,
            mergedIntoWordId: `${id}-a`,
          },
        ]
      : [],
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
  assert.throws(() => semanticMergePairIdentity(first, first), /cannot contain itself/);
});

test("separates historical moderation from accepted-word benchmark cases", () => {
  const exportData = parseCalibrationExport({
    schemaVersion: 1,
    clouds: [syntheticCloud("cloud-1", true), syntheticCloud("cloud-2")],
  });
  const imported = importCalibrationCorpus(exportData, "synthetic-salt", {
    enforceAuthorizedScope: false,
  });

  assert.equal(imported.historicalModerationCases.length, 1);
  assert.equal(imported.acceptedMergeBenchmarkCases.length, 2);
  assert.equal(imported.historicalModerationCases[0]!.administrativeDecision, "merge");
  assert.equal(imported.historicalModerationCases[0]!.humanLabel, null);
  assert.equal(imported.acceptedMergeBenchmarkCases[0]!.source.historicalMergeCandidate, false);
  assert.equal(
    imported.acceptedMergeBenchmarkCases.every(
      (item) =>
        item.pair.first.reference.kind === "accepted_word" &&
        item.pair.second.reference.kind === "accepted_word",
    ),
    true,
  );
  assert.equal(
    imported.acceptedMergeBenchmarkCases.some(
      (item) => item.source.cloudPseudonym !== imported.acceptedMergeBenchmarkCases[0]!.source.cloudPseudonym,
    ),
    true,
  );
  validateHistoricalModerationCase(imported.historicalModerationCases[0]!);
});

test("accepted merge scoring rejects historical submission pairs", () => {
  const exportData = parseCalibrationExport({
    schemaVersion: 1,
    clouds: [syntheticCloud("cloud-1", true)],
  });
  const imported = importCalibrationCorpus(exportData, "synthetic-salt", {
    enforceAuthorizedScope: false,
  });
  const historical = imported.historicalModerationCases[0]!;

  assert.throws(
    () =>
      evaluateSemanticMergePredictions(
        [historical as unknown as AcceptedMergeBenchmarkCase],
        [],
      ),
    /accepted_word references/,
  );
});

test("scores adjudicated labels with micro and macro metrics", () => {
  const first = benchmarkCase("equivalent-found", "equivalent", "high", "adjudicated", "cloud-a");
  const missing = benchmarkCase("equivalent-missing", "equivalent", "high", "agreed", "cloud-a");
  const related = benchmarkCase("related-predicted", "related_but_distinct", "high", "adjudicated", "cloud-b");
  const uncertain = benchmarkCase("uncertain", "uncertain", "medium", "adjudicated", "cloud-b");
  const unjudged = benchmarkCase("unjudged", null, null, "unadjudicated", "cloud-b");
  const cases = [first, missing, related, uncertain, unjudged, first];
  const predicted = [
    first.pair.identity,
    first.pair.identity,
    related.pair.identity,
    uncertain.pair.identity,
    unjudged.pair.identity,
    "unknown-pair",
    "unknown-pair",
  ];
  const report = evaluateSemanticMergePredictions(cases, predicted);

  assert.equal(report.truePositives, 1);
  assert.equal(report.falsePositives, 1);
  assert.equal(report.falseNegatives, 1);
  assert.equal(report.precision, 0.5);
  assert.equal(report.recall, 0.5);
  assert.equal(report.micro.precision, 0.5);
  assert.equal(report.micro.recall, 0.5);
  assert.equal(report.macro.precision, 0.5);
  assert.equal(report.macro.recall, 0.5);
  assert.equal(report.duplicateCaseIds, 1);
  assert.equal(report.duplicatePairCases, 1);
  assert.equal(report.duplicatePredictions, 2);
  assert.equal(report.duplicatePredictionOccurrences, 2);
  assert.equal(report.ignoredUnannotatedPredictions, 1);
  assert.equal(report.ignoredUncertainPredictions, 1);
  assert.equal(report.ignoredUnjudgedPredictions, 1);
  assert.equal(report.uniqueCaseCount, 5);
  assert.equal(report.scorableCases, 3);
  assert.equal(report.annotationCoverage, 0.6);
  assert.equal(report.metricsConditionalOnJudgedUniverse, true);
  assert.equal(report.perCloud.length, 2);
});

test("rejects a human label without confidence and reports N/A denominators", () => {
  const invalid = benchmarkCase("invalid", "equivalent", null, "adjudicated");
  assert.throws(() => validateSemanticMergeCase(invalid), /provided together/);

  const unjudged = benchmarkCase("unjudged", null, null, "unadjudicated");
  const report = evaluateSemanticMergePredictions([unjudged], []);
  assert.equal(report.precision, null);
  assert.equal(report.recall, null);
  assert.equal(report.annotationCoverage, 0);
  assert.equal(report.macro.precision, null);
  assert.equal(report.macro.recall, null);
});

test("authorized scope rejects exports outside the twelve-cloud partition", () => {
  const exportData = parseCalibrationExport({
    schemaVersion: 1,
    clouds: [syntheticCloud("one")],
  });

  assert.equal(AUTHORIZED_CALIBRATION_CLOUD_COUNT, 12);
  assert.throws(
    () => importCalibrationCorpus(exportData, "synthetic-salt"),
    /exactly 12 clouds/,
  );
});

test("annotation coverage excludes uncertain and unjudged cases", () => {
  const cases = [
    benchmarkCase("one", "equivalent", "high", "adjudicated"),
    benchmarkCase("two", "uncertain", "medium", "adjudicated"),
    benchmarkCase("three", null, null, "unadjudicated"),
  ];
  assert.deepEqual(summarizeAnnotationCoverage(cases), {
    totalCases: 3,
    uniqueCaseCount: 3,
    humanLabeledCases: 2,
    scorableCases: 1,
    uncertainCases: 1,
    unjudgedCases: 1,
    lowConfidenceCases: 0,
    annotationCoverage: 1 / 3,
    positiveAnnotationCount: 1,
    metricsConditionalOnJudgedUniverse: true,
    duplicateCaseIds: 0,
    duplicatePairCases: 0,
  });
});

function annotationRecord(overrides: Partial<SemanticAnnotationRecord> = {}): SemanticAnnotationRecord {
  return {
    benchmarkVersion: "semantic-merge-v1",
    caseId: "case-1",
    pairIdentity: "pair-1",
    humanLabel: "equivalent",
    confidence: "high",
    administrativeDecision: "not_recorded",
    adjudicationStatus: "adjudicated",
    ...overrides,
  };
}

test("consolidates identical annotations and rejects contradictory duplicates", () => {
  const record = annotationRecord();
  assert.deepEqual(consolidateAnnotationRecords([record, { ...record }]), [record]);
  assert.throws(
    () => consolidateAnnotationRecords([record, { ...record, humanLabel: "uncertain", confidence: "medium" }]),
    /Conflicting annotations require human resolution/,
  );
  assert.throws(
    () => consolidateAnnotationRecords([record, { ...record, administrativeDecision: "merge" }]),
    /Conflicting annotations require human resolution/,
  );
});

test("selects a reproducible, same-cloud lexical-stratified queue", () => {
  const cases = [
    benchmarkCase("high", null, null, "unadjudicated", "cloud-a", "school access", "access to school"),
    benchmarkCase("medium", null, null, "unadjudicated", "cloud-a", "public transport", "transport in the city"),
    benchmarkCase("low", null, null, "unadjudicated", "cloud-b", "school access", "purple bicycles"),
  ];
  const first = selectSemanticMergeAnnotationQueue(cases, 3);
  const second = selectSemanticMergeAnnotationQueue(cases, 3);
  assert.deepEqual(first, second);
  assert.equal(first.selectedCount, 3);
  assert.equal(first.items.every((item) => item.cloudPseudonym === "cloud-a" || item.cloudPseudonym === "cloud-b"), true);
  assert.equal(first.selectionCriteria.some((item) => item.includes("never a semantic label")), true);
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
    historicalModerationCaseCount: 60,
    acceptedMergeBenchmarkCaseCount: 3205,
    missingMergeTargetCount: 1,
  });
  assert.equal(imported.historicalModerationCases.length, 60);
  assert.equal(imported.acceptedMergeBenchmarkCases.length, 3205);
  assert.equal(imported.originIssues.length, 1);
  assert.equal(
    imported.historicalModerationCases.every(
      (item) => item.administrativeDecision === "merge" && item.humanLabel === null,
    ),
    true,
  );
  assert.equal(
    imported.acceptedMergeBenchmarkCases.every(
      (item) =>
        item.source.historicalMergeCandidate === false &&
        item.pair.first.reference.kind === "accepted_word" &&
        item.pair.second.reference.kind === "accepted_word",
    ),
    true,
  );
  const queue = selectSemanticMergeAnnotationQueue(imported.acceptedMergeBenchmarkCases, 60);
  assert.equal(queue.selectedCount, 60);
  assert.equal(queue.candidateCount, 3205);
  assert.equal(Object.keys(queue.cloudCounts).length, 9);
  assert.deepEqual(queue, selectSemanticMergeAnnotationQueue(imported.acceptedMergeBenchmarkCases, 60));
});
