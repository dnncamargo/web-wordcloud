import type { TriageResponse } from "../lib/ai/openRouterTriage";
import { getOpenRouterApiKey } from "../lib/ai/openRouterConfig";
import {
  assertSemanticMergeHoldoutApiKey,
  classifySemanticMergeHoldoutFailure,
  evaluateSemanticMergeHoldoutStrategy,
  SEMANTIC_MERGE_HOLDOUT_STRATEGIES,
  type SemanticMergeHoldoutStrategy,
} from "./smoke-semantic-merge-holdout";
import { SEMANTIC_MERGE_PTBR_AUDIT } from "./semantic-merge-ptbr-audit";
import { SEMANTIC_MERGE_PTBR_CASES } from "./semantic-merge-ptbr-fixtures";

export type SemanticMergePtbrCase = typeof SEMANTIC_MERGE_PTBR_CASES[number];

export type SemanticMergePtbrResult = Readonly<{
  caseId: string;
  strategy: SemanticMergeHoldoutStrategy;
  status: "valid" | "invalid_response" | "technical_failure";
  suggestedPairs: readonly (readonly [string, string])[];
  diagnostic?: string;
}>;

export type SemanticMergePtbrSummary = Readonly<{
  strategy: SemanticMergeHoldoutStrategy;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  invalidResponses: number;
  technicalFailures: number;
  validCalls: number;
}>;

export type SemanticMergePtbrOptions = Readonly<{ allowNetwork: boolean }>;

export function parseSemanticMergePtbrOptions(args: readonly string[]): SemanticMergePtbrOptions {
  if (args.length === 0) return { allowNetwork: false };
  if (args.length === 1 && args[0] === "--allow-network") return { allowNetwork: true };
  throw new Error("Usage: smoke-semantic-merge-ptbr.ts [--allow-network]");
}

export function renderSemanticMergePtbrPlan(): string {
  return [
    "SEMANTIC_MERGE_PTBR_PLAN",
    "network_enabled=false",
    `planned_calls=${SEMANTIC_MERGE_PTBR_CASES.length * SEMANTIC_MERGE_HOLDOUT_STRATEGIES.length}`,
    `cases=${SEMANTIC_MERGE_PTBR_CASES.map(({ caseId }) => caseId).join(",")}`,
    `strategies=${SEMANTIC_MERGE_HOLDOUT_STRATEGIES.join(",")}`,
    "case_text_printed=false",
    "audit_justifications_printed=false",
    "retries=0",
  ].join("\n");
}

export async function runSemanticMergePtbr(
  options: SemanticMergePtbrOptions,
  evaluate: (smokeCase: SemanticMergePtbrCase, strategy: SemanticMergeHoldoutStrategy) => Promise<TriageResponse> =
    (smokeCase, strategy) => evaluateSemanticMergeHoldoutStrategy(smokeCase.input, strategy),
  hasApiKey: () => boolean = () => Boolean(getOpenRouterApiKey()),
): Promise<readonly SemanticMergePtbrResult[]> {
  if (!options.allowNetwork) return [];
  assertSemanticMergeHoldoutApiKey(hasApiKey);

  const results: SemanticMergePtbrResult[] = [];
  for (const smokeCase of SEMANTIC_MERGE_PTBR_CASES) {
    for (const strategy of SEMANTIC_MERGE_HOLDOUT_STRATEGIES) {
      try {
        const response = await evaluate(smokeCase, strategy);
        const suggestedPairs = response.acceptedMergeSuggestions.map(({ firstId, secondId }) => [firstId, secondId] as const);
        results.push({ caseId: smokeCase.caseId, strategy, status: "valid", suggestedPairs });
      } catch (error: unknown) {
        const failure = classifySemanticMergeHoldoutFailure(error);
        results.push({
          caseId: smokeCase.caseId,
          strategy,
          status: failure.status,
          suggestedPairs: [],
          diagnostic: failure.diagnostic,
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

export function scoreSemanticMergePtbr(
  results: readonly SemanticMergePtbrResult[],
): readonly SemanticMergePtbrSummary[] {
  return SEMANTIC_MERGE_HOLDOUT_STRATEGIES.map((strategy) => {
    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;
    let invalidResponses = 0;
    let technicalFailures = 0;
    let validCalls = 0;

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

      validCalls += 1;
      const audit = SEMANTIC_MERGE_PTBR_AUDIT.find(({ caseId }) => caseId === result.caseId);
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

    return { strategy, truePositives, falsePositives, falseNegatives, invalidResponses, technicalFailures, validCalls };
  });
}

export function renderSemanticMergePtbrResult(result: SemanticMergePtbrResult): string {
  const pairs = result.suggestedPairs.map(([firstId, secondId]) => `${firstId}/${secondId}`).join(",") || "none";
  return [
    `case=${result.caseId}`,
    `strategy=${result.strategy}`,
    `status=${result.status}`,
    `pairs=${pairs}`,
    `diagnostic=${result.diagnostic ?? "none"}`,
  ].join(" ");
}

export function renderSemanticMergePtbrSummary(summary: SemanticMergePtbrSummary): string {
  return [
    `strategy=${summary.strategy}`,
    `tp=${summary.truePositives}`,
    `fp=${summary.falsePositives}`,
    `fn=${summary.falseNegatives}`,
    `invalid_responses=${summary.invalidResponses}`,
    `technical_failures=${summary.technicalFailures}`,
    `valid_calls=${summary.validCalls}`,
  ].join(" ");
}

async function main(): Promise<void> {
  const options = parseSemanticMergePtbrOptions(process.argv.slice(2));
  if (!options.allowNetwork) {
    console.log(renderSemanticMergePtbrPlan());
    return;
  }

  const results = await runSemanticMergePtbr(options);
  for (const result of results) console.log(renderSemanticMergePtbrResult(result));
  for (const summary of scoreSemanticMergePtbr(results)) console.log(renderSemanticMergePtbrSummary(summary));
}

if (process.argv[1]?.endsWith("smoke-semantic-merge-ptbr.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error && error.message.startsWith("Usage:")
      ? "error=invalid_arguments"
      : error instanceof Error && error.message.startsWith("OPENROUTER_API_KEY is required")
        ? "error=missing_api_key"
        : "error=ptbr_smoke_failed");
    process.exitCode = 1;
  });
}
