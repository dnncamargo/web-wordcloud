export const MAX_BODY_BYTES = 32 * 1024;
export const MAX_QUESTION_CODE_POINTS = 1_000;
export const MAX_WORD_ID_CODE_POINTS = 128;
export const MAX_WORD_TEXT_CODE_POINTS = 256;
export const MAX_ACCEPTED_WORDS = 100;
export const MAX_PENDING_WORDS = 40;
export const MAX_COMBINED_WORDS = 120;
export const MAX_ACCEPTED_MERGE_SUGGESTIONS = 100;

export type TriageWord = Readonly<{
  id: string;
  text: string;
}>;

export type TriageInput = Readonly<{
  question: string;
  acceptedWords: readonly TriageWord[];
  pendingWords: readonly TriageWord[];
}>;

export type TriageResult = Readonly<{
  id: string;
  relevance: number;
  attention: boolean;
  spellingSuggestion: string | null;
}>;

export type AcceptedMergeSuggestion = Readonly<{
  firstId: string;
  secondId: string;
}>;

export type TriageResponse = Readonly<{
  results: readonly TriageResult[];
  acceptedMergeSuggestions: readonly AcceptedMergeSuggestion[];
}>;

export class TriageValidationError extends Error {
  constructor(message = "Invalid triage input.") {
    super(message);
    this.name = "TriageValidationError";
  }
}

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

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function validateWordList(
  value: unknown,
  fieldName: "acceptedWords" | "pendingWords",
  maximum: number,
): TriageWord[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new TriageValidationError(`${fieldName} exceeds its item limit.`);
  }

  return value.map((candidate, index) => {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, ["id", "text"]) ||
      typeof candidate.id !== "string" ||
      typeof candidate.text !== "string" ||
      candidate.id.length === 0 ||
      codePointLength(candidate.id) > MAX_WORD_ID_CODE_POINTS ||
      codePointLength(candidate.text) > MAX_WORD_TEXT_CODE_POINTS
    ) {
      throw new TriageValidationError(`Invalid ${fieldName}[${index}].`);
    }

    return { id: candidate.id, text: candidate.text };
  });
}

export function validateTriageInput(value: unknown): TriageInput {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["question", "acceptedWords", "pendingWords"]) ||
    typeof value.question !== "string" ||
    codePointLength(value.question) > MAX_QUESTION_CODE_POINTS
  ) {
    throw new TriageValidationError();
  }

  const acceptedWords = validateWordList(
    value.acceptedWords,
    "acceptedWords",
    MAX_ACCEPTED_WORDS,
  );
  const pendingWords = validateWordList(
    value.pendingWords,
    "pendingWords",
    MAX_PENDING_WORDS,
  );

  if (acceptedWords.length + pendingWords.length > MAX_COMBINED_WORDS) {
    throw new TriageValidationError(
      "The combined word count exceeds its item limit.",
    );
  }

  const ids = new Set<string>();

  for (const word of [...acceptedWords, ...pendingWords]) {
    if (ids.has(word.id)) {
      throw new TriageValidationError("Triage word ids must be unique.");
    }

    ids.add(word.id);
  }

  return { question: value.question, acceptedWords, pendingWords };
}

export function validateTriageResults(
  value: unknown,
  pendingWords: readonly TriageWord[],
  acceptedWords: readonly TriageWord[],
): TriageResponse {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["results", "acceptedMergeSuggestions"]) ||
    !Array.isArray(value.results) ||
    value.results.length !== pendingWords.length ||
    !Array.isArray(value.acceptedMergeSuggestions) ||
    value.acceptedMergeSuggestions.length > MAX_ACCEPTED_MERGE_SUGGESTIONS ||
    (acceptedWords.length < 2 && value.acceptedMergeSuggestions.length > 0)
  ) {
    throw new TriageValidationError("Incomplete triage result.");
  }

  const pendingIds = new Set(pendingWords.map((word) => word.id));
  const acceptedIds = new Set(acceptedWords.map((word) => word.id));
  const seenIds = new Set<string>();
  const acceptedMergeValues = value.acceptedMergeSuggestions as unknown[];

  const results = value.results.map((result, index) => {
    if (
      !isRecord(result) ||
      !hasExactKeys(result, [
        "id",
        "relevance",
        "attention",
        "spellingSuggestion",
      ]) ||
      typeof result.id !== "string" ||
      !pendingIds.has(result.id) ||
      seenIds.has(result.id) ||
      typeof result.relevance !== "number" ||
      !Number.isFinite(result.relevance) ||
      result.relevance < 0 ||
      result.relevance > 1 ||
      typeof result.attention !== "boolean" ||
      (result.spellingSuggestion !== null &&
        (typeof result.spellingSuggestion !== "string" ||
          result.spellingSuggestion.trim().length === 0))
    ) {
      throw new TriageValidationError(`Invalid triage result at index ${index}.`);
    }

    seenIds.add(result.id);

    return {
      id: result.id,
      relevance: result.relevance,
      attention: result.attention,
      spellingSuggestion: result.spellingSuggestion,
    };
  });

  const seenPairs = new Set<string>();
  const acceptedMergeSuggestions: AcceptedMergeSuggestion[] = [];

  for (const suggestion of acceptedMergeValues) {
    if (
      !isRecord(suggestion) ||
      !hasExactKeys(suggestion, ["firstId", "secondId"]) ||
      typeof suggestion.firstId !== "string" ||
      typeof suggestion.secondId !== "string" ||
      !acceptedIds.has(suggestion.firstId) ||
      !acceptedIds.has(suggestion.secondId) ||
      suggestion.firstId === suggestion.secondId
    ) {
      throw new TriageValidationError("Invalid accepted merge suggestion.");
    }

    const pairKey = [suggestion.firstId, suggestion.secondId].sort().join("\u0000");

    if (seenPairs.has(pairKey)) continue;

    seenPairs.add(pairKey);
    acceptedMergeSuggestions.push({
      firstId: suggestion.firstId,
      secondId: suggestion.secondId,
    });
  }

  return {
    results,
    acceptedMergeSuggestions,
  };
}
