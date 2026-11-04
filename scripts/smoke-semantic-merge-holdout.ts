import {
  getOpenRouterTriageFailureDiagnostic,
  triagePendingWords,
  triagePendingWordsForEvaluator,
  type TriageInput,
  type TriageResponse,
} from "../lib/ai/openRouterTriage";
import { getOpenRouterApiKey } from "../lib/ai/openRouterConfig";
import { DEDICATED_MERGE_INSTRUCTION } from "./evaluate-semantic-merges";
import { SEMANTIC_MERGE_HOLDOUT_AUDIT } from "./semantic-merge-holdout-audit";
import { SEMANTIC_MERGE_HOLDOUT_CASES } from "./semantic-merge-holdout-fixtures";
import { DEDICATED_CALIBRATED_INSTRUCTION } from "./smoke-semantic-merge";

export const SEMANTIC_MERGE_HOLDOUT_STRATEGIES = [
  "unified",
  "dedicated",
  "dedicated-calibrated",
] as const;

export type SemanticMergeHoldoutStrategy = typeof SEMANTIC_MERGE_HOLDOUT_STRATEGIES[number];
export type SemanticMergeHoldoutCase = typeof SEMANTIC_MERGE_HOLDOUT_CASES[number];

export type SemanticMergeHoldoutExecutors = Readonly<{
  unified: (input: TriageInput) => Promise<TriageResponse>;
  withInstruction: (input: TriageInput, instruction: string) => Promise<TriageResponse>;
}>;

export type SemanticMergeHoldoutOptions = Readonly<{ allowNetwork: boolean }>;

export type SemanticMergeHoldoutResult = Readonly<{
  caseId: string;
  strategy: SemanticMergeHoldoutStrategy;
  status: "valid" | "invalid_response" | "technical_failure";
  suggestedPairs: readonly (readonly [string, string])[];
  diagnostic?: string;
}>;

export type SemanticMergeHoldoutSummary = Readonly<{
  strategy: SemanticMergeHoldoutStrategy;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  invalidResponses: number;
  technicalFailures: number;
  scoredCalls: number;
}>;

const DEFAULT_EXECUTORS: SemanticMergeHoldoutExecutors = {
  unified: triagePendingWords,
  withInstruction: (input, instruction) => triagePendingWordsForEvaluator(input, instruction),
};

const INVALID_RESPONSE_CODES = new Set([
  "provider_invalid_json",
  "provider_missing_content",
  "provider_structured_json_invalid",
  "provider_result_incomplete",
  "provider_result_invalid",
]);

export function parseSemanticMergeHoldoutOptions(args: readonly string[]): SemanticMergeHoldoutOptions {
  if (args.length === 0) return { allowNetwork: false };
  if (args.length === 1 && args[0] === "--allow-network") return { allowNetwork: true };
  throw new Error("Usage: smoke-semantic-merge-holdout.ts [--allow-network]");
}

export function renderSemanticMergeHoldoutPlan(): string {
  return [
    "SEMANTIC_MERGE_HOLDOUT_PLAN",
    "network_enabled=false",
    `planned_calls=${SEMANTIC_MERGE_HOLDOUT_CASES.length * SEMANTIC_MERGE_HOLDOUT_STRATEGIES.length}`,
    `cases=${SEMANTIC_MERGE_HOLDOUT_CASES.map(({ caseId }) => caseId).join(",")}`,
    `strategies=${SEMANTIC_MERGE_HOLDOUT_STRATEGIES.join(",")}`,
    "case_text_printed=false",
    "audit_justifications_printed=false",
    "retries=0",
  ].join("\n");
}

export function evaluateSemanticMergeHoldoutStrategy(
  input: TriageInput,
  strategy: SemanticMergeHoldoutStrategy,
  executors: SemanticMergeHoldoutExecutors = DEFAULT_EXECUTORS,
): Promise<TriageResponse> {
  if (strategy === "unified") return executors.unified(input);
  const instruction = strategy === "dedicated"
    ? DEDICATED_MERGE_INSTRUCTION
    : DEDICATED_CALIBRATED_INSTRUCTION;
  return executors.withInstruction(input, instruction);
}

export function assertSemanticMergeHoldoutApiKey(hasApiKey: () => boolean = () => Boolean(getOpenRouterApiKey())): void {
  if (!hasApiKey()) throw new Error("OPENROUTER_API_KEY is required for the authorized semantic merge holdout smoke test.");
}

export async function runSemanticMergeHoldout(
  options: SemanticMergeHoldoutOptions,
  evaluate: (smokeCase: SemanticMergeHoldoutCase, strategy: SemanticMergeHoldoutStrategy) => Promise<TriageResponse> =
    (smokeCase, strategy) => evaluateSemanticMergeHoldoutStrategy(smokeCase.input, strategy),
  hasApiKey: () => boolean = () => Boolean(getOpenRouterApiKey()),
): Promise<readonly SemanticMergeHoldoutResult[]> {
  if (!options.allowNetwork) return [];
  assertSemanticMergeHoldoutApiKey(hasApiKey);

  const results: SemanticMergeHoldoutResult[] = [];
  for (const smokeCase of SEMANTIC_MERGE_HOLDOUT_CASES) {
    for (const strategy of SEMANTIC_MERGE_HOLDOUT_STRATEGIES) {
      try {
        const response = await evaluate(smokeCase, strategy);
        const suggestedPairs = response.acceptedMergeSuggestions.map(({ firstId, secondId }) => [firstId, secondId] as const);
        results.push({ caseId: smokeCase.caseId, strategy, status: "valid", suggestedPairs });
      } catch (error: unknown) {
        const diagnostic = getOpenRouterTriageFailureDiagnostic(error);
        const status = INVALID_RESPONSE_CODES.has(diagnostic.code) ? "invalid_response" : "technical_failure";
        results.push({
          caseId: smokeCase.caseId,
          strategy,
          status,
          suggestedPairs: [],
          diagnostic: diagnostic.code === "provider_result_invalid"
            ? `${diagnostic.code}:${diagnostic.validationReason}`
            : diagnostic.code,
        });
      }
    }
  }
  return results;
}

function pairIdentity([firstId, secondId]: readonly [string, string]): string {
  const [first, second] = [firstId, secondId].sort();
  return `${first}\u0000${second}`;
}

export function scoreSemanticMergeHoldout(
  results: readonly SemanticMergeHoldoutResult[],
): readonly SemanticMergeHoldoutSummary[] {
  return SEMANTIC_MERGE_HOLDOUT_STRATEGIES.map((strategy) => {
    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;
    let invalidResponses = 0;
    let technicalFailures = 0;
    let scoredCalls = 0;

    for (const result of results) {
      if (result.strategy !== strategy) continue;
      if (result.status === "invalid_response") {
        invalidResponses += 1;
        continue;
      }
      if (result.status === "technical_failure") {
        technicalFailures += 1;
        continue;
      }

      scoredCalls += 1;
      const audit = SEMANTIC_MERGE_HOLDOUT_AUDIT.find(({ caseId }) => caseId === result.caseId);
      if (!audit) continue;
      const expectedPairs = new Set(audit.expectedPairs.map((pair) => pairIdentity(pair)));
      const suggestedPairs = new Set(result.suggestedPairs.map((pair) => pairIdentity(pair)));
      for (const identity of expectedPairs) {
        if (suggestedPairs.has(identity)) truePositives += 1;
        else falseNegatives += 1;
      }
      for (const identity of suggestedPairs) {
        if (!expectedPairs.has(identity)) falsePositives += 1;
      }
    }

    return { strategy, truePositives, falsePositives, falseNegatives, invalidResponses, technicalFailures, scoredCalls };
  });
}

export function renderSemanticMergeHoldoutResult(result: SemanticMergeHoldoutResult): string {
  const pairs = result.suggestedPairs.map(([firstId, secondId]) => `${firstId}/${secondId}`).join(",") || "none";
  return [
    `case=${result.caseId}`,
    `strategy=${result.strategy}`,
    `status=${result.status}`,
    `pairs=${pairs}`,
    `diagnostic=${result.diagnostic ?? "none"}`,
  ].join(" ");
}

export function renderSemanticMergeHoldoutSummary(summary: SemanticMergeHoldoutSummary): string {
  return [
    `strategy=${summary.strategy}`,
    `tp=${summary.truePositives}`,
    `fp=${summary.falsePositives}`,
    `fn=${summary.falseNegatives}`,
    `invalid_responses=${summary.invalidResponses}`,
    `technical_failures=${summary.technicalFailures}`,
    `scored_calls=${summary.scoredCalls}`,
  ].join(" ");
}

async function main(): Promise<void> {
  const options = parseSemanticMergeHoldoutOptions(process.argv.slice(2));
  if (!options.allowNetwork) {
    console.log(renderSemanticMergeHoldoutPlan());
    return;
  }

  const results = await runSemanticMergeHoldout(options);
  for (const result of results) console.log(renderSemanticMergeHoldoutResult(result));
  for (const summary of scoreSemanticMergeHoldout(results)) console.log(renderSemanticMergeHoldoutSummary(summary));
}

if (process.argv[1]?.endsWith("smoke-semantic-merge-holdout.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error && error.message.startsWith("Usage:")
      ? "error=invalid_arguments"
      : error instanceof Error && error.message.startsWith("OPENROUTER_API_KEY is required")
        ? "error=missing_api_key"
        : "error=holdout_smoke_failed");
    process.exitCode = 1;
  });
}
