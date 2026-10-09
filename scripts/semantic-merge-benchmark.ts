import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  CalibrationExport,
  CalibrationCloud,
  CalibrationAcceptedWord,
  CalibrationSubmission,
} from "./export-firestore-calibration";

export const SEMANTIC_MERGE_BENCHMARK_VERSION = "semantic-merge-v1" as const;

export type SemanticMergeLabel =
  | "equivalent"
  | "related_but_distinct"
  | "general_vs_specific"
  | "administrative_merge"
  | "uncertain";

export type AnnotationConfidence = "high" | "medium" | "low";

export type AdministrativeDecision =
  | "merge"
  | "keep_separate"
  | "not_recorded";

export type AdjudicationStatus =
  | "unadjudicated"
  | "agreed"
  | "adjudicated";

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

export type SemanticMergeBenchmarkCase = Readonly<{
  benchmarkVersion: typeof SEMANTIC_MERGE_BENCHMARK_VERSION;
  caseId: string;
  question: string;
  pair: SemanticMergePair;
  humanLabel: SemanticMergeLabel | null;
  confidence: AnnotationConfidence | null;
  administrativeDecision: AdministrativeDecision;
  adjudicationStatus: AdjudicationStatus;
  source: Readonly<{
    cloudPseudonym: string;
    firstRecordPseudonym: string;
    secondRecordPseudonym: string;
    historicalMergeCandidate: boolean;
  }>;
}>;

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
  extractedCandidateCount: number;
  missingMergeTargetCount: number;
}>;

export type SemanticMergeCorpusImport = Readonly<{
  cases: readonly SemanticMergeBenchmarkCase[];
  summary: SemanticMergeCorpusSummary;
  originIssues: readonly SemanticMergeOriginIssue[];
}>;

export type SemanticMergeMetric = Readonly<{
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number | null;
  recall: number | null;
}>;

export type SemanticMergeBenchmarkReport = SemanticMergeMetric &
  Readonly<{
    totalCases: number;
    humanLabeledCases: number;
    scorableCases: number;
    uncertainCases: number;
    unjudgedCases: number;
    lowConfidenceCases: number;
    duplicateCaseIds: number;
    duplicatePairCases: number;
    duplicatePredictions: number;
    ignoredUnannotatedPredictions: number;
    ignoredUncertainPredictions: number;
    ignoredUnjudgedPredictions: number;
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

function validateCalibrationAcceptedWord(
  value: unknown,
  description: string,
): CalibrationAcceptedWord {
  if (!isRecord(value)) {
    throw new SemanticMergeBenchmarkError(`${description} must be an object.`);
  }

  requireExactKeys(
    value,
    ["id", "text", "normalized", "count", "aliases"],
    description,
  );
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
      validateCalibrationSubmission(
        submission,
        `${description}.submissions[${index}]`,
      ),
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

function assertUniqueIds(ids: readonly string[], description: string): void {
  if (new Set(ids).size !== ids.length) {
    throw new SemanticMergeBenchmarkError(`${description} contains duplicate ids.`);
  }
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

export async function loadCalibrationExport(path: string): Promise<CalibrationExport> {
  let text: string;

  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new SemanticMergeBenchmarkError("Unable to read the calibration export.");
  }

  try {
    return parseCalibrationExport(JSON.parse(text));
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
  if (
    first.kind === second.kind &&
    first.pseudonym === second.pseudonym
  ) {
    throw new SemanticMergeBenchmarkError("A semantic merge pair cannot contain itself.");
  }

  return pairIdentity(first, second);
}

function makeCase(
  salt: string,
  cloud: CalibrationCloud,
  first: BenchmarkIdea,
  second: BenchmarkIdea,
  historicalMergeCandidate: boolean,
): SemanticMergeBenchmarkCase {
  const identity = semanticMergePairIdentity(first.reference, second.reference);
  const caseId = `case_${hashReference(`${cloud.id}\u0000${identity}`, salt)}`;
  const cloudPseudonym = hashReference(`cloud\u0000${cloud.id}`, salt);

  return {
    benchmarkVersion: SEMANTIC_MERGE_BENCHMARK_VERSION,
    caseId,
    question: cloud.publicTitle || cloud.title,
    pair: { first, second, identity },
    humanLabel: null,
    confidence: null,
    administrativeDecision: "not_recorded",
    adjudicationStatus: "unadjudicated",
    source: {
      cloudPseudonym,
      firstRecordPseudonym: first.reference.pseudonym,
      secondRecordPseudonym: second.reference.pseudonym,
      historicalMergeCandidate,
    },
  };
}

export function importCalibrationCorpus(
  exportData: CalibrationExport,
  pseudonymizationSalt: string,
): SemanticMergeCorpusImport {
  const cases: SemanticMergeBenchmarkCase[] = [];
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
      const cloudPseudonym = hashReference(`cloud\u0000${cloud.id}`, pseudonymizationSalt);

      if (!target) {
        originIssues.push({
          kind: "missing_merge_target",
          cloudPseudonym,
          submissionPseudonym,
          referencedTargetPseudonym: targetPseudonym,
        });
        continue;
      }

      const first: BenchmarkIdea = {
        reference: {
          kind: "submission",
          pseudonym: submissionPseudonym,
        },
        text: submission.text,
      };
      const second: BenchmarkIdea = {
        reference: {
          kind: "accepted_word",
          pseudonym: targetPseudonym,
        },
        text: target.text,
      };
      cases.push(makeCase(pseudonymizationSalt, cloud, first, second, true));
    }
  }

  return {
    cases,
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
      extractedCandidateCount: cases.length,
      missingMergeTargetCount: originIssues.length,
    },
    originIssues,
  };
}

function isHumanLabeled(
  benchmarkCase: SemanticMergeBenchmarkCase,
): benchmarkCase is SemanticMergeBenchmarkCase & {
  humanLabel: SemanticMergeLabel;
  confidence: AnnotationConfidence;
} {
  return benchmarkCase.humanLabel !== null && benchmarkCase.confidence !== null;
}

export function validateSemanticMergeCase(
  benchmarkCase: SemanticMergeBenchmarkCase,
): void {
  if (benchmarkCase.benchmarkVersion !== SEMANTIC_MERGE_BENCHMARK_VERSION) {
    throw new SemanticMergeBenchmarkError("Unsupported semantic merge benchmark version.");
  }

  requireNonEmptyString(benchmarkCase.caseId, "caseId");
  requireString(benchmarkCase.question, "question");
  requireNonEmptyString(benchmarkCase.pair.identity, "pair.identity");
  requireNonEmptyString(benchmarkCase.pair.first.reference.pseudonym, "pair.first.reference");
  requireNonEmptyString(benchmarkCase.pair.second.reference.pseudonym, "pair.second.reference");

  if (
    benchmarkCase.pair.first.reference.kind === benchmarkCase.pair.second.reference.kind &&
    benchmarkCase.pair.first.reference.pseudonym ===
      benchmarkCase.pair.second.reference.pseudonym
  ) {
    throw new SemanticMergeBenchmarkError("A semantic merge pair cannot contain itself.");
  }

  if (
    semanticMergePairIdentity(
      benchmarkCase.pair.first.reference,
      benchmarkCase.pair.second.reference,
    ) !== benchmarkCase.pair.identity
  ) {
    throw new SemanticMergeBenchmarkError("Pair identity is not canonical.");
  }

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

  if (
    benchmarkCase.humanLabel === null !==
    (benchmarkCase.confidence === null)
  ) {
    throw new SemanticMergeBenchmarkError(
      "Human label and confidence must be provided together.",
    );
  }
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function evaluateSemanticMergePredictions(
  benchmarkCases: readonly SemanticMergeBenchmarkCase[],
  predictedPairIdentities: readonly string[],
): SemanticMergeBenchmarkReport {
  const caseIds = new Set<string>();
  const pairCounts = new Map<string, number>();
  const casesByPair = new Map<string, SemanticMergeBenchmarkCase>();

  for (const benchmarkCase of benchmarkCases) {
    validateSemanticMergeCase(benchmarkCase);
    caseIds.add(benchmarkCase.caseId);
    pairCounts.set(
      benchmarkCase.pair.identity,
      (pairCounts.get(benchmarkCase.pair.identity) ?? 0) + 1,
    );
    casesByPair.set(benchmarkCase.pair.identity, benchmarkCase);
  }

  const duplicateCaseIds = benchmarkCases.length - caseIds.size;
  const duplicatePairCases = [...pairCounts.values()].filter((count) => count > 1).length;
  const predictionCounts = new Map<string, number>();

  for (const identity of predictedPairIdentities) {
    if (typeof identity !== "string" || identity.length === 0) {
      throw new SemanticMergeBenchmarkError("Prediction identities must be non-empty strings.");
    }

    predictionCounts.set(identity, (predictionCounts.get(identity) ?? 0) + 1);
  }

  let humanLabeledCases = 0;
  let scorableCases = 0;
  let uncertainCases = 0;
  let unjudgedCases = 0;
  let lowConfidenceCases = 0;
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let ignoredUnannotatedPredictions = 0;
  let ignoredUncertainPredictions = 0;
  let ignoredUnjudgedPredictions = 0;

  for (const benchmarkCase of benchmarkCases) {
    const predicted = predictionCounts.has(benchmarkCase.pair.identity);

    if (isHumanLabeled(benchmarkCase)) {
      humanLabeledCases += 1;
    }

    if (benchmarkCase.humanLabel === "uncertain") {
      uncertainCases += 1;
      if (predicted) ignoredUncertainPredictions += 1;
      continue;
    }

    if (!isHumanLabeled(benchmarkCase) || benchmarkCase.adjudicationStatus === "unadjudicated") {
      unjudgedCases += 1;
      if (predicted) ignoredUnjudgedPredictions += 1;
      continue;
    }

    if (benchmarkCase.confidence === "low") {
      lowConfidenceCases += 1;
      if (predicted) ignoredUncertainPredictions += 1;
      continue;
    }

    scorableCases += 1;

    if (benchmarkCase.humanLabel === "equivalent") {
      if (predicted) truePositives += 1;
      else falseNegatives += 1;
    } else if (predicted) {
      falsePositives += 1;
    }
  }

  for (const [identity, count] of predictionCounts) {
    if (count > 1) continue;

    const benchmarkCase = casesByPair.get(identity);

    if (!benchmarkCase) {
      ignoredUnannotatedPredictions += 1;
    }
  }

  return {
    totalCases: benchmarkCases.length,
    humanLabeledCases,
    scorableCases,
    uncertainCases,
    unjudgedCases,
    lowConfidenceCases,
    duplicateCaseIds,
    duplicatePairCases,
    duplicatePredictions: [...predictionCounts.values()].filter((count) => count > 1).length,
    ignoredUnannotatedPredictions,
    ignoredUncertainPredictions,
    ignoredUnjudgedPredictions,
    truePositives,
    falsePositives,
    falseNegatives,
    precision: ratio(truePositives, truePositives + falsePositives),
    recall: ratio(truePositives, truePositives + falseNegatives),
  };
}

export function summarizeAnnotationCoverage(
  benchmarkCases: readonly SemanticMergeBenchmarkCase[],
): Pick<
  SemanticMergeBenchmarkReport,
  | "totalCases"
  | "humanLabeledCases"
  | "scorableCases"
  | "uncertainCases"
  | "unjudgedCases"
  | "lowConfidenceCases"
  | "duplicateCaseIds"
  | "duplicatePairCases"
> {
  const report = evaluateSemanticMergePredictions(benchmarkCases, []);

  return {
    totalCases: report.totalCases,
    humanLabeledCases: report.humanLabeledCases,
    scorableCases: report.scorableCases,
    uncertainCases: report.uncertainCases,
    unjudgedCases: report.unjudgedCases,
    lowConfidenceCases: report.lowConfidenceCases,
    duplicateCaseIds: report.duplicateCaseIds,
    duplicatePairCases: report.duplicatePairCases,
  };
}
