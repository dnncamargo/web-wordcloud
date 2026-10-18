import {
  getOpenRouterTriageFailureDiagnostic,
  triagePendingWords,
  triagePendingWordsForEvaluator,
  type TriageInput,
  type TriageResponse,
} from "../lib/ai/openRouterTriage";
import { DEDICATED_MERGE_INSTRUCTION } from "./evaluate-semantic-merges";

export const SYNTHETIC_SMOKE_INPUT: TriageInput = {
  question: "Como a escola pode reduzir seu impacto ambiental?",
  acceptedWords: [
    { id: "idea-a", text: "Criar uma horta comunitária na escola." },
    { id: "idea-b", text: "Montar uma horta coletiva na escola." },
    { id: "idea-c", text: "Instalar painéis solares no telhado da escola." },
  ],
  pendingWords: [],
};

export const SYNTHETIC_EXPECTED_PAIR = ["idea-a", "idea-b"] as const;
export const SYNTHETIC_SMOKE_STRATEGIES = ["unified", "dedicated"] as const;

export type SyntheticSmokeStrategy = typeof SYNTHETIC_SMOKE_STRATEGIES[number];

export type SyntheticSmokeResult = Readonly<{
  strategy: SyntheticSmokeStrategy;
  suggestionCount: number;
  suggestedPairs: readonly (readonly [string, string])[];
  expectedPairPresent: boolean;
  error?: string;
}>;

export type SyntheticSmokeOptions = Readonly<{
  allowNetwork: boolean;
}>;

type SmokeEvaluator = (strategy: SyntheticSmokeStrategy) => Promise<TriageResponse>;

export function parseSyntheticSmokeOptions(args: readonly string[]): SyntheticSmokeOptions {
  if (args.length === 0) return { allowNetwork: false };
  if (args.length === 1 && args[0] === "--allow-network") return { allowNetwork: true };
  throw new Error("Usage: smoke-semantic-merge.ts [--allow-network]");
}

export function renderSyntheticSmokePlan(): string {
  return [
    "SEMANTIC_MERGE_SMOKE_PLAN",
    "network_enabled=false",
    "planned_calls=2",
    "strategies=unified,dedicated",
    "accepted_word_ids=idea-a,idea-b,idea-c",
    "expected_pair=idea-a/idea-b",
    "corpus_loaded=false",
    "results_printed=metadata_only",
  ].join("\n");
}

function pairIsExpected(firstId: string, secondId: string): boolean {
  return (firstId === SYNTHETIC_EXPECTED_PAIR[0] && secondId === SYNTHETIC_EXPECTED_PAIR[1]) ||
    (firstId === SYNTHETIC_EXPECTED_PAIR[1] && secondId === SYNTHETIC_EXPECTED_PAIR[0]);
}

export function renderSyntheticSmokeResult(result: SyntheticSmokeResult): string {
  const pairs = result.suggestedPairs.map(([firstId, secondId]) => `${firstId}/${secondId}`).join(",") || "none";
  return [
    `strategy=${result.strategy}`,
    `suggestions=${result.suggestionCount}`,
    `pairs=${pairs}`,
    `expected_pair_present=${result.expectedPairPresent}`,
    `error=${result.error ?? "none"}`,
  ].join(" ");
}

async function evaluateSyntheticStrategy(strategy: SyntheticSmokeStrategy): Promise<TriageResponse> {
  return strategy === "unified"
    ? triagePendingWords(SYNTHETIC_SMOKE_INPUT)
    : triagePendingWordsForEvaluator(SYNTHETIC_SMOKE_INPUT, DEDICATED_MERGE_INSTRUCTION);
}

export async function runSyntheticSmoke(
  options: SyntheticSmokeOptions,
  evaluate: SmokeEvaluator = evaluateSyntheticStrategy,
): Promise<readonly SyntheticSmokeResult[]> {
  if (!options.allowNetwork) return [];

  const results: SyntheticSmokeResult[] = [];
  for (const strategy of SYNTHETIC_SMOKE_STRATEGIES) {
    try {
      const response = await evaluate(strategy);
      const suggestedPairs = response.acceptedMergeSuggestions.map(({ firstId, secondId }) => [firstId, secondId] as const);
      results.push({
        strategy,
        suggestionCount: suggestedPairs.length,
        suggestedPairs,
        expectedPairPresent: suggestedPairs.some(([firstId, secondId]) => pairIsExpected(firstId, secondId)),
      });
    } catch (error: unknown) {
      const diagnostic = getOpenRouterTriageFailureDiagnostic(error);
      results.push({
        strategy,
        suggestionCount: 0,
        suggestedPairs: [],
        expectedPairPresent: false,
        error: diagnostic.code === "provider_result_invalid"
          ? `${diagnostic.code}:${diagnostic.validationReason}`
          : diagnostic.code,
      });
    }
  }
  return results;
}

async function main(): Promise<void> {
  const options = parseSyntheticSmokeOptions(process.argv.slice(2));
  if (!options.allowNetwork) {
    console.log(renderSyntheticSmokePlan());
    return;
  }
  for (const result of await runSyntheticSmoke(options)) console.log(renderSyntheticSmokeResult(result));
}

if (process.argv[1]?.endsWith("smoke-semantic-merge.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Synthetic smoke test failed.");
    process.exitCode = 1;
  });
}
