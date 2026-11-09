import assert from "node:assert/strict";
import test from "node:test";
import {
  OpenRouterTriageError,
  triagePendingWords,
  triagePendingWordsForEvaluator,
} from "../lib/ai/openRouterTriage";

const input = {
  question: "Como cuidar da turma?",
  acceptedWords: [
    { id: "accepted-1", text: "Cuidado" },
    { id: "accepted-2", text: "Respeito" },
  ],
  pendingWords: [
    { id: "pending-1", text: "Escuta" },
    { id: "pending-2", text: "Ajuda" },
  ],
};

function providerContent(overrides: {
  results?: unknown;
  acceptedMergeSuggestions?: unknown;
} = {}) {
  return JSON.stringify({
    results: overrides.results ?? [
      {
        id: "pending-1",
        relevance: 0.9,
        attention: true,
        spellingSuggestion: "Escuta",
      },
      {
        id: "pending-2",
        relevance: 0.2,
        attention: false,
        spellingSuggestion: null,
      },
    ],
    acceptedMergeSuggestions: overrides.acceptedMergeSuggestions ?? [],
  });
}

async function withMockedProvider<T>(
  content: string,
  callback: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENROUTER_API_KEY;

  process.env.OPENROUTER_API_KEY = "test-only-openrouter-key";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalApiKey;
    }
  }
}

async function assertProviderFailure(
  callback: () => Promise<unknown>,
  validationReason: string,
) {
  await assert.rejects(callback, (error: unknown) => {
    assert.ok(error instanceof OpenRouterTriageError);
    assert.equal(error.diagnostic.code, "provider_result_invalid");
    assert.equal(error.diagnostic.validationReason, validationReason);
    return true;
  });
}

test("strict mode still rejects self-pairs and duplicate pairs", async () => {
  await withMockedProvider(
    providerContent({
      acceptedMergeSuggestions: [
        { firstId: "accepted-1", secondId: "accepted-1" },
      ],
    }),
    () => assertProviderFailure(
      () => triagePendingWords(input),
      "accepted_merge_pair_same",
    ),
  );

  await withMockedProvider(
    providerContent({
      acceptedMergeSuggestions: [
        { firstId: "accepted-1", secondId: "accepted-2" },
        { firstId: "accepted-2", secondId: "accepted-1" },
      ],
    }),
    () => assertProviderFailure(
      () => triagePendingWords(input),
      "accepted_merge_pair_duplicate",
    ),
  );
});

test("experimental mode recovers both pair defects and preserves valid results", async () => {
  const diagnostics: Array<Record<string, number>> = [];
  const response = await withMockedProvider(
    providerContent({
      acceptedMergeSuggestions: [
        { firstId: "accepted-1", secondId: "accepted-1" },
        { firstId: "accepted-1", secondId: "accepted-2" },
        { firstId: "accepted-2", secondId: "accepted-1" },
      ],
    }),
    () => triagePendingWordsForEvaluator(input, "test instruction", {
      responseMode: "experimental-structural-recovery",
      onStructuralRecovery: (value) => diagnostics.push(value),
    }),
  );

  assert.deepEqual(response.results, [
    {
      id: "pending-1",
      relevance: 0.9,
      attention: true,
      spellingSuggestion: "Escuta",
    },
    {
      id: "pending-2",
      relevance: 0.2,
      attention: false,
      spellingSuggestion: null,
    },
  ]);
  assert.deepEqual(response.acceptedMergeSuggestions, [
    { firstId: "accepted-1", secondId: "accepted-2" },
  ]);
  assert.deepEqual(diagnostics, [{ discardedSelfPairs: 1, discardedDuplicatePairs: 1 }]);
});

test("experimental mode still rejects grave structural defects", async () => {
  await withMockedProvider(
    providerContent({
      acceptedMergeSuggestions: [
        { firstId: "accepted-1", secondId: "unknown" },
      ],
    }),
    () => assertProviderFailure(
      () => triagePendingWordsForEvaluator(input, "test instruction", {
        responseMode: "experimental-structural-recovery",
      }),
      "accepted_merge_suggestion_invalid",
    ),
  );

  await withMockedProvider(
    providerContent({
      results: [
        {
          id: "pending-1",
          relevance: 2,
          attention: false,
          spellingSuggestion: null,
        },
        {
          id: "pending-2",
          relevance: 0.2,
          attention: false,
          spellingSuggestion: null,
        },
      ],
    }),
    () => assertProviderFailure(
      () => triagePendingWordsForEvaluator(input, "test instruction", {
        responseMode: "experimental-structural-recovery",
      }),
      "relevance_invalid",
    ),
  );
});

test("experimental mode preserves sanitized parsing and shape failures", async () => {
  await withMockedProvider(
    "{",
    () => assert.rejects(
      () => triagePendingWordsForEvaluator(input, "test instruction", {
        responseMode: "experimental-structural-recovery",
      }),
      (error: unknown) => {
        assert.ok(error instanceof OpenRouterTriageError);
        assert.equal(error.diagnostic.code, "provider_structured_json_invalid");
        return true;
      },
    ),
  );

  await withMockedProvider(
    JSON.stringify({ results: [] }),
    () => assert.rejects(
      () => triagePendingWordsForEvaluator(input, "test instruction", {
        responseMode: "experimental-structural-recovery",
      }),
      (error: unknown) => {
        assert.ok(error instanceof OpenRouterTriageError);
        assert.equal(error.diagnostic.code, "provider_result_incomplete");
        return true;
      },
    ),
  );
});
