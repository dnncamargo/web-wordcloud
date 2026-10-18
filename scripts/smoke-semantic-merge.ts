import {
  getOpenRouterTriageFailureDiagnostic,
  triagePendingWords,
  triagePendingWordsForEvaluator,
  type TriageInput,
  type TriageResponse,
} from "../lib/ai/openRouterTriage";
import { getOpenRouterApiKey } from "../lib/ai/openRouterConfig";
import { DEDICATED_MERGE_INSTRUCTION } from "./evaluate-semantic-merges";

export const SYNTHETIC_SMOKE_CASES = [
  {
    caseId: "A",
    input: {
      question: "Como a escola pode reduzir seu impacto ambiental?",
      acceptedWords: [
        { id: "idea-a", text: "Criar uma horta comunitária na escola." },
        { id: "idea-b", text: "Montar uma horta coletiva na escola." },
        { id: "idea-c", text: "Instalar painéis solares no telhado da escola." },
      ],
      pendingWords: [],
    },
    expectedPairs: [["idea-a", "idea-b"]],
  },
  {
    caseId: "B",
    input: {
      question: "Como a escola pode reduzir seu impacto ambiental?",
      acceptedWords: [
        { id: "idea-a", text: "Criar uma horta escolar." },
        { id: "idea-b", text: "Compostar os restos da merenda." },
        { id: "idea-c", text: "Instalar painéis solares." },
      ],
      pendingWords: [],
    },
    expectedPairs: [],
  },
  {
    caseId: "C",
    input: {
      question: "Como a escola pode reduzir seu impacto ambiental?",
      acceptedWords: [
        { id: "idea-a", text: "Ampliar o uso de energia renovável na escola." },
        { id: "idea-b", text: "Instalar painéis solares no telhado." },
        { id: "idea-c", text: "Trocar as lâmpadas por modelos LED." },
      ],
      pendingWords: [],
    },
    expectedPairs: [],
  },
] as const satisfies readonly Readonly<{
  caseId: string;
  input: TriageInput;
  expectedPairs: readonly (readonly [string, string])[];
}>[];

export const SYNTHETIC_SMOKE_INPUT: TriageInput = SYNTHETIC_SMOKE_CASES[0].input;

export const SYNTHETIC_EXPECTED_PAIR = ["idea-a", "idea-b"] as const;
export const SYNTHETIC_SMOKE_STRATEGIES = ["unified", "dedicated"] as const;

export type SyntheticSmokeStrategy = typeof SYNTHETIC_SMOKE_STRATEGIES[number];
export type SyntheticSmokeCase = typeof SYNTHETIC_SMOKE_CASES[number];

export type SyntheticSmokeResult = Readonly<{
  caseId: string;
  strategy: SyntheticSmokeStrategy;
  suggestionCount: number;
  suggestedPairs: readonly (readonly [string, string])[];
  expectedPairPresent: boolean | "not_applicable";
  error?: string;
}>;

export type SyntheticSmokeOptions = Readonly<{
  allowNetwork: boolean;
}>;

type SmokeEvaluator = (smokeCase: SyntheticSmokeCase, strategy: SyntheticSmokeStrategy) => Promise<TriageResponse>;

export function parseSyntheticSmokeOptions(args: readonly string[]): SyntheticSmokeOptions {
  if (args.length === 0) return { allowNetwork: false };
  if (args.length === 1 && args[0] === "--allow-network") return { allowNetwork: true };
  throw new Error("Usage: smoke-semantic-merge.ts [--allow-network]");
}

export function renderSyntheticSmokePlan(): string {
  return [
    "SEMANTIC_MERGE_SMOKE_PLAN",
    "network_enabled=false",
    "planned_calls=6",
    "cases=A,B,C",
    "strategies=unified,dedicated",
    "accepted_word_ids=idea-a,idea-b,idea-c",
    "expected_pairs=A:idea-a/idea-b;B:none;C:none",
    "corpus_loaded=false",
    "results_printed=metadata_only",
  ].join("\n");
}

function pairIsExpected(
  expectedPairs: readonly (readonly [string, string])[],
  firstId: string,
  secondId: string,
): boolean | "not_applicable" {
  if (expectedPairs.length === 0) return "not_applicable";
  return expectedPairs.some(([expectedFirst, expectedSecond]) =>
    (firstId === expectedFirst && secondId === expectedSecond) ||
    (firstId === expectedSecond && secondId === expectedFirst));
}

export function renderSyntheticSmokeResult(result: SyntheticSmokeResult): string {
  const pairs = result.suggestedPairs.map(([firstId, secondId]) => `${firstId}/${secondId}`).join(",") || "none";
  return [
    `case=${result.caseId}`,
    `strategy=${result.strategy}`,
    `suggestions=${result.suggestionCount}`,
    `pairs=${pairs}`,
    `expected_pair_present=${result.expectedPairPresent}`,
    `error=${result.error ?? "none"}`,
  ].join(" ");
}

async function evaluateSyntheticStrategy(smokeCase: SyntheticSmokeCase, strategy: SyntheticSmokeStrategy): Promise<TriageResponse> {
  return strategy === "unified"
    ? triagePendingWords(smokeCase.input)
    : triagePendingWordsForEvaluator(smokeCase.input, DEDICATED_MERGE_INSTRUCTION);
}

export function assertSyntheticSmokeApiKey(): void {
  if (!getOpenRouterApiKey()) throw new Error("OPENROUTER_API_KEY is required for the authorized synthetic smoke test.");
}

export async function runSyntheticSmoke(
  options: SyntheticSmokeOptions,
  evaluate: SmokeEvaluator = evaluateSyntheticStrategy,
  hasApiKey: () => boolean = () => Boolean(getOpenRouterApiKey()),
): Promise<readonly SyntheticSmokeResult[]> {
  if (!options.allowNetwork) return [];
  if (!hasApiKey()) throw new Error("OPENROUTER_API_KEY is required for the authorized synthetic smoke test.");

  const results: SyntheticSmokeResult[] = [];
  for (const smokeCase of SYNTHETIC_SMOKE_CASES) {
    for (const strategy of SYNTHETIC_SMOKE_STRATEGIES) {
      try {
        const response = await evaluate(smokeCase, strategy);
        const suggestedPairs = response.acceptedMergeSuggestions.map(({ firstId, secondId }) => [firstId, secondId] as const);
        results.push({
          caseId: smokeCase.caseId,
          strategy,
          suggestionCount: suggestedPairs.length,
          suggestedPairs,
          expectedPairPresent: smokeCase.expectedPairs.length === 0
            ? "not_applicable"
            : suggestedPairs.some(([firstId, secondId]) => pairIsExpected(smokeCase.expectedPairs, firstId, secondId) === true),
        });
      } catch (error: unknown) {
        const diagnostic = getOpenRouterTriageFailureDiagnostic(error);
        results.push({
          caseId: smokeCase.caseId,
          strategy,
          suggestionCount: 0,
          suggestedPairs: [],
          expectedPairPresent: smokeCase.expectedPairs.length === 0 ? "not_applicable" : false,
          error: diagnostic.code === "provider_result_invalid"
            ? `${diagnostic.code}:${diagnostic.validationReason}`
            : diagnostic.code,
        });
      }
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
  assertSyntheticSmokeApiKey();
  for (const result of await runSyntheticSmoke(options)) console.log(renderSyntheticSmokeResult(result));
}

if (process.argv[1]?.endsWith("smoke-semantic-merge.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Synthetic smoke test failed.");
    process.exitCode = 1;
  });
}
