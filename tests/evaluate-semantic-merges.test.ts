import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  DEDICATED_MERGE_INSTRUCTION,
  applyAnnotationsToQueue,
  parseRunnerOptions,
  planEvaluationCalls,
  preflightResultsPath,
  predictedPairIdentities,
  renderDryRun,
  runNetworkEvaluation,
  writeResults,
} from "../scripts/evaluate-semantic-merges";
import {
  generateAcceptedMergeBenchmarkCases,
  parseCalibrationExport,
  semanticMergePairIdentity,
  type SemanticAnnotationRecord,
} from "../scripts/semantic-merge-benchmark";

function syntheticCloud(id: string) {
  return {
    id,
    title: `Title ${id}`,
    publicTitle: `Question ${id}`,
    status: "open" as const,
    acceptedWords: [
      { id: `${id}-a`, text: "Safe transport", normalized: "safe transport", count: 1, aliases: [] },
      { id: `${id}-b`, text: "Transport seguro", normalized: "transport seguro", count: 1, aliases: [] },
      { id: `${id}-c`, text: "Purple bicycles", normalized: "purple bicycles", count: 1, aliases: [] },
    ],
    submissions: [],
  };
}

test("runner requires an explicit mode and strategy", () => {
  assert.throws(() => parseRunnerOptions([]), /Mode and explicit strategy/);
  assert.throws(() => parseRunnerOptions(["--dry-run"]), /Mode and explicit strategy/);
  assert.deepEqual(parseRunnerOptions(["--dry-run", "--strategy", "both"]).mode, "dry-run");
  assert.deepEqual(parseRunnerOptions(["--dry-run", "--strategy", "both"]).strategy, "both");
  assert.throws(() => parseRunnerOptions(["--allow-network", "--strategy", "unknown"]), /Strategy/);
});

test("plans one call per represented cloud and two strategies double the plan", () => {
  const exportData = parseCalibrationExport({
    schemaVersion: 1,
    clouds: [syntheticCloud("cloud-a"), syntheticCloud("cloud-b")],
  });
  const cases = generateAcceptedMergeBenchmarkCases(exportData, "synthetic-runner-salt", {
    enforceAuthorizedScope: false,
  });
  const queue = {
    benchmarkVersion: "semantic-merge-v1" as const,
    selectionVersion: "lexical-stratified-v1" as const,
    targetCount: 2,
    candidateCount: cases.length,
    selectedCount: 2,
    selectionCriteria: [],
    tierCounts: { high: 1, medium: 1, low: 0 } as const,
    cloudCounts: { "cloud-a": 1, "cloud-b": 1 } as const,
    items: [
      { caseId: cases[0]!.caseId, cloudPseudonym: cases[0]!.source.cloudPseudonym, lexicalSimilarity: 0.8, lexicalTier: "high" as const },
      { caseId: cases[3]!.caseId, cloudPseudonym: cases[3]!.source.cloudPseudonym, lexicalSimilarity: 0.3, lexicalTier: "medium" as const },
    ],
  };
  const first = cases[0]!;
  const second = cases[3]!;
  const annotations: SemanticAnnotationRecord[] = [first, second].map((item) => ({
    benchmarkVersion: "semantic-merge-v1",
    caseId: item.caseId,
    pairIdentity: item.pair.identity,
    humanLabel: "equivalent",
    confidence: "high",
    administrativeDecision: "not_recorded",
    adjudicationStatus: "adjudicated",
  }));
  const annotated = applyAnnotationsToQueue(cases, queue, annotations);
  const plan = planEvaluationCalls(cases, queue, "both", annotated);
  assert.equal(plan.clouds, 2);
  assert.equal(plan.callsPerStrategy, 2);
  assert.equal(plan.totalCalls, 4);
  assert.equal(plan.scorableCases, 2);
  assert.equal(plan.positiveAnnotationCount, 2);
});

test("dry-run is metadata-only and reports zero calls", () => {
  const response = renderDryRun({
    queue: {
      benchmarkVersion: "semantic-merge-v1",
      selectionVersion: "lexical-stratified-v1",
      targetCount: 0,
      candidateCount: 0,
      selectedCount: 0,
      selectionCriteria: [],
      tierCounts: { high: 0, medium: 0, low: 0 },
      cloudCounts: {},
      items: [],
    },
    entries: [],
    clouds: 9,
    callsPerStrategy: 9,
    totalCalls: 18,
    acceptedWordCount: 0,
    inputCharacterCount: 0,
    scorableCases: 57,
    positiveAnnotationCount: 5,
  }, "both");
  assert.match(response, /strategies=unified,dedicated/);
  assert.match(response, /planned_calls=18/);
  assert.match(response, /openrouter_calls=0/);
  assert.match(response, /network_enabled=false/);
  assert.equal(DEDICATED_MERGE_INSTRUCTION.includes("untrusted classroom data"), true);
});

test("prediction matching is independent of pair order", () => {
  const response = {
    results: [],
    acceptedMergeSuggestions: [{ firstId: "b", secondId: "a" }],
  };
  const expected = semanticMergePairIdentity(
    { kind: "accepted_word", pseudonym: "a" },
    { kind: "accepted_word", pseudonym: "b" },
  );
  assert.deepEqual(predictedPairIdentities(response), [expected]);
});

test("results preflight rejects repository paths, missing directories, and existing files", async () => {
  const root = await mkdtemp(join(tmpdir(), "semantic-merge-runner-"));
  try {
    await assert.rejects(
      preflightResultsPath(resolve("evaluation-results.json")),
      /outside the repository/,
    );
    await assert.rejects(
      preflightResultsPath(join(root, "missing", "results.json")),
      /directory does not exist/,
    );
    const existing = join(root, "existing.json");
    await writeFile(existing, "original", { flag: "wx" });
    await assert.rejects(preflightResultsPath(existing), /already exists/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preflight failures prevent the network executor from being called", async () => {
  let calls = 0;
  const plan = {
    queue: {
      benchmarkVersion: "semantic-merge-v1" as const,
      selectionVersion: "lexical-stratified-v1" as const,
      targetCount: 0,
      candidateCount: 0,
      selectedCount: 0,
      selectionCriteria: [],
      tierCounts: { high: 0, medium: 0, low: 0 },
      cloudCounts: {},
      items: [],
    },
    entries: [],
    clouds: 0,
    callsPerStrategy: 0,
    totalCalls: 0,
    acceptedWordCount: 0,
    inputCharacterCount: 0,
    scorableCases: 0,
    positiveAnnotationCount: 0,
  };
  await assert.rejects(
    runNetworkEvaluation(
      plan,
      [],
      "unified",
      join(tmpdir(), "missing-semantic-runner-directory", "results.json"),
      async () => {
        calls += 1;
        throw new Error("network must not run");
      },
    ),
    /directory does not exist/,
  );
  assert.equal(calls, 0);
});

test("safe result publication preserves existing output and writes a complete marker", async () => {
  const root = await mkdtemp(join(tmpdir(), "semantic-merge-runner-"));
  try {
    const target = join(root, "results.json");
    await preflightResultsPath(target);
    await writeResults(target, { status: "complete", completedCalls: 2 });
    assert.deepEqual(JSON.parse(await readFile(target, "utf8")), { status: "complete", completedCalls: 2 });
    await assert.rejects(writeResults(target, { status: "complete", completedCalls: 99 }), /already exists/);
    assert.deepEqual(JSON.parse(await readFile(target, "utf8")), { status: "complete", completedCalls: 2 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
