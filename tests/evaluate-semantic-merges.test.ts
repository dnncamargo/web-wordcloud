import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { TriageInput, TriageResponse } from "../lib/ai/openRouterTriage";
import {
  DEDICATED_MERGE_INSTRUCTION,
  assertOpenRouterApiKey,
  applyAnonymizationApprovalStore,
  buildResultsDocument,
  evaluateStrategy,
  evaluationRunStatus,
  applyAnnotationsToQueue,
  anonymizeEvaluationPlan,
  parseRunnerOptions,
  planEvaluationCalls,
  preflightResultsPath,
  predictedPairIdentities,
  renderDryRun,
  runNetworkEvaluation,
  selectedStrategies,
  writeResults,
  type EvaluationPlanEntry,
} from "../scripts/evaluate-semantic-merges";
import { DEDICATED_CALIBRATED_INSTRUCTION } from "../scripts/semantic-merge-calibrated-instruction";
import {
  anonymizationDictionaryFingerprint,
  anonymizationRulesFingerprint,
  batchDeclarationFingerprint,
  createBatchApprovalStore,
  corpusVersionForInputs,
  parseAnonymizationDictionary,
} from "../scripts/semantic-merge-anonymizer";
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
  assert.deepEqual(parseRunnerOptions(["--dry-run", "--strategy", "dedicated-calibrated"]).strategy, "dedicated-calibrated");
  assert.deepEqual(parseRunnerOptions(["--dry-run", "--strategy", "all-three"]).strategy, "all-three");
  assert.throws(() => parseRunnerOptions(["--allow-network", "--strategy", "dedicated-calibrated"]), /new --results-path/);
  assert.deepEqual(
    parseRunnerOptions(["--allow-network", "--strategy", "dedicated-calibrated", "--results-path", "D:\\fresh\\calibrated.json"]).strategy,
    "dedicated-calibrated",
  );
  assert.throws(() => parseRunnerOptions(["--allow-network", "--strategy", "all-three"]), /new --results-path/);
  assert.deepEqual(
    parseRunnerOptions(["--allow-network", "--strategy", "all-three", "--results-path", "D:\\fresh\\comparison.json"]).strategy,
    "all-three",
  );
  assert.deepEqual(parseRunnerOptions(["--allow-network", "--strategy", "both"]).strategy, "both");
  assert.throws(() => parseRunnerOptions(["--allow-network", "--strategy", "unknown"]), /Strategy/);
});

test("legacy both selection is unchanged and all-three selects each strategy once", () => {
  assert.deepEqual(selectedStrategies("both"), ["unified", "dedicated"]);
  assert.deepEqual(selectedStrategies("all-three"), ["unified", "dedicated", "dedicated-calibrated"]);
});

test("network evaluation fails before the executor when the API key is absent", async () => {
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    assert.throws(() => assertOpenRouterApiKey(), /OPENROUTER_API_KEY is required/);
    let executorCalls = 0;
    await assert.rejects(
      runNetworkEvaluation({
        queue: { benchmarkVersion: "semantic-merge-v1", selectionVersion: "lexical-stratified-v1", targetCount: 0, candidateCount: 0, selectedCount: 0, selectionCriteria: [], tierCounts: { high: 0, medium: 0, low: 0 }, cloudCounts: {}, items: [] },
        entries: [],
        clouds: 0,
        callsPerStrategy: 0,
        totalCalls: 0,
        acceptedWordCount: 0,
        inputCharacterCount: 0,
        scorableCases: 0,
        positiveAnnotationCount: 0,
      },
      [],
      "unified",
      undefined,
      async () => { executorCalls += 1; throw new Error("executor must not run"); },
    ),
      /OPENROUTER_API_KEY is required/,
    );
    assert.equal(executorCalls, 0);
  } finally {
    if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalApiKey;
  }
});

test("result status distinguishes complete, partial, and fully failed runs", () => {
  assert.equal(evaluationRunStatus(4, 4, 4), "complete");
  assert.equal(evaluationRunStatus(4, 4, 2), "partial");
  assert.equal(evaluationRunStatus(4, 4, 0), "failed");
  const plan = { totalCalls: 4, clouds: 2, callsPerStrategy: 2 } as unknown as Parameters<typeof buildResultsDocument>[0];
  const result = (successfulResponses: number) => ({ callsAttempted: 4, successfulResponses } as unknown as Parameters<typeof buildResultsDocument>[1][number]);
  assert.equal(buildResultsDocument(plan, [result(0)]).status, "failed");
  assert.equal(buildResultsDocument(plan, [result(2)]).status, "partial");
  assert.equal(buildResultsDocument(plan, [result(4)]).status, "complete");
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

test("all-three plans 27 calls for nine clouds using the same inputs in stable strategy order", () => {
  const exportData = parseCalibrationExport({
    schemaVersion: 1,
    clouds: Array.from({ length: 9 }, (_, index) => syntheticCloud(`cloud-${String(index + 1).padStart(2, "0")}`)),
  });
  const cases = generateAcceptedMergeBenchmarkCases(exportData, "synthetic-runner-salt", {
    enforceAuthorizedScope: false,
  });
  const queue = {
    benchmarkVersion: "semantic-merge-v1" as const,
    selectionVersion: "lexical-stratified-v1" as const,
    targetCount: 0,
    candidateCount: cases.length,
    selectedCount: 0,
    selectionCriteria: [],
    tierCounts: { high: 0, medium: 0, low: 0 } as const,
    cloudCounts: {},
    items: [],
  };
  const plan = planEvaluationCalls(cases, queue, "all-three", []);
  assert.equal(plan.clouds, 9);
  assert.equal(plan.callsPerStrategy, 9);
  assert.equal(plan.totalCalls, 27);
  assert.deepEqual([...new Set(plan.entries.map(({ strategy }) => strategy))], [
    "unified", "dedicated", "dedicated-calibrated",
  ]);
  for (let index = 0; index < plan.clouds; index += 1) {
    const unified: EvaluationPlanEntry = plan.entries[index]!;
    const dedicatedEntry: EvaluationPlanEntry = plan.entries[plan.clouds + index]!;
    const calibratedEntry: EvaluationPlanEntry = plan.entries[plan.clouds * 2 + index]!;
    assert.equal(unified.strategy, "unified");
    assert.equal(dedicatedEntry.strategy, "dedicated");
    assert.equal(calibratedEntry.strategy, "dedicated-calibrated");
    assert.equal(unified.cloudPseudonym, dedicatedEntry.cloudPseudonym);
    assert.equal(unified.cloudPseudonym, calibratedEntry.cloudPseudonym);
    assert.equal(unified.input, dedicatedEntry.input);
    assert.equal(unified.input, calibratedEntry.input);
    assert.deepEqual(unified.input, dedicatedEntry.input);
    assert.deepEqual(unified.input, calibratedEntry.input);
  }
});

test("batch anonymization approval fingerprints remain compatible across two and three strategies", () => {
  const exportData = parseCalibrationExport({
    schemaVersion: 1,
    clouds: Array.from({ length: 9 }, (_, index) => syntheticCloud(`approval-${String(index + 1).padStart(2, "0")}`)),
  });
  const cases = generateAcceptedMergeBenchmarkCases(exportData, "synthetic-approval-salt", {
    enforceAuthorizedScope: false,
  });
  const queue = {
    benchmarkVersion: "semantic-merge-v1" as const,
    selectionVersion: "lexical-stratified-v1" as const,
    targetCount: 0,
    candidateCount: cases.length,
    selectedCount: 0,
    selectionCriteria: [],
    tierCounts: { high: 0, medium: 0, low: 0 } as const,
    cloudCounts: {},
    items: [],
  };
  const dictionary = parseAnonymizationDictionary({ "Safe transport": "[SYNTHETIC_IDEA]" });
  const historicalRaw = planEvaluationCalls(cases, queue, "both", []);
  const historicalReview = anonymizeEvaluationPlan(historicalRaw, dictionary);
  assert.equal(historicalReview.anonymization?.corpusVersion, corpusVersionForInputs(historicalRaw.entries));
  const approvalStore = createBatchApprovalStore(
    historicalReview.anonymizationItems!,
    historicalReview.anonymization!,
    true,
    dictionary,
  );
  const originalStore = JSON.stringify(approvalStore);

  const allThreeRaw = planEvaluationCalls(cases, queue, "all-three", []);
  const allThreeReview = anonymizeEvaluationPlan(allThreeRaw, dictionary);
  assert.equal(allThreeRaw.entries.length, 27);
  assert.equal(allThreeReview.anonymization?.corpusVersion, historicalReview.anonymization?.corpusVersion);
  assert.equal(allThreeReview.anonymization?.rulesFingerprint, historicalReview.anonymization?.rulesFingerprint);
  assert.equal(allThreeReview.anonymization?.dictionaryFingerprint, historicalReview.anonymization?.dictionaryFingerprint);
  assert.equal(allThreeReview.anonymization?.rulesFingerprint, anonymizationRulesFingerprint(dictionary));
  assert.equal(allThreeReview.anonymization?.dictionaryFingerprint, anonymizationDictionaryFingerprint(dictionary));
  assert.equal(allThreeReview.anonymizationItems?.length, historicalReview.anonymizationItems?.length);
  assert.deepEqual(allThreeReview.anonymizationItems, historicalReview.anonymizationItems);
  for (const strategy of ["unified", "dedicated", "dedicated-calibrated"] as const) {
    const singleStrategyReview = anonymizeEvaluationPlan(planEvaluationCalls(cases, queue, strategy, []), dictionary);
    assert.equal(singleStrategyReview.anonymization?.corpusVersion, historicalReview.anonymization?.corpusVersion);
    assert.equal(singleStrategyReview.anonymization?.rulesFingerprint, historicalReview.anonymization?.rulesFingerprint);
    assert.equal(singleStrategyReview.anonymization?.dictionaryFingerprint, historicalReview.anonymization?.dictionaryFingerprint);
  }
  assert.equal(new Set(allThreeReview.anonymizationItems?.map(({ reviewId }) => reviewId)).size, allThreeReview.anonymizationItems?.length);
  assert.equal(
    batchDeclarationFingerprint(
      allThreeReview.anonymizationItems!,
      approvalStore.approvals,
      allThreeReview.anonymization!,
      dictionary,
    ),
    approvalStore.declarationFingerprint,
    "the existing declaration fingerprint must remain compatible",
  );

  const approved = applyAnonymizationApprovalStore(allThreeReview, dictionary, approvalStore);
  assert.equal(approved.anonymization?.approvalComplete, true);
  assert.equal(approved.anonymization?.pendingApprovalCount, 0);
  for (let index = 0; index < 9; index += 1) {
    const unified = approved.entries[index]!;
    const dedicated = approved.entries[9 + index]!;
    const calibrated = approved.entries[18 + index]!;
    assert.equal(unified.cloudPseudonym, dedicated.cloudPseudonym);
    assert.equal(unified.cloudPseudonym, calibrated.cloudPseudonym);
    assert.deepEqual(unified.input.acceptedWords.map(({ id }) => id), dedicated.input.acceptedWords.map(({ id }) => id));
    assert.deepEqual(unified.input.acceptedWords.map(({ id }) => id), calibrated.input.acceptedWords.map(({ id }) => id));
    assert.deepEqual(unified.input, dedicated.input);
    assert.deepEqual(unified.input, calibrated.input);
  }
  assert.equal(JSON.stringify(approvalStore), originalStore, "applying an approval must not mutate the store");

  const changeInputs = (change: (input: TriageInput) => TriageInput) => ({
    ...allThreeRaw,
    entries: allThreeRaw.entries.map((entry) => ({ ...entry, input: change(entry.input) })),
  });
  const changedQuestion = anonymizeEvaluationPlan(changeInputs((input) => ({
    ...input,
    question: `${input.question} updated`,
  })), dictionary);
  assert.notEqual(changedQuestion.anonymization?.corpusVersion, allThreeReview.anonymization?.corpusVersion);
  assert.equal(applyAnonymizationApprovalStore(changedQuestion, dictionary, approvalStore).anonymization?.approvalComplete, false);
  const changedIdea = anonymizeEvaluationPlan(changeInputs((input) => ({
    ...input,
    acceptedWords: input.acceptedWords.map((word, index) => index === 0 ? { ...word, text: `${word.text} updated` } : word),
  })), dictionary);
  assert.notEqual(changedIdea.anonymization?.corpusVersion, allThreeReview.anonymization?.corpusVersion);
  assert.equal(applyAnonymizationApprovalStore(changedIdea, dictionary, approvalStore).anonymization?.approvalComplete, false);

  const changedDictionary = parseAnonymizationDictionary({ "Safe transport": "[OTHER_SYNTHETIC_IDEA]" });
  const changedDictionaryPlan = anonymizeEvaluationPlan(allThreeRaw, changedDictionary);
  assert.notEqual(changedDictionaryPlan.anonymization?.dictionaryFingerprint, allThreeReview.anonymization?.dictionaryFingerprint);
  assert.equal(applyAnonymizationApprovalStore(changedDictionaryPlan, changedDictionary, approvalStore).anonymization?.approvalComplete, false);

  const changedRulesPlan = {
    ...allThreeReview,
    anonymization: { ...allThreeReview.anonymization!, rulesFingerprint: "synthetic-changed-rules" },
  };
  assert.equal(applyAnonymizationApprovalStore(changedRulesPlan, dictionary, approvalStore).anonymization?.approvalComplete, false);
});

test("dedicated strategies share the evaluator while receiving their unchanged prompts", async () => {
  const input: TriageInput = {
    question: "Which ideas improve local transit?",
    acceptedWords: [{ id: "word-a", text: "More bus routes" }, { id: "word-b", text: "Safer stations" }],
    pendingWords: [],
  };
  const entries = (["unified", "dedicated", "dedicated-calibrated"] as const).map((strategy) => ({
    strategy,
    cloudPseudonym: "cloud-pseudonym",
    input,
    queueCaseCount: 1,
    inputCharacterCount: 0,
    anonymizationReviewed: true,
  }));
  const unifiedInputs: typeof input[] = [];
  const dedicatedCalls: Array<{ input: typeof input; instruction: string }> = [];
  const executors = {
    unified: async (receivedInput: TriageInput): Promise<TriageResponse> => {
      unifiedInputs.push(receivedInput);
      return { results: [], acceptedMergeSuggestions: [] };
    },
    withInstruction: async (receivedInput: TriageInput, instruction: string): Promise<TriageResponse> => {
      dedicatedCalls.push({ input: receivedInput, instruction });
      return { results: [], acceptedMergeSuggestions: [] };
    },
  };
  await evaluateStrategy("unified", entries, [], executors);
  await evaluateStrategy("dedicated", entries, [], executors);
  await evaluateStrategy("dedicated-calibrated", entries, [], executors);
  assert.deepEqual(unifiedInputs, [input]);
  assert.deepEqual(dedicatedCalls, [
    { input, instruction: DEDICATED_MERGE_INSTRUCTION },
    { input, instruction: DEDICATED_CALIBRATED_INSTRUCTION },
  ]);
});

test("dedicated-calibrated refuses inputs without reviewed anonymization", async () => {
  const input: TriageInput = {
    question: "Which ideas improve local transit?",
    acceptedWords: [{ id: "word-a", text: "More bus routes" }, { id: "word-b", text: "Safer stations" }],
    pendingWords: [],
  };
  let executorCalls = 0;
  const entry = {
    strategy: "dedicated-calibrated" as const,
    cloudPseudonym: "cloud-pseudonym",
    input,
    queueCaseCount: 1,
    inputCharacterCount: 0,
    anonymizationReviewed: false,
  };
  await assert.rejects(
    evaluateStrategy("dedicated-calibrated", [entry], [], {
      unified: async () => { executorCalls += 1; return { results: [], acceptedMergeSuggestions: [] }; },
      withInstruction: async () => { executorCalls += 1; return { results: [], acceptedMergeSuggestions: [] }; },
    }),
    /reviewed anonymized inputs/,
  );
  assert.equal(executorCalls, 0);
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

test("anonymization sanitizes both strategies without changing pseudonymous ids", () => {
  const plan = anonymizeEvaluationPlan({
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
    entries: ["unified", "dedicated"].map((strategy) => ({
      strategy: strategy as "unified" | "dedicated",
      cloudPseudonym: "cloud-pseudonym",
      input: {
        question: "Como ajudar Alice Silva? alice@example.test",
        acceptedWords: [{ id: "accepted-pseudonym", text: "Escola Aurora" }],
        pendingWords: [],
      },
      queueCaseCount: 0,
      inputCharacterCount: 0,
    })),
    clouds: 1,
    callsPerStrategy: 1,
    totalCalls: 2,
    acceptedWordCount: 2,
    inputCharacterCount: 0,
    scorableCases: 0,
    positiveAnnotationCount: 0,
  }, new Map([["Alice Silva", "[PERSON]"]])) ;
  assert.equal(plan.entries.every((entry) => !entry.input.question.includes("Alice") && !entry.input.question.includes("@")), true);
  assert.equal(plan.entries.every((entry) => entry.input.question.includes("[PERSON]")), true);
  assert.equal(plan.entries.every((entry) => entry.input.acceptedWords[0]?.text.includes("[IDENTIFIER]")), true);
  assert.equal(plan.entries.every((entry) => entry.input.acceptedWords[0]?.id === "accepted-pseudonym"), true);
  assert.equal(plan.entries.every((entry) => entry.anonymizationReviewed), true);
});

test("network executor is blocked until every anonymization item is approved", async () => {
  const plan = anonymizeEvaluationPlan({
    queue: { benchmarkVersion: "semantic-merge-v1", selectionVersion: "lexical-stratified-v1", targetCount: 0, candidateCount: 0, selectedCount: 0, selectionCriteria: [], tierCounts: { high: 0, medium: 0, low: 0 }, cloudCounts: {}, items: [] },
    entries: [{ strategy: "unified", cloudPseudonym: "cloud", input: { question: "Nome: Alice", acceptedWords: [], pendingWords: [] }, queueCaseCount: 0, inputCharacterCount: 0 }],
    clouds: 1, callsPerStrategy: 1, totalCalls: 1, acceptedWordCount: 0, inputCharacterCount: 0, scorableCases: 0, positiveAnnotationCount: 0,
  });
  let calls = 0;
  await assert.rejects(runNetworkEvaluation(plan, [], "unified", undefined, async () => { calls += 1; throw new Error("must not execute"); }), /reviewed anonymized inputs/);
  assert.equal(calls, 0);
});

test("unresolved anonymization risk remains visible and blocks the network executor", async () => {
  const plan = anonymizeEvaluationPlan({
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
    entries: [{
      strategy: "unified",
      cloudPseudonym: "cloud-pseudonym",
      input: { question: "Nome: joao", acceptedWords: [], pendingWords: [] },
      queueCaseCount: 0,
      inputCharacterCount: 0,
    }],
    clouds: 1,
    callsPerStrategy: 1,
    totalCalls: 1,
    acceptedWordCount: 0,
    inputCharacterCount: 0,
    scorableCases: 0,
    positiveAnnotationCount: 0,
  });
  assert.equal(plan.anonymization?.reviewComplete, false);
  await assert.rejects(runNetworkEvaluation(plan, [], "all-three", undefined, async () => { throw new Error("must not execute"); }), /reviewed anonymized inputs/);
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

test("hard-link preflight failure removes probes and prevents the executor", async () => {
  const root = await mkdtemp(join(tmpdir(), "semantic-merge-runner-"));
  try {
    const target = join(root, "results.json");
    await assert.rejects(
      preflightResultsPath(target, {
        linkFile: async () => {
          throw new Error("simulated hard-link failure");
        },
      }),
      /hard links/,
    );
    assert.deepEqual((await readdir(root)).sort(), []);

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
        target,
        async () => {
          calls += 1;
          throw new Error("network must not run");
        },
        async () => {
          throw new Error("simulated hard-link failure");
        },
      ),
      /simulated hard-link failure/,
    );
    assert.equal(calls, 0);
    assert.deepEqual((await readdir(root)).sort(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("safe result publication preserves existing output and writes a complete marker", async () => {
  const root = await mkdtemp(join(tmpdir(), "semantic-merge-runner-"));
  try {
    const target = join(root, "results.json");
    await preflightResultsPath(target);
    assert.deepEqual((await readdir(root)).sort(), []);
    await writeResults(target, { status: "complete", completedCalls: 2 });
    assert.deepEqual(JSON.parse(await readFile(target, "utf8")), { status: "complete", completedCalls: 2 });
    await assert.rejects(writeResults(target, { status: "complete", completedCalls: 99 }), /already exists/);
    assert.deepEqual(JSON.parse(await readFile(target, "utf8")), { status: "complete", completedCalls: 2 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
