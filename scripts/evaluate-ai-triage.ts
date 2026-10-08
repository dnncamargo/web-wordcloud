import {
  getOpenRouterTriageFailureDiagnostic,
  OPENROUTER_TRIAGE_REQUEST_OPTIONS,
  triagePendingWords,
  triagePendingWordsForEvaluator,
} from "../lib/ai/openRouterTriage";
import { getOpenRouterModel } from "../lib/ai/openRouterConfig";
import {
  validateTriageInput,
  type TriageResponse,
  type TriageResult,
} from "../lib/ai/triage-contract";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CALIBRATION_B_INSTRUCTION } from "./ai-calibration-b";
import {
  EVALUATION_FIXTURE_VERSION,
  evaluationScenarios,
  type EvaluationScenario,
  type MergePair,
} from "./ai-triage-fixtures-v2";

type CalibrationId = "A" | "B";
type CalibrationSelection = CalibrationId | "both";

type EvaluationOptions = Readonly<{
  mode: "dry-run" | "allow-network";
  calibration: CalibrationSelection;
}>;

type CapabilityName = "relevance" | "attention" | "spelling" | "acceptedMerges";

export type Metric = {
  checks: number;
  passed: number;
  failed: number;
  failures: string[];
};

type CalibrationSpec = Readonly<{
  id: CalibrationId;
  label: string;
  instructionSource: string;
}>;

const CALIBRATIONS: readonly CalibrationSpec[] = [
  {
    id: "A",
    label: "Calibration A (production baseline)",
    instructionSource: "lib/ai/openRouterTriage.ts",
  },
  {
    id: "B",
    label: "Calibration B (experiment-only)",
    instructionSource: "scripts/ai-calibration-b.ts",
  },
];

const CAPABILITIES: readonly CapabilityName[] = [
  "relevance",
  "attention",
  "spelling",
  "acceptedMerges",
];

function createMetric(): Metric {
  return { checks: 0, passed: 0, failed: 0, failures: [] };
}

function addCheck(metric: Metric, passed: boolean, failure: string): void {
  metric.checks += 1;

  if (passed) {
    metric.passed += 1;
    return;
  }

  metric.failed += 1;
  metric.failures.push(failure);
}

function pairKey(pair: MergePair): string {
  return [...pair].sort().join("\u0000");
}

function displayPair(pair: MergePair): string {
  return `(${pair[0]}, ${pair[1]})`;
}

function formatNullable(value: string | null): string {
  return value === null ? "null" : JSON.stringify(value);
}

export function spellingSuggestionMatches(
  observed: string | null,
  expected: string | null,
): boolean {
  if (observed === null || expected === null) return observed === expected;

  return (
    observed.toLocaleLowerCase("pt-BR") ===
    expected.toLocaleLowerCase("pt-BR")
  );
}

function resultById(results: readonly TriageResult[], id: string): TriageResult {
  const result = results.find((item) => item.id === id);

  if (!result) throw new Error(`Missing result for ${id}.`);

  return result;
}

function evaluateRelevance(
  scenario: EvaluationScenario,
  response: TriageResponse,
): Metric {
  const metric = createMetric();

  for (const [higherId, lowerId] of scenario.expectations.relevance) {
    const higher = resultById(response.results, higherId).relevance;
    const lower = resultById(response.results, lowerId).relevance;

    addCheck(
      metric,
      higher > lower,
      `${higherId} relevance (${higher}) must be greater than ${lowerId} relevance (${lower})`,
    );
  }

  return metric;
}

function evaluateAttention(
  scenario: EvaluationScenario,
  response: TriageResponse,
): Metric {
  const metric = createMetric();
  const expectations = scenario.expectations.attention;

  for (const id of expectations.expectedTrue) {
    addCheck(
      metric,
      resultById(response.results, id).attention === true,
      `${id} must have attention=true`,
    );
  }

  for (const id of expectations.expectedFalse) {
    addCheck(
      metric,
      resultById(response.results, id).attention === false,
      `${id} must have attention=false`,
    );
  }

  return metric;
}

export function evaluateSpelling(
  scenario: EvaluationScenario,
  response: TriageResponse,
): Metric {
  const metric = createMetric();

  for (const [id, expected] of Object.entries(scenario.expectations.spelling)) {
    const observed = resultById(response.results, id).spellingSuggestion;

    addCheck(
      metric,
      spellingSuggestionMatches(observed, expected),
      `${id} spellingSuggestion observed=${formatNullable(observed)} expected=${formatNullable(expected)}`,
    );
  }

  return metric;
}

export function evaluateAcceptedMerges(
  scenario: EvaluationScenario,
  response: TriageResponse,
): Metric {
  const metric = createMetric();
  const expectations = scenario.expectations.acceptedMerges;
  const counts = new Map<string, number>();
  const representativePairs = new Map<string, MergePair>();

  for (const suggestion of response.acceptedMergeSuggestions) {
    const pair: MergePair = [suggestion.firstId, suggestion.secondId];
    const key = pairKey(pair);

    counts.set(key, (counts.get(key) ?? 0) + 1);
    representativePairs.set(key, pair);
  }

  for (const requiredPair of expectations.requiredPairs) {
    addCheck(
      metric,
      counts.has(pairKey(requiredPair)),
      `required merge ${displayPair(requiredPair)} is missing`,
    );
  }

  for (const forbiddenPair of expectations.forbiddenPairs) {
    addCheck(
      metric,
      !counts.has(pairKey(forbiddenPair)),
      `forbidden merge ${displayPair(forbiddenPair)} was suggested`,
    );
  }

  const allowedKeys = new Set(expectations.allowedPairs.map(pairKey));

  for (const [key, pair] of representativePairs) {
    addCheck(
      metric,
      allowedKeys.has(key),
      `unexpected merge ${displayPair(pair)} was suggested`,
    );
  }

  const duplicatePairs = [...counts.entries()].filter(([, count]) => count > 1);
  addCheck(
    metric,
    duplicatePairs.length === 0,
    duplicatePairs.length === 0
      ? ""
      : `duplicate merge pairs: ${duplicatePairs.map(([key]) => key).join(", ")}`,
  );

  addCheck(
    metric,
    representativePairs.size <= expectations.maxSuggestions,
    `merge suggestion count ${representativePairs.size} exceeds maximum ${expectations.maxSuggestions}`,
  );

  return metric;
}

function evaluateScenario(
  scenario: EvaluationScenario,
  response: TriageResponse,
): Readonly<Record<CapabilityName, Metric>> {
  return {
    relevance: evaluateRelevance(scenario, response),
    attention: evaluateAttention(scenario, response),
    spelling: evaluateSpelling(scenario, response),
    acceptedMerges: evaluateAcceptedMerges(scenario, response),
  };
}

function mergeMetrics(target: Metric, source: Metric): void {
  target.checks += source.checks;
  target.passed += source.passed;
  target.failed += source.failed;
  target.failures.push(...source.failures);
}

function validatePairExpectations(
  scenario: EvaluationScenario,
  field: string,
  pairs: readonly MergePair[],
): void {
  const acceptedIds = new Set(scenario.input.acceptedWords.map((word) => word.id));
  const seen = new Set<string>();

  for (const pair of pairs) {
    if (
      pair.length !== 2 ||
      pair[0] === pair[1] ||
      !acceptedIds.has(pair[0]) ||
      !acceptedIds.has(pair[1])
    ) {
      throw new Error(`Invalid ${field} pair in scenario ${scenario.id}.`);
    }

    const key = pairKey(pair);

    if (seen.has(key)) throw new Error(`Duplicate ${field} pair in scenario ${scenario.id}.`);

    seen.add(key);
  }
}

function validateFixtures(): void {
  const scenarioIds = new Set<string>();

  for (const scenario of evaluationScenarios) {
    if (scenarioIds.has(scenario.id) || scenario.id.trim().length === 0) {
      throw new Error(`Invalid or duplicate scenario id: ${scenario.id}.`);
    }

    scenarioIds.add(scenario.id);
    validateTriageInput(scenario.input);

    const pendingIds = new Set(scenario.input.pendingWords.map((word) => word.id));

    for (const id of [
      ...scenario.expectations.attention.expectedTrue,
      ...scenario.expectations.attention.expectedFalse,
      ...Object.keys(scenario.expectations.spelling),
    ]) {
      if (!pendingIds.has(id)) {
        throw new Error(`Expectation ${id} is not a pending word in ${scenario.id}.`);
      }
    }

    validatePairExpectations(
      scenario,
      "required merge",
      scenario.expectations.acceptedMerges.requiredPairs,
    );
    validatePairExpectations(
      scenario,
      "forbidden merge",
      scenario.expectations.acceptedMerges.forbiddenPairs,
    );
    validatePairExpectations(
      scenario,
      "allowed merge",
      scenario.expectations.acceptedMerges.allowedPairs,
    );

    const requiredKeys = new Set(
      scenario.expectations.acceptedMerges.requiredPairs.map(pairKey),
    );
    const forbiddenKeys = new Set(
      scenario.expectations.acceptedMerges.forbiddenPairs.map(pairKey),
    );
    const allowedKeys = new Set(
      scenario.expectations.acceptedMerges.allowedPairs.map(pairKey),
    );

    for (const key of requiredKeys) {
      if (!allowedKeys.has(key)) {
        throw new Error(`Required merge is not allowed in ${scenario.id}.`);
      }
    }

    for (const key of forbiddenKeys) {
      if (allowedKeys.has(key)) {
        throw new Error(`Forbidden merge is allowed in ${scenario.id}.`);
      }
    }

    if (scenario.expectations.acceptedMerges.maxSuggestions < 0) {
      throw new Error(`Invalid merge maximum in ${scenario.id}.`);
    }
  }
}

function parseCalibration(value: string): CalibrationSelection {
  const normalized = value.toUpperCase();

  if (normalized === "A" || normalized === "B" || normalized === "BOTH") {
    return normalized === "BOTH" ? "both" : normalized;
  }

  throw new Error("Calibration must be A, B, or both.");
}

function parseOptions(): EvaluationOptions {
  const args = process.argv.slice(2);
  let mode: EvaluationOptions["mode"] | null = null;
  let calibration: CalibrationSelection = "both";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--dry-run") {
      if (mode !== null) throw new Error("Choose exactly one evaluation mode.");
      mode = "dry-run";
      continue;
    }

    if (arg === "--allow-network") {
      if (mode !== null) throw new Error("Choose exactly one evaluation mode.");
      mode = "allow-network";
      continue;
    }

    if (arg === "--calibration") {
      const value = args[index + 1];

      if (!value) throw new Error("Missing value for --calibration.");

      calibration = parseCalibration(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--calibration=")) {
      calibration = parseCalibration(arg.slice("--calibration=".length));
      continue;
    }

    throw new Error(
      "Usage: npm run ai:evaluate -- --dry-run|--allow-network [--calibration A|B|both]",
    );
  }

  if (mode === null) {
    throw new Error(
      "Usage: npm run ai:evaluate -- --dry-run|--allow-network [--calibration A|B|both]",
    );
  }

  return { mode, calibration };
}

function selectedCalibrations(selection: CalibrationSelection): readonly CalibrationSpec[] {
  return selection === "both"
    ? CALIBRATIONS
    : CALIBRATIONS.filter((calibration) => calibration.id === selection);
}

function printScenarioExpectations(scenario: EvaluationScenario): void {
  const expectations = scenario.expectations;

  console.log(`\nSCENARIO ${scenario.id} — ${scenario.name}`);
  console.log(`question=${JSON.stringify(scenario.input.question)}`);

  console.log(
    `relevance expectations=${expectations.relevance
      .map(([higher, lower]) => `${higher}>${lower}`)
      .join(", ") || "none"}`,
  );
  console.log(
    `attention expectations=true:${expectations.attention.expectedTrue.join(",") || "none"} false:${expectations.attention.expectedFalse.join(",") || "none"}`,
  );
  console.log(
    `spelling expectations=${Object.entries(expectations.spelling)
      .map(([id, value]) => `${id}=${formatNullable(value)}`)
      .join(", ") || "none"}`,
  );

  const merges = expectations.acceptedMerges;

  console.log(
    `accepted merges required=${merges.requiredPairs.map(displayPair).join(", ") || "none"}`,
  );
  console.log(
    `accepted merges forbidden=${merges.forbiddenPairs.map(displayPair).join(", ") || "none"}`,
  );
  console.log(
    `accepted merges allowed=${merges.allowedPairs.map(displayPair).join(", ") || "none"}`,
  );
  console.log(`accepted merges max=${merges.maxSuggestions}`);
}

function printIndividualResults(
  scenario: EvaluationScenario,
  response: TriageResponse,
): void {
  console.log("results:");

  for (const pendingWord of scenario.input.pendingWords) {
    const result = resultById(response.results, pendingWord.id);

    console.log(
      `- id=${pendingWord.id} text=${JSON.stringify(pendingWord.text)} relevance=${result.relevance} attention=${result.attention} spellingSuggestion=${formatNullable(result.spellingSuggestion)}`,
    );
  }

  const acceptedWordsById = new Map(
    scenario.input.acceptedWords.map((word) => [word.id, word.text]),
  );

  console.log("acceptedMergeSuggestions:");

  if (response.acceptedMergeSuggestions.length === 0) {
    console.log("- none");
    return;
  }

  for (const suggestion of response.acceptedMergeSuggestions) {
    const firstText = acceptedWordsById.get(suggestion.firstId) ?? "<unknown>";
    const secondText = acceptedWordsById.get(suggestion.secondId) ?? "<unknown>";

    console.log(
      `- (${suggestion.firstId}=${JSON.stringify(firstText)}) <-> (${suggestion.secondId}=${JSON.stringify(secondText)})`,
    );
  }
}

function printDryRun(options: EvaluationOptions): void {
  const calibrations = selectedCalibrations(options.calibration);

  console.log("EVALUATION CONFIG");
  console.log(`mode=${options.mode}`);
  console.log(`calibrations=${calibrations.map(({ id }) => id).join(",")}`);
  console.log(`model=${getOpenRouterModel()}`);
  console.log(`fixtures=${EVALUATION_FIXTURE_VERSION}`);
  console.log(`temperature=${OPENROUTER_TRIAGE_REQUEST_OPTIONS.temperature}`);
  console.log(
    `max_completion_tokens=${OPENROUTER_TRIAGE_REQUEST_OPTIONS.max_completion_tokens}`,
  );
  console.log(`reasoning_effort=${OPENROUTER_TRIAGE_REQUEST_OPTIONS.reasoning_effort}`);
  console.log(`provider_zdr=${OPENROUTER_TRIAGE_REQUEST_OPTIONS.provider.zdr}`);
  console.log(
    `provider_data_collection=${OPENROUTER_TRIAGE_REQUEST_OPTIONS.provider.data_collection}`,
  );
  console.log(
    `provider_require_parameters=${OPENROUTER_TRIAGE_REQUEST_OPTIONS.provider.require_parameters}`,
  );
  console.log("openrouter_calls=0");

  for (const calibration of calibrations) {
    console.log(`\nCALIBRATION ${calibration.id} — ${calibration.label}`);
    console.log(`instruction_source=${calibration.instructionSource}`);

    for (const scenario of evaluationScenarios) {
      printScenarioExpectations(scenario);
    }
  }
}

function printMetric(capability: CapabilityName, metric: Metric): void {
  console.log(
    `${capability} checks=${metric.checks} pass=${metric.passed} fail=${metric.failed}`,
  );

  for (const failure of metric.failures) {
    console.log(`  FAIL ${failure}`);
  }
}

function printTotals(
  calibration: CalibrationSpec,
  totals: Readonly<Record<CapabilityName, Metric>>,
  openRouterCalls: number,
  providerFailures: number,
): void {
  console.log(`\nTOTAL ${calibration.id}`);

  for (const capability of CAPABILITIES) {
    printMetric(capability, totals[capability]);
  }

  console.log(`provider_failures=${providerFailures}`);
  console.log(`openrouter_calls=${openRouterCalls}`);
}

async function runCalibration(calibration: CalibrationSpec): Promise<boolean> {
  const totals: Record<CapabilityName, Metric> = {
    relevance: createMetric(),
    attention: createMetric(),
    spelling: createMetric(),
    acceptedMerges: createMetric(),
  };
  let openRouterCalls = 0;
  let providerFailures = 0;

  console.log(`\nCALIBRATION ${calibration.id} — ${calibration.label}`);

  for (const scenario of evaluationScenarios) {
    openRouterCalls += 1;

    try {
      const response =
        calibration.id === "A"
          ? await triagePendingWords(scenario.input)
          : await triagePendingWordsForEvaluator(
              scenario.input,
              CALIBRATION_B_INSTRUCTION,
            );
      const metrics = evaluateScenario(scenario, response);

      printScenarioExpectations(scenario);
      printIndividualResults(scenario, response);

      for (const capability of CAPABILITIES) {
        mergeMetrics(totals[capability], metrics[capability]);
        printMetric(capability, metrics[capability]);
      }
    } catch (error: unknown) {
      providerFailures += 1;
      const diagnostic = getOpenRouterTriageFailureDiagnostic(error);
      console.log(
        `\nSCENARIO ${scenario.id} — provider failure code=${diagnostic.code}`,
      );
      if (diagnostic.validationReason) {
        console.log(`validation_reason=${diagnostic.validationReason}`);
      }
    }
  }

  printTotals(calibration, totals, openRouterCalls, providerFailures);

  return (
    providerFailures === 0 &&
    CAPABILITIES.every((capability) => totals[capability].failed === 0)
  );
}

async function main(): Promise<void> {
  const options = parseOptions();
  validateFixtures();

  if (options.mode === "dry-run") {
    printDryRun(options);
    return;
  }

  const outcomes = [];

  for (const calibration of selectedCalibrations(options.calibration)) {
    outcomes.push(await runCalibration(calibration));
  }

  console.log(`\nEVALUATION RESULT=${outcomes.every(Boolean) ? "PASS" : "FAIL"}`);

  if (!outcomes.every(Boolean)) {
    throw new Error("One or more calibration evaluations failed.");
  }
}

const isMainModule =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMainModule) {
  main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown evaluation failure.";
    console.error(`EVALUATION FAILED: ${message}`);
    process.exitCode = 1;
  });
}
