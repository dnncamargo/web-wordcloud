import {
  MAX_ACCEPTED_MERGE_SUGGESTIONS,
  type AcceptedMergeSuggestion,
  type TriageResponse,
  type TriageResult,
} from "../lib/ai/triage-contract";

export type NormalizationFailureCode =
  | "invalid_json"
  | "invalid_expected_ids"
  | "response_shape_invalid"
  | "result_count_mismatch"
  | "result_shape_invalid"
  | "pending_id_invalid"
  | "pending_id_duplicate"
  | "pending_id_missing"
  | "relevance_invalid"
  | "attention_invalid"
  | "spelling_suggestion_invalid"
  | "merge_limit_exceeded"
  | "merge_suggestion_shape_invalid"
  | "merge_id_invalid";

export type NormalizationDiagnostics = Readonly<{
  discardedSelfPairs: number;
  discardedDuplicatePairs: number;
}>;

export type StructuralNormalizationResult =
  | Readonly<{
      ok: true;
      response: TriageResponse;
      diagnostics: NormalizationDiagnostics;
    }>
  | Readonly<{
      ok: false;
      error: Readonly<{ code: NormalizationFailureCode }>;
      diagnostics: NormalizationDiagnostics;
    }>;

const EMPTY_DIAGNOSTICS: NormalizationDiagnostics = {
  discardedSelfPairs: 0,
  discardedDuplicatePairs: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();

  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  );
}

function failure(
  code: NormalizationFailureCode,
  diagnostics = EMPTY_DIAGNOSTICS,
): StructuralNormalizationResult {
  return { ok: false, error: { code }, diagnostics };
}

function parseResponse(value: unknown):
  | { ok: true; value: unknown }
  | { ok: false; code: "invalid_json" | "response_shape_invalid" } {
  if (typeof value !== "string") return { ok: true, value };

  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false, code: "invalid_json" };
  }
}

function validExpectedIds(value: readonly string[]): value is readonly string[] {
  if (!Array.isArray(value)) return false;

  const seen = new Set<string>();

  for (const id of value) {
    if (typeof id !== "string" || id.length === 0 || seen.has(id)) return false;
    seen.add(id);
  }

  return true;
}

function pairKey(firstId: string, secondId: string): string {
  return [firstId, secondId].sort().join("\u0000");
}

export function normalizeExperimentalTriageResponse(
  value: unknown,
  pendingIds: readonly string[],
  acceptedIds: readonly string[],
): StructuralNormalizationResult {
  if (!validExpectedIds(pendingIds) || !validExpectedIds(acceptedIds)) {
    return failure("invalid_expected_ids");
  }

  const parsed = parseResponse(value);

  if (!parsed.ok) return failure(parsed.code);

  if (
    !isRecord(parsed.value) ||
    !hasExactKeys(parsed.value, ["results", "acceptedMergeSuggestions"]) ||
    !Array.isArray(parsed.value.results) ||
    !Array.isArray(parsed.value.acceptedMergeSuggestions)
  ) {
    return failure("response_shape_invalid");
  }

  const resultsValue = parsed.value.results;

  if (resultsValue.length !== pendingIds.length) {
    return failure("result_count_mismatch");
  }

  const pendingIdSet = new Set(pendingIds);
  const seenPendingIds = new Set<string>();
  const results: TriageResult[] = [];

  for (const result of resultsValue) {
    if (
      !isRecord(result) ||
      !hasExactKeys(result, [
        "id",
        "relevance",
        "attention",
        "spellingSuggestion",
      ])
    ) {
      return failure("result_shape_invalid");
    }

    if (typeof result.id !== "string" || !pendingIdSet.has(result.id)) {
      return failure("pending_id_invalid");
    }

    if (seenPendingIds.has(result.id)) {
      return failure("pending_id_duplicate");
    }

    if (
      typeof result.relevance !== "number" ||
      !Number.isFinite(result.relevance) ||
      result.relevance < 0 ||
      result.relevance > 1
    ) {
      return failure("relevance_invalid");
    }

    if (typeof result.attention !== "boolean") {
      return failure("attention_invalid");
    }

    if (
      result.spellingSuggestion !== null &&
      (typeof result.spellingSuggestion !== "string" ||
        result.spellingSuggestion.trim().length === 0)
    ) {
      return failure("spelling_suggestion_invalid");
    }

    seenPendingIds.add(result.id);
    results.push({
      id: result.id,
      relevance: result.relevance,
      attention: result.attention,
      spellingSuggestion: result.spellingSuggestion,
    });
  }

  if (seenPendingIds.size !== pendingIdSet.size) {
    return failure("pending_id_missing");
  }

  const suggestionsValue = parsed.value.acceptedMergeSuggestions;

  if (
    suggestionsValue.length > MAX_ACCEPTED_MERGE_SUGGESTIONS ||
    (acceptedIds.length < 2 && suggestionsValue.length > 0)
  ) {
    return failure("merge_limit_exceeded");
  }

  const acceptedIdSet = new Set(acceptedIds);
  const seenPairs = new Set<string>();
  const acceptedMergeSuggestions: AcceptedMergeSuggestion[] = [];
  let discardedSelfPairs = 0;
  let discardedDuplicatePairs = 0;

  for (const suggestion of suggestionsValue) {
    if (
      !isRecord(suggestion) ||
      !hasExactKeys(suggestion, ["firstId", "secondId"]) ||
      typeof suggestion.firstId !== "string" ||
      typeof suggestion.secondId !== "string"
    ) {
      return failure("merge_suggestion_shape_invalid");
    }

    if (
      !acceptedIdSet.has(suggestion.firstId) ||
      !acceptedIdSet.has(suggestion.secondId)
    ) {
      return failure("merge_id_invalid");
    }

    if (suggestion.firstId === suggestion.secondId) {
      discardedSelfPairs += 1;
      continue;
    }

    const key = pairKey(suggestion.firstId, suggestion.secondId);

    if (seenPairs.has(key)) {
      discardedDuplicatePairs += 1;
      continue;
    }

    seenPairs.add(key);
    acceptedMergeSuggestions.push({
      firstId: suggestion.firstId,
      secondId: suggestion.secondId,
    });
  }

  return {
    ok: true,
    response: { results, acceptedMergeSuggestions },
    diagnostics: { discardedSelfPairs, discardedDuplicatePairs },
  };
}
