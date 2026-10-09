import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeExperimentalTriageResponse,
  type StructuralNormalizationResult,
} from "../scripts/ai-triage-structural-normalizer-poc";

const pendingIds = ["pending-1", "pending-2"] as const;
const acceptedIds = ["accepted-1", "accepted-2"] as const;

function result(id: string, relevance = 0.5) {
  return {
    id,
    relevance,
    attention: false,
    spellingSuggestion: null,
  };
}

function response(acceptedMergeSuggestions: unknown[] = []) {
  return {
    results: [result("pending-1", 0.8), result("pending-2", 0.2)],
    acceptedMergeSuggestions,
  };
}

function assertFailure(
  value: unknown,
  code: StructuralNormalizationResult extends { ok: false }
    ? never
    : string,
) {
  const normalized = normalizeExperimentalTriageResponse(
    value,
    pendingIds,
    acceptedIds,
  );

  assert.equal(normalized.ok, false);
  if (!normalized.ok) assert.equal(normalized.error.code, code);
}

test("accepts a completely valid response and preserves order", () => {
  const normalized = normalizeExperimentalTriageResponse(
    response([{ firstId: "accepted-2", secondId: "accepted-1" }]),
    pendingIds,
    acceptedIds,
  );

  assert.equal(normalized.ok, true);
  if (normalized.ok) {
    assert.deepEqual(normalized.response.results.map(({ id }) => id), pendingIds);
    assert.deepEqual(normalized.response.acceptedMergeSuggestions, [
      { firstId: "accepted-2", secondId: "accepted-1" },
    ]);
    assert.deepEqual(normalized.diagnostics, {
      discardedSelfPairs: 0,
      discardedDuplicatePairs: 0,
    });
  }
});

test("discards duplicate pairs in the same and reversed order", () => {
  for (const suggestions of [
    [
      { firstId: "accepted-1", secondId: "accepted-2" },
      { firstId: "accepted-1", secondId: "accepted-2" },
    ],
    [
      { firstId: "accepted-1", secondId: "accepted-2" },
      { firstId: "accepted-2", secondId: "accepted-1" },
    ],
  ]) {
    const normalized = normalizeExperimentalTriageResponse(
      response(suggestions),
      pendingIds,
      acceptedIds,
    );

    assert.equal(normalized.ok, true);
    if (normalized.ok) {
      assert.equal(normalized.response.acceptedMergeSuggestions.length, 1);
      assert.equal(normalized.diagnostics.discardedDuplicatePairs, 1);
    }
  }
});

test("discards self-pairs while preserving valid pairs", () => {
  const normalized = normalizeExperimentalTriageResponse(
    response([
      { firstId: "accepted-1", secondId: "accepted-1" },
      { firstId: "accepted-1", secondId: "accepted-2" },
    ]),
    pendingIds,
    acceptedIds,
  );

  assert.equal(normalized.ok, true);
  if (normalized.ok) {
    assert.deepEqual(normalized.response.acceptedMergeSuggestions, [
      { firstId: "accepted-1", secondId: "accepted-2" },
    ]);
    assert.equal(normalized.diagnostics.discardedSelfPairs, 1);
  }
});

test("returns an empty merge list when every suggestion is discardable", () => {
  const normalized = normalizeExperimentalTriageResponse(
    response([
      { firstId: "accepted-1", secondId: "accepted-1" },
      { firstId: "accepted-2", secondId: "accepted-2" },
    ]),
    pendingIds,
    acceptedIds,
  );

  assert.equal(normalized.ok, true);
  if (normalized.ok) {
    assert.deepEqual(normalized.response.acceptedMergeSuggestions, []);
    assert.equal(normalized.diagnostics.discardedSelfPairs, 2);
  }
});

test("keeps valid results when a merge has a discardable error", () => {
  for (const suggestions of [
    [{ firstId: "accepted-1", secondId: "accepted-1" }],
    [
      { firstId: "accepted-1", secondId: "accepted-2" },
      { firstId: "accepted-2", secondId: "accepted-1" },
    ],
  ]) {
    const normalized = normalizeExperimentalTriageResponse(
      response(suggestions),
      pendingIds,
      acceptedIds,
    );

    assert.equal(normalized.ok, true);
    if (normalized.ok) assert.equal(normalized.response.results.length, 2);
  }
});

test("rejects invalid JSON, objects, merge ids, and pending ids in merges", () => {
  assertFailure("{", "invalid_json");
  assertFailure(null, "response_shape_invalid");
  assertFailure(
    response([{ firstId: "accepted-1", secondId: "unknown" }]),
    "merge_id_invalid",
  );
  assertFailure(
    response([{ firstId: "accepted-1", secondId: "pending-1" }]),
    "merge_id_invalid",
  );
});

test("rejects missing, extra, unknown, and duplicate pending results", () => {
  assertFailure(
    { ...response(), results: [result("pending-1")] },
    "result_count_mismatch",
  );
  assertFailure(
    { ...response(), results: [result("pending-1"), result("pending-1")] },
    "pending_id_duplicate",
  );
  assertFailure(
    { ...response(), results: [result("pending-1"), result("unknown")] },
    "pending_id_invalid",
  );
});

test("rejects invalid relevance values including NaN and infinity", () => {
  for (const relevance of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assertFailure(
      { ...response(), results: [result("pending-1", relevance), result("pending-2")] },
      "relevance_invalid",
    );
  }
});

test("rejects invalid attention and spelling structures", () => {
  assertFailure(
    {
      ...response(),
      results: [
        { ...result("pending-1"), attention: "false" },
        result("pending-2"),
      ],
    },
    "attention_invalid",
  );
  assertFailure(
    {
      ...response(),
      results: [
        { ...result("pending-1"), spellingSuggestion: "   " },
        result("pending-2"),
      ],
    },
    "spelling_suggestion_invalid",
  );
});

test("rejects unexpected fields and existing merge limits", () => {
  assertFailure(
    { ...response(), extra: true },
    "response_shape_invalid",
  );
  assertFailure(
    {
      ...response(),
      results: [{ ...result("pending-1"), extra: true }, result("pending-2")],
    },
    "result_shape_invalid",
  );
  assertFailure(
    {
      ...response(),
      acceptedMergeSuggestions: Array.from({ length: 101 }, () => ({
        firstId: "accepted-1",
        secondId: "accepted-2",
      })),
    },
    "merge_limit_exceeded",
  );
});

test("rejects invalid expected id lists", () => {
  const normalized = normalizeExperimentalTriageResponse(
    response(),
    ["pending-1", "pending-1"],
    acceptedIds,
  );

  assert.equal(normalized.ok, false);
  if (!normalized.ok) assert.equal(normalized.error.code, "invalid_expected_ids");
});

test("normalization is deterministic and idempotent", () => {
  const first = normalizeExperimentalTriageResponse(
    response([
      { firstId: "accepted-1", secondId: "accepted-2" },
      { firstId: "accepted-2", secondId: "accepted-1" },
      { firstId: "accepted-1", secondId: "accepted-1" },
    ]),
    pendingIds,
    acceptedIds,
  );

  assert.equal(first.ok, true);
  if (first.ok) {
    const second = normalizeExperimentalTriageResponse(
      first.response,
      pendingIds,
      acceptedIds,
    );

    assert.deepEqual(second, {
      ok: true,
      response: first.response,
      diagnostics: { discardedSelfPairs: 0, discardedDuplicatePairs: 0 },
    });
  }
});
