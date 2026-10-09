import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  CalibrationAcceptedWord,
  CalibrationCloud,
  CalibrationExport,
  CalibrationSubmission,
} from "./export-firestore-calibration";

export const SEMANTIC_MERGE_BENCHMARK_VERSION = "semantic-merge-v1" as const;
export const AUTHORIZED_CALIBRATION_CLOUD_COUNT = 12;

export type SemanticMergeLabel =
  | "equivalent"
  | "related_but_distinct"
  | "general_vs_specific"
  | "administrative_merge"
  | "uncertain";
export type AnnotationConfidence = "high" | "medium" | "low";
export type AdministrativeDecision = "merge" | "keep_separate" | "not_recorded";
export type AdjudicationStatus =
  | "unadjudicated"
  | "agreed"
  | "adjudicated"
  | "not_applicable";
export type BenchmarkIdeaKind = "accepted_word" | "submission";

export type BenchmarkIdeaReference = Readonly<{
  kind: BenchmarkIdeaKind;
  pseudonym: string;
}>;

export type BenchmarkIdea = Readonly<{
  reference: BenchmarkIdeaReference;
  text: string;
}>;

export type SemanticMergePair = Readonly<{
  first: BenchmarkIdea;
  second: BenchmarkIdea;
  identity: string;
}>;

type BenchmarkSource = Readonly<{
  cloudPseudonym: string;
  firstRecordPseudonym: string;
  secondRecordPseudonym: string;
  historicalMergeCandidate: boolean;
}>;

export type HistoricalModerationCase = Readonly<{
  benchmarkVersion: typeof SEMANTIC_MERGE_BENCHMARK_VERSION;
  dataset: "historical_moderation";
  caseId: string;
  question: string;
  pair: SemanticMergePair;
  historicalAction: "merge_observed";
  humanLabel: null;
  confidence: null;
  administrativeDecision: "merge";
  adjudicationStatus: "not_applicable";
  source: BenchmarkSource;
}>;

export type AcceptedMergeBenchmarkCase = Readonly<{
  benchmarkVersion: typeof SEMANTIC_MERGE_BENCHMARK_VERSION;
  dataset: "accepted_merge_benchmark";
  caseId: string;
  question: string;
  pair: SemanticMergePair;
  humanLabel: SemanticMergeLabel | null;
  confidence: AnnotationConfidence | null;
  administrativeDecision: AdministrativeDecision;
  adjudicationStatus: Exclude<AdjudicationStatus, "not_applicable">;
  source: BenchmarkSource;
}>;

export type SemanticMergeBenchmarkCase = AcceptedMergeBenchmarkCase;

export type SemanticMergeOriginIssue = Readonly<{
  kind: "missing_merge_target";
  cloudPseudonym: string;
  submissionPseudonym: string;
  referencedTargetPseudonym: string;
}>;

export type SemanticMergeCorpusSummary = Readonly<{
  cloudCount: number;
  acceptedWordCount: number;
  submissionCount: number;
  historicalMergeCount: number;
  historicalModerationCaseCount: number;
  acceptedMergeBenchmarkCaseCount: number;
  missingMergeTargetCount: number;
}>;

export type SemanticMergeCorpusImport = Readonly<{
  historicalModerationCases: readonly HistoricalModerationCase[];
  acceptedMergeBenchmarkCases: readonly AcceptedMergeBenchmarkCase[];
  summary: SemanticMergeCorpusSummary;
  originIssues: readonly SemanticMergeOriginIssue[];
}>;

export type CalibrationImportOptions = Readonly<{
  enforceAuthorizedScope?: boolean;
}>;

export type SemanticMergeMetric = Readonly<{
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number | null;
  recall: number | null;
}>;

export type SemanticMergeCloudReport = Readonly<{
  cloudPseudonym: string;
  totalCases: number;
  scorableCases: number;
  humanLabeledCases: number;
  uncertainCases: number;
  unjudgedCases: number;
  lowConfidenceCases: number;
  annotationCoverage: number | null;
  metric: SemanticMergeMetric;
}>;

export type SemanticMergeMacroMetric = Readonly<{
  precision: number | null;
  recall: number | null;
  precisionClouds: number;
  recallClouds: number;
}>;

export type SemanticMergeBenchmarkReport = SemanticMergeMetric &
  Readonly<{
    totalCases: number;
    uniqueCaseCount: number;
    humanLabeledCases: number;
    scorableCases: number;
    uncertainCases: number;
    unjudgedCases: number;
    lowConfidenceCases: number;
    annotationCoverage: number | null;
    positiveAnnotationCount: number;
    metricsConditionalOnJudgedUniverse: true;
    duplicateCaseIds: number;
    duplicatePairCases: number;
    duplicatePredictions: number;
    duplicatePredictionOccurrences: number;
    ignoredUnannotatedPredictions: number;
    ignoredUncertainPredictions: number;
    ignoredUnjudgedPredictions: number;
    micro: SemanticMergeMetric;
    macro: SemanticMergeMacroMetric;
    perCloud: readonly SemanticMergeCloudReport[];
  }>;

const LABELS = new Set<SemanticMergeLabel>([
  "equivalent",
  "related_but_distinct",
  "general_vs_specific",
  "administrative_merge",
  "uncertain",
]);
const CONFIDENCES = new Set<AnnotationConfidence>(["high", "medium", "low"]);
const ADMINISTRATIVE_DECISIONS = new Set<AdministrativeDecision>([
  "merge",
  "keep_separate",
  "not_recorded",
]);
const ADJUDICATION_STATUSES = new Set<AdjudicationStatus>([
  "unadjudicated",
  "agreed",
  "adjudicated",
  "not_applicable",
]);
const REVIEW_STATUSES = new Set(["pending", "approved", "rejected", "merged"]);
const MAX_PSEUDONYM_INPUT_LENGTH = 512;

export class SemanticMergeBenchmarkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SemanticMergeBenchmarkError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, description: string): string {
  if (typeof value !== "string") {
    throw new SemanticMergeBenchmarkError(`${description} must be a string.`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, description: string): string {
  const result = requireString(value, description);
  if (result.length === 0) {
    throw new SemanticMergeBenchmarkError(`${description} must not be empty.`);
  }
  return result;
}

function requireArray(value: unknown, description: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new SemanticMergeBenchmarkError(`${description} must be an array.`);
  }
  return value;
}

function requireFiniteNumber(value: unknown, description: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SemanticMergeBenchmarkError(`${description} must be finite.`);
  }
  return value;
}

function requireExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  description: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new SemanticMergeBenchmarkError(`${description} has an invalid shape.`);
  }
}

function assertUniqueIds(ids: readonly string[], description: string): void {
  if (new Set(ids).size !== ids.length) {
    throw new SemanticMergeBenchmarkError(`${description} contains duplicate ids.`);
  }
}

function validateCalibrationAcceptedWord(
  value: unknown,
  description: string,
): CalibrationAcceptedWord {
  if (!isRecord(value)) {
    throw new SemanticMergeBenchmarkError(`${description} must be an object.`);
  }
  requireExactKeys(value, ["id", "text", "normalized", "count", "aliases"], description);
  const aliases = requireArray(value.aliases, `${description}.aliases`).map((alias, index) =>
    requireString(alias, `${description}.aliases[${index}]`),
  );
  return {
    id: requireNonEmptyString(value.id, `${description}.id`),
    text: requireString(value.text, `${description}.text`),
    normalized: requireString(value.normalized, `${description}.normalized`),
    count: requireFiniteNumber(value.count, `${description}.count`),
    aliases,
  };
}

function validateCalibrationSubmission(
  value: unknown,
  description: string,
): CalibrationSubmission {
  if (!isRecord(value)) {
    throw new SemanticMergeBenchmarkError(`${description} must be an object.`);
  }
  requireExactKeys(
    value,
    ["id", "text", "normalized", "status", "mergedIntoWordId"],
    description,
  );
  const status = requireString(value.status, `${description}.status`);
  if (!REVIEW_STATUSES.has(status)) {
    throw new SemanticMergeBenchmarkError(`${description}.status is invalid.`);
  }
  if (value.mergedIntoWordId !== null && typeof value.mergedIntoWordId !== "string") {
    throw new SemanticMergeBenchmarkError(
      `${description}.mergedIntoWordId must be a string or null.`,
    );
  }
  return {
    id: requireNonEmptyString(value.id, `${description}.id`),
    text: requireString(value.text, `${description}.text`),
    normalized: requireString(value.normalized, `${description}.normalized`),
    status: status as CalibrationSubmission["status"],
    mergedIntoWordId: value.mergedIntoWordId,
  };
}

function validateCalibrationCloud(value: unknown, description: string): CalibrationCloud {
  if (!isRecord(value)) {
    throw new SemanticMergeBenchmarkError(`${description} must be an object.`);
  }
  requireExactKeys(
    value,
    ["id", "title", "publicTitle", "status", "acceptedWords", "submissions"],
    description,
  );
  const status = requireString(value.status, `${description}.status`);
  if (!["draft", "open", "closed", "archived"].includes(status)) {
    throw new SemanticMergeBenchmarkError(`${description}.status is invalid.`);
  }
  const acceptedWords = requireArray(
    value.acceptedWords,
    `${description}.acceptedWords`,
  ).map((word, index) =>
    validateCalibrationAcceptedWord(word, `${description}.acceptedWords[${index}]`),
  );
  const submissions = requireArray(value.submissions, `${description}.submissions`).map(
    (submission, index) =>
      validateCalibrationSubmission(submission, `${description}.submissions[${index}]`),
  );
  assertUniqueIds(acceptedWords.map(({ id }) => id), `${description}.acceptedWords`);
  assertUniqueIds(submissions.map(({ id }) => id), `${description}.submissions`);
  return {
    id: requireNonEmptyString(value.id, `${description}.id`),
    title: requireString(value.title, `${description}.title`),
    publicTitle: requireString(value.publicTitle, `${description}.publicTitle`),
    status: status as CalibrationCloud["status"],
    acceptedWords,
    submissions,
  };
}

export function parseCalibrationExport(value: unknown): CalibrationExport {
  if (!isRecord(value)) {
    throw new SemanticMergeBenchmarkError("Calibration export must be an object.");
  }
  requireExactKeys(value, ["schemaVersion", "clouds"], "Calibration export");
  if (value.schemaVersion !== 1) {
    throw new SemanticMergeBenchmarkError("Unsupported calibration export version.");
  }
  const clouds = requireArray(value.clouds, "Calibration export.clouds").map(
    (cloud, index) => validateCalibrationCloud(cloud, `clouds[${index}]`),
  );
  assertUniqueIds(clouds.map(({ id }) => id), "Calibration export.clouds");
  return { schemaVersion: 1, clouds };
}

function enforceAuthorizedScope(
  exportData: CalibrationExport,
  options: CalibrationImportOptions,
): void {
  if (
    options.enforceAuthorizedScope !== false &&
    exportData.clouds.length !== AUTHORIZED_CALIBRATION_CLOUD_COUNT
  ) {
    throw new SemanticMergeBenchmarkError(
      `Authorized calibration scope requires exactly ${AUTHORIZED_CALIBRATION_CLOUD_COUNT} clouds.`,
    );
  }
}

export async function loadCalibrationExport(
  path: string,
  options: CalibrationImportOptions = {},
): Promise<CalibrationExport> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new SemanticMergeBenchmarkError("Unable to read the calibration export.");
  }
  try {
    const exportData = parseCalibrationExport(JSON.parse(text));
    enforceAuthorizedScope(exportData, options);
    return exportData;
  } catch (error) {
    if (error instanceof SemanticMergeBenchmarkError) throw error;
    throw new SemanticMergeBenchmarkError("Calibration export is not valid JSON.");
  }
}

function hashReference(value: string, salt: string): string {
  if (salt.length === 0 || salt.length > MAX_PSEUDONYM_INPUT_LENGTH) {
    throw new SemanticMergeBenchmarkError("A bounded pseudonymization salt is required.");
  }
  return createHash("sha256")
    .update(`${salt}\u0000${value}`)
    .digest("hex")
    .slice(0, 24);
}

function sourcePseudonym(
  salt: string,
  cloudId: string,
  kind: BenchmarkIdeaKind,
  recordId: string,
): string {
  return hashReference(`${cloudId}\u0000${kind}\u0000${recordId}`, salt);
}

function pairIdentity(
  first: BenchmarkIdeaReference,
  second: BenchmarkIdeaReference,
): string {
  const refs = [
    [first.kind, first.pseudonym],
    [second.kind, second.pseudonym],
  ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify(refs);
}

export function semanticMergePairIdentity(
  first: BenchmarkIdeaReference,
  second: BenchmarkIdeaReference,
): string {
  if (first.kind === second.kind && first.pseudonym === second.pseudonym) {
    throw new SemanticMergeBenchmarkError("A semantic merge pair cannot contain itself.");
  }
  return pairIdentity(first, second);
}

function cloudPseudonym(cloudId: string, salt: string): string {
  return hashReference(`cloud\u0000${cloudId}`, salt);
}

function makeCaseId(
  dataset: string,
  cloudId: string,
  identity: string,
  salt: string,
): string {
  return `case_${hashReference(`${dataset}\u0000${cloudId}\u0000${identity}`, salt)}`;
}

function makeAcceptedBenchmarkCase(
  salt: string,
  cloud: CalibrationCloud,
  first: BenchmarkIdea,
  second: BenchmarkIdea,
): AcceptedMergeBenchmarkCase {
  const identity = semanticMergePairIdentity(first.reference, second.reference);
  return {
    benchmarkVersion: SEMANTIC_MERGE_BENCHMARK_VERSION,
    dataset: "accepted_merge_benchmark",
    caseId: makeCaseId("accepted", cloud.id, identity, salt),
    question: cloud.publicTitle || cloud.title,
    pair: { first, second, identity },
    humanLabel: null,
    confidence: null,
    administrativeDecision: "not_recorded",
    adjudicationStatus: "unadjudicated",
    source: {
      cloudPseudonym: cloudPseudonym(cloud.id, salt),
      firstRecordPseudonym: first.reference.pseudonym,
      secondRecordPseudonym: second.reference.pseudonym,
      historicalMergeCandidate: false,
    },
  };
}

function makeHistoricalCase(
  salt: string,
  cloud: CalibrationCloud,
  submission: CalibrationSubmission,
  target: CalibrationAcceptedWord,
): HistoricalModerationCase {
  const first: BenchmarkIdea = {
    reference: {
      kind: "submission",
      pseudonym: sourcePseudonym(salt, cloud.id, "submission", submission.id),
    },
    text: submission.text,
  };
  const second: BenchmarkIdea = {
    reference: {
      kind: "accepted_word",
      pseudonym: sourcePseudonym(salt, cloud.id, "accepted_word", target.id),
    },
    text: target.text,
  };
  const identity = semanticMergePairIdentity(first.reference, second.reference);
  return {
    benchmarkVersion: SEMANTIC_MERGE_BENCHMARK_VERSION,
    dataset: "historical_moderation",
    caseId: makeCaseId("historical", cloud.id, identity, salt),
    question: cloud.publicTitle || cloud.title,
    pair: { first, second, identity },
    historicalAction: "merge_observed",
    humanLabel: null,
    confidence: null,
    administrativeDecision: "merge",
    adjudicationStatus: "not_applicable",
    source: {
      cloudPseudonym: cloudPseudonym(cloud.id, salt),
      firstRecordPseudonym: first.reference.pseudonym,
      secondRecordPseudonym: second.reference.pseudonym,
      historicalMergeCandidate: true,
    },
  };
}

export function generateAcceptedMergeBenchmarkCases(
  exportData: CalibrationExport,
  pseudonymizationSalt: string,
  options: CalibrationImportOptions = {},
): readonly AcceptedMergeBenchmarkCase[] {
  enforceAuthorizedScope(exportData, options);
  const cases: AcceptedMergeBenchmarkCase[] = [];
  for (const cloud of exportData.clouds) {
    for (let firstIndex = 0; firstIndex < cloud.acceptedWords.length; firstIndex += 1) {
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < cloud.acceptedWords.length;
        secondIndex += 1
      ) {
        const firstWord = cloud.acceptedWords[firstIndex]!;
        const secondWord = cloud.acceptedWords[secondIndex]!;
        cases.push(
          makeAcceptedBenchmarkCase(
            pseudonymizationSalt,
            cloud,
            {
              reference: {
                kind: "accepted_word",
                pseudonym: sourcePseudonym(
                  pseudonymizationSalt,
                  cloud.id,
                  "accepted_word",
                  firstWord.id,
                ),
              },
              text: firstWord.text,
            },
            {
              reference: {
                kind: "accepted_word",
                pseudonym: sourcePseudonym(
                  pseudonymizationSalt,
                  cloud.id,
                  "accepted_word",
                  secondWord.id,
                ),
              },
              text: secondWord.text,
            },
          ),
        );
      }
    }
  }
  return cases;
}

export function importCalibrationCorpus(
  exportData: CalibrationExport,
  pseudonymizationSalt: string,
  options: CalibrationImportOptions = {},
): SemanticMergeCorpusImport {
  enforceAuthorizedScope(exportData, options);
  const historicalModerationCases: HistoricalModerationCase[] = [];
  const originIssues: SemanticMergeOriginIssue[] = [];
  let historicalMergeCount = 0;

  for (const cloud of exportData.clouds) {
    const acceptedById = new Map(cloud.acceptedWords.map((word) => [word.id, word]));
    for (const submission of cloud.submissions) {
      if (submission.status !== "merged") continue;
      historicalMergeCount += 1;
      const targetId = submission.mergedIntoWordId;
      const target = targetId === null ? undefined : acceptedById.get(targetId);
      const submissionPseudonym = sourcePseudonym(
        pseudonymizationSalt,
        cloud.id,
        "submission",
        submission.id,
      );
      const targetPseudonym = sourcePseudonym(
        pseudonymizationSalt,
        cloud.id,
        "accepted_word",
        targetId ?? "missing-target",
      );
      if (!target) {
        originIssues.push({
          kind: "missing_merge_target",
          cloudPseudonym: cloudPseudonym(cloud.id, pseudonymizationSalt),
          submissionPseudonym,
          referencedTargetPseudonym: targetPseudonym,
        });
        continue;
      }
      historicalModerationCases.push(
        makeHistoricalCase(pseudonymizationSalt, cloud, submission, target),
      );
    }
  }

  const acceptedMergeBenchmarkCases = generateAcceptedMergeBenchmarkCases(
    exportData,
    pseudonymizationSalt,
    options,
  );
  return {
    historicalModerationCases,
    acceptedMergeBenchmarkCases,
    summary: {
      cloudCount: exportData.clouds.length,
      acceptedWordCount: exportData.clouds.reduce(
        (total, cloud) => total + cloud.acceptedWords.length,
        0,
      ),
      submissionCount: exportData.clouds.reduce(
        (total, cloud) => total + cloud.submissions.length,
        0,
      ),
      historicalMergeCount,
      historicalModerationCaseCount: historicalModerationCases.length,
      acceptedMergeBenchmarkCaseCount: acceptedMergeBenchmarkCases.length,
      missingMergeTargetCount: originIssues.length,
    },
    originIssues,
  };
}

function validatePairIdentity(pair: SemanticMergePair): void {
  if (
    semanticMergePairIdentity(pair.first.reference, pair.second.reference) !==
    pair.identity
  ) {
    throw new SemanticMergeBenchmarkError("Pair identity is not canonical.");
  }
}

export function validateHistoricalModerationCase(
  benchmarkCase: HistoricalModerationCase,
): void {
  if (
    benchmarkCase.benchmarkVersion !== SEMANTIC_MERGE_BENCHMARK_VERSION ||
    benchmarkCase.dataset !== "historical_moderation" ||
    benchmarkCase.historicalAction !== "merge_observed" ||
    benchmarkCase.administrativeDecision !== "merge" ||
    benchmarkCase.adjudicationStatus !== "not_applicable" ||
    benchmarkCase.humanLabel !== null ||
    benchmarkCase.confidence !== null ||
    benchmarkCase.pair.first.reference.kind !== "submission" ||
    benchmarkCase.pair.second.reference.kind !== "accepted_word"
  ) {
    throw new SemanticMergeBenchmarkError("Invalid historical moderation case.");
  }
  requireNonEmptyString(benchmarkCase.caseId, "caseId");
  requireString(benchmarkCase.question, "question");
  validatePairIdentity(benchmarkCase.pair);
}

export function validateSemanticMergeCase(
  benchmarkCase: AcceptedMergeBenchmarkCase,
): void {
  if (
    benchmarkCase.benchmarkVersion !== SEMANTIC_MERGE_BENCHMARK_VERSION ||
    benchmarkCase.dataset !== "accepted_merge_benchmark" ||
    benchmarkCase.pair.first.reference.kind !== "accepted_word" ||
    benchmarkCase.pair.second.reference.kind !== "accepted_word"
  ) {
    throw new SemanticMergeBenchmarkError(
      "Accepted merge benchmark cases require two accepted_word references.",
    );
  }
  requireNonEmptyString(benchmarkCase.caseId, "caseId");
  requireString(benchmarkCase.question, "question");
  requireNonEmptyString(benchmarkCase.pair.first.reference.pseudonym, "pair.first.reference");
  requireNonEmptyString(benchmarkCase.pair.second.reference.pseudonym, "pair.second.reference");
  validatePairIdentity(benchmarkCase.pair);
  if (benchmarkCase.humanLabel !== null && !LABELS.has(benchmarkCase.humanLabel)) {
    throw new SemanticMergeBenchmarkError("Invalid human label.");
  }
  if (benchmarkCase.confidence !== null && !CONFIDENCES.has(benchmarkCase.confidence)) {
    throw new SemanticMergeBenchmarkError("Invalid annotation confidence.");
  }
  if (!ADMINISTRATIVE_DECISIONS.has(benchmarkCase.administrativeDecision)) {
    throw new SemanticMergeBenchmarkError("Invalid administrative decision.");
  }
  if (!ADJUDICATION_STATUSES.has(benchmarkCase.adjudicationStatus)) {
    throw new SemanticMergeBenchmarkError("Invalid adjudication status.");
  }
  if ((benchmarkCase.humanLabel === null) !== (benchmarkCase.confidence === null)) {
    throw new SemanticMergeBenchmarkError(
      "Human label and confidence must be provided together.",
    );
  }
}

function isHumanLabeled(
  benchmarkCase: AcceptedMergeBenchmarkCase,
): benchmarkCase is AcceptedMergeBenchmarkCase & {
  humanLabel: SemanticMergeLabel;
  confidence: AnnotationConfidence;
} {
  return benchmarkCase.humanLabel !== null && benchmarkCase.confidence !== null;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function emptyMetric(): {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
} {
  return { truePositives: 0, falsePositives: 0, falseNegatives: 0 };
}

function metricFromCounts(counts: ReturnType<typeof emptyMetric>): SemanticMergeMetric {
  return {
    ...counts,
    precision: ratio(counts.truePositives, counts.truePositives + counts.falsePositives),
    recall: ratio(counts.truePositives, counts.truePositives + counts.falseNegatives),
  };
}

function averageDefined(values: readonly (number | null)[]): number | null {
  const defined = values.filter((value): value is number => value !== null);
  return defined.length === 0
    ? null
    : defined.reduce((total, value) => total + value, 0) / defined.length;
}

type CoverageCounts = ReturnType<typeof emptyMetric> & {
  totalCases: number;
  humanLabeledCases: number;
  scorableCases: number;
  uncertainCases: number;
  unjudgedCases: number;
  lowConfidenceCases: number;
  positiveAnnotationCount: number;
};

function emptyCoverageCounts(): CoverageCounts {
  return {
    ...emptyMetric(),
    totalCases: 0,
    humanLabeledCases: 0,
    scorableCases: 0,
    uncertainCases: 0,
    unjudgedCases: 0,
    lowConfidenceCases: 0,
    positiveAnnotationCount: 0,
  };
}

function isScorable(benchmarkCase: AcceptedMergeBenchmarkCase): boolean {
  return (
    isHumanLabeled(benchmarkCase) &&
    benchmarkCase.humanLabel !== "uncertain" &&
    benchmarkCase.adjudicationStatus !== "unadjudicated" &&
    benchmarkCase.confidence !== "low"
  );
}

function coverageReport(
  cloudPseudonym: string,
  counts: CoverageCounts,
): SemanticMergeCloudReport {
  return {
    cloudPseudonym,
    totalCases: counts.totalCases,
    scorableCases: counts.scorableCases,
    humanLabeledCases: counts.humanLabeledCases,
    uncertainCases: counts.uncertainCases,
    unjudgedCases: counts.unjudgedCases,
    lowConfidenceCases: counts.lowConfidenceCases,
    annotationCoverage: ratio(counts.scorableCases, counts.totalCases),
    metric: metricFromCounts(counts),
  };
}

export function evaluateSemanticMergePredictions(
  benchmarkCases: readonly AcceptedMergeBenchmarkCase[],
  predictedPairIdentities: readonly string[],
): SemanticMergeBenchmarkReport {
  const caseIds = new Set<string>();
  const pairCounts = new Map<string, number>();
  const casesByPair = new Map<string, AcceptedMergeBenchmarkCase>();
  for (const benchmarkCase of benchmarkCases) {
    validateSemanticMergeCase(benchmarkCase);
    caseIds.add(benchmarkCase.caseId);
    pairCounts.set(
      benchmarkCase.pair.identity,
      (pairCounts.get(benchmarkCase.pair.identity) ?? 0) + 1,
    );
    if (!casesByPair.has(benchmarkCase.pair.identity)) {
      casesByPair.set(benchmarkCase.pair.identity, benchmarkCase);
    }
  }

  const uniqueCases = [...casesByPair.values()];
  const predictionCounts = new Map<string, number>();
  for (const identity of predictedPairIdentities) {
    if (typeof identity !== "string" || identity.length === 0) {
      throw new SemanticMergeBenchmarkError("Prediction identities must be non-empty strings.");
    }
    predictionCounts.set(identity, (predictionCounts.get(identity) ?? 0) + 1);
  }

  const coverageByCloud = new Map<string, CoverageCounts>();
  let ignoredUnannotatedPredictions = 0;
  let ignoredUncertainPredictions = 0;
  let ignoredUnjudgedPredictions = 0;
  for (const benchmarkCase of uniqueCases) {
    const cloud = coverageByCloud.get(benchmarkCase.source.cloudPseudonym) ?? emptyCoverageCounts();
    cloud.totalCases += 1;
    const predicted = predictionCounts.has(benchmarkCase.pair.identity);
    if (isHumanLabeled(benchmarkCase)) cloud.humanLabeledCases += 1;
    if (benchmarkCase.humanLabel === "uncertain") {
      cloud.uncertainCases += 1;
      if (predicted) ignoredUncertainPredictions += 1;
    } else if (
      !isHumanLabeled(benchmarkCase) ||
      benchmarkCase.adjudicationStatus === "unadjudicated"
    ) {
      cloud.unjudgedCases += 1;
      if (predicted) ignoredUnjudgedPredictions += 1;
    } else if (benchmarkCase.confidence === "low") {
      cloud.lowConfidenceCases += 1;
      if (predicted) ignoredUncertainPredictions += 1;
    } else {
      cloud.scorableCases += 1;
      if (benchmarkCase.humanLabel === "equivalent") {
        cloud.positiveAnnotationCount += 1;
        if (predicted) cloud.truePositives += 1;
        else cloud.falseNegatives += 1;
      } else if (predicted) {
        cloud.falsePositives += 1;
      }
    }
    coverageByCloud.set(benchmarkCase.source.cloudPseudonym, cloud);
  }

  for (const [identity] of predictionCounts) {
    if (!casesByPair.has(identity)) ignoredUnannotatedPredictions += 1;
  }

  const perCloud = [...coverageByCloud.entries()]
    .map(([cloudPseudonym, counts]) => coverageReport(cloudPseudonym, counts))
    .sort((first, second) => first.cloudPseudonym.localeCompare(second.cloudPseudonym));
  const micro = metricFromCounts(
    perCloud.reduce(
      (total, report) => ({
        truePositives: total.truePositives + report.metric.truePositives,
        falsePositives: total.falsePositives + report.metric.falsePositives,
        falseNegatives: total.falseNegatives + report.metric.falseNegatives,
      }),
      emptyMetric(),
    ),
  );
  const macro: SemanticMergeMacroMetric = {
    precision: averageDefined(perCloud.map((report) => report.metric.precision)),
    recall: averageDefined(perCloud.map((report) => report.metric.recall)),
    precisionClouds: perCloud.filter((report) => report.metric.precision !== null).length,
    recallClouds: perCloud.filter((report) => report.metric.recall !== null).length,
  };
  const totalCases = perCloud.reduce((sum, report) => sum + report.totalCases, 0);
  const scorableCases = perCloud.reduce((sum, report) => sum + report.scorableCases, 0);
  const humanLabeledCases = perCloud.reduce((sum, report) => sum + report.humanLabeledCases, 0);
  const uncertainCases = perCloud.reduce((sum, report) => sum + report.uncertainCases, 0);
  const unjudgedCases = perCloud.reduce((sum, report) => sum + report.unjudgedCases, 0);
  const lowConfidenceCases = perCloud.reduce((sum, report) => sum + report.lowConfidenceCases, 0);
  const positiveAnnotationCount = uniqueCases.reduce(
    (sum, benchmarkCase) =>
      sum + (isScorable(benchmarkCase) && benchmarkCase.humanLabel === "equivalent" ? 1 : 0),
    0,
  );
  const duplicatePredictionCounts = [...predictionCounts.values()].filter((count) => count > 1);
  const microWithAliases = micro;

  return {
    ...microWithAliases,
    totalCases: benchmarkCases.length,
    uniqueCaseCount: uniqueCases.length,
    humanLabeledCases,
    scorableCases,
    uncertainCases,
    unjudgedCases,
    lowConfidenceCases,
    annotationCoverage: ratio(scorableCases, totalCases),
    positiveAnnotationCount,
    metricsConditionalOnJudgedUniverse: true,
    duplicateCaseIds: benchmarkCases.length - caseIds.size,
    duplicatePairCases: [...pairCounts.values()].filter((count) => count > 1).length,
    duplicatePredictions: duplicatePredictionCounts.length,
    duplicatePredictionOccurrences: duplicatePredictionCounts.reduce(
      (total, count) => total + count - 1,
      0,
    ),
    ignoredUnannotatedPredictions,
    ignoredUncertainPredictions,
    ignoredUnjudgedPredictions,
    micro,
    macro,
    perCloud,
  };
}

export function summarizeAnnotationCoverage(
  benchmarkCases: readonly AcceptedMergeBenchmarkCase[],
): Pick<
  SemanticMergeBenchmarkReport,
  | "totalCases"
  | "uniqueCaseCount"
  | "humanLabeledCases"
  | "scorableCases"
  | "uncertainCases"
  | "unjudgedCases"
  | "lowConfidenceCases"
  | "annotationCoverage"
  | "positiveAnnotationCount"
  | "metricsConditionalOnJudgedUniverse"
  | "duplicateCaseIds"
  | "duplicatePairCases"
> {
  const report = evaluateSemanticMergePredictions(benchmarkCases, []);
  return {
    totalCases: report.totalCases,
    uniqueCaseCount: report.uniqueCaseCount,
    humanLabeledCases: report.humanLabeledCases,
    scorableCases: report.scorableCases,
    uncertainCases: report.uncertainCases,
    unjudgedCases: report.unjudgedCases,
    lowConfidenceCases: report.lowConfidenceCases,
    annotationCoverage: report.annotationCoverage,
    positiveAnnotationCount: report.positiveAnnotationCount,
    metricsConditionalOnJudgedUniverse: true,
    duplicateCaseIds: report.duplicateCaseIds,
    duplicatePairCases: report.duplicatePairCases,
  };
}
