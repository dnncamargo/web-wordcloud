import {
  getOpenRouterTriageFailureDiagnostic,
  triagePendingWords,
  triagePendingWordsForEvaluator,
  type TriageInput,
  type TriageResponse,
} from "../lib/ai/openRouterTriage";
import { getOpenRouterApiKey } from "../lib/ai/openRouterConfig";
import { DEDICATED_MERGE_INSTRUCTION } from "./evaluate-semantic-merges";
import { DEDICATED_CALIBRATED_INSTRUCTION } from "./semantic-merge-calibrated-instruction";
export { DEDICATED_CALIBRATED_INSTRUCTION } from "./semantic-merge-calibrated-instruction";

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
  {
    caseId: "D",
    input: {
      question: "Como as famílias podem reduzir a quantidade de carros usados para levar alunos à escola?",
      acceptedWords: [
        { id: "idea-a", text: "Combinar que as famílias dividam os trajetos de carro até a escola." },
        { id: "idea-b", text: "Organizar um sistema de caronas escolares entre responsáveis." },
        { id: "idea-c", text: "Criar um bicicletário para estudantes." },
      ],
      pendingWords: [],
    },
    expectedPairs: [["idea-a", "idea-b"]],
  },
  {
    caseId: "E",
    input: {
      question: "Como reduzir o lixo plástico produzido na escola?",
      acceptedWords: [
        { id: "idea-a", text: "Instalar bebedouros para os alunos reabastecerem suas garrafas." },
        { id: "idea-b", text: "Distribuir sacolas reutilizáveis na cantina." },
        { id: "idea-c", text: "Substituir copos descartáveis por canecas duráveis." },
      ],
      pendingWords: [],
    },
    expectedPairs: [],
  },
  {
    caseId: "F",
    input: {
      question: "Como reduzir o consumo de eletricidade na escola?",
      acceptedWords: [
        { id: "idea-a", text: "Diminuir o consumo de energia elétrica do prédio." },
        { id: "idea-b", text: "Instalar sensores que desliguem as luzes quando as salas estiverem vazias." },
        { id: "idea-c", text: "Substituir equipamentos antigos por modelos mais eficientes." },
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
export const SYNTHETIC_SMOKE_STRATEGIES = ["unified", "dedicated", "dedicated-calibrated"] as const;

export type SyntheticSmokeStrategy = typeof SYNTHETIC_SMOKE_STRATEGIES[number];
export type SyntheticSmokeCase = typeof SYNTHETIC_SMOKE_CASES[number];

export type SyntheticSmokeResult = Readonly<{
  caseId: string;
  strategy: SyntheticSmokeStrategy;
  suggestionCount: number;
  suggestedPairs: readonly (readonly [string, string])[];
  expectedPairPresent: boolean | "not_applicable";
  unexpectedSuggestionCount: number;
  expectationMet: boolean;
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
    "planned_calls=18",
    "cases=A,B,C,D,E,F",
    "strategies=unified,dedicated,dedicated-calibrated",
    "accepted_word_ids=idea-a,idea-b,idea-c",
    "expected_pairs=A:idea-a/idea-b;B:none;C:none;D:idea-a/idea-b;E:none;F:none",
    "corpus_loaded=false",
    "results_printed=metadata_only",
  ].join("\n");
}

export function pairIsExpected(
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
    `unexpected_suggestion_count=${result.unexpectedSuggestionCount}`,
    `expectation_met=${result.expectationMet}`,
    `error=${result.error ?? "none"}`,
  ].join(" ");
}

export async function evaluateSyntheticStrategy(
  smokeCase: SyntheticSmokeCase,
  strategy: SyntheticSmokeStrategy,
  evaluator: typeof triagePendingWordsForEvaluator = triagePendingWordsForEvaluator,
): Promise<TriageResponse> {
  if (strategy === "unified") return triagePendingWords(smokeCase.input);
  const instruction = strategy === "dedicated" ? DEDICATED_MERGE_INSTRUCTION : DEDICATED_CALIBRATED_INSTRUCTION;
  return evaluator(smokeCase.input, instruction);
}

function evaluateExpectation(
  expectedPairs: readonly (readonly [string, string])[],
  suggestedPairs: readonly (readonly [string, string])[],
): Readonly<{ expectedPairPresent: boolean | "not_applicable"; unexpectedSuggestionCount: number; expectationMet: boolean }> {
  const unexpectedSuggestionCount = suggestedPairs.filter(([firstId, secondId]) =>
    pairIsExpected(expectedPairs, firstId, secondId) !== true).length;
  const expectedPairPresent = expectedPairs.length === 0
    ? "not_applicable"
    : expectedPairs.every(([expectedFirst, expectedSecond]) =>
      suggestedPairs.some(([firstId, secondId]) =>
        (firstId === expectedFirst && secondId === expectedSecond) ||
        (firstId === expectedSecond && secondId === expectedFirst)));
  return {
    expectedPairPresent,
    unexpectedSuggestionCount,
    expectationMet: expectedPairs.length === 0
      ? suggestedPairs.length === 0
      : expectedPairPresent === true && unexpectedSuggestionCount === 0,
  };
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
        const expectation = evaluateExpectation(smokeCase.expectedPairs, suggestedPairs);
        results.push({
          caseId: smokeCase.caseId,
          strategy,
          suggestionCount: suggestedPairs.length,
          suggestedPairs,
          ...expectation,
        });
      } catch (error: unknown) {
        const diagnostic = getOpenRouterTriageFailureDiagnostic(error);
        results.push({
          caseId: smokeCase.caseId,
          strategy,
          suggestionCount: 0,
          suggestedPairs: [],
          expectedPairPresent: smokeCase.expectedPairs.length === 0 ? "not_applicable" : false,
          unexpectedSuggestionCount: 0,
          expectationMet: false,
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
