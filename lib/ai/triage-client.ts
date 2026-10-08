import { normalizeWord } from "@/lib/normalizeWord";
import {
  MAX_BODY_BYTES,
  MAX_ACCEPTED_WORDS,
  MAX_COMBINED_WORDS,
  MAX_PENDING_WORDS,
  TriageValidationError,
  type TriageInput,
  type TriageResult,
  type TriageWord,
  validateTriageInput,
  validateTriageResults,
} from "@/lib/ai/triage-contract";

export type TriageSnapshot = Readonly<{
  cloudId: string | null;
  question: string;
  acceptedWords: readonly TriageWord[];
  pendingWords: readonly TriageWord[];
}>;

export type TriageDisplayItem<TWord> = Readonly<{
  word: TWord;
  attention: boolean;
  spellingSuggestion: string | null;
  mergeTargetId: string | null;
}>;

export type TriageRequestEligibility = Readonly<{
  authenticated: boolean;
  cloudId: string | null;
  input: unknown;
}>;

export function createTriageSnapshot(
  cloudId: string | null,
  question: string,
  acceptedWords: readonly TriageWord[],
  pendingWords: readonly TriageWord[],
): TriageSnapshot {
  return {
    cloudId,
    question,
    acceptedWords: acceptedWords.map((word) => ({ id: word.id, text: word.text })),
    pendingWords: pendingWords.map((word) => ({ id: word.id, text: word.text })),
  };
}

function areWordsEqual(left: readonly TriageWord[], right: readonly TriageWord[]) {
  return (
    left.length === right.length &&
    left.every(
      (word, index) =>
        word.id === right[index]?.id && word.text === right[index]?.text,
    )
  );
}

export function isTriageSnapshotCurrent(
  snapshot: TriageSnapshot,
  current: TriageSnapshot,
) {
  return (
    snapshot.cloudId === current.cloudId &&
    snapshot.question === current.question &&
    areWordsEqual(snapshot.acceptedWords, current.acceptedWords) &&
    areWordsEqual(snapshot.pendingWords, current.pendingWords)
  );
}

export function isTriageRequestEligible({
  authenticated,
  cloudId,
  input,
}: TriageRequestEligibility) {
  if (!authenticated || !cloudId) return false;

  try {
    const validated = validateTriageInput(input);

    return (
      validated.acceptedWords.length <= MAX_ACCEPTED_WORDS &&
      validated.pendingWords.length <= MAX_PENDING_WORDS &&
      validated.acceptedWords.length + validated.pendingWords.length <=
        MAX_COMBINED_WORDS &&
      validated.pendingWords.length > 0 &&
      new TextEncoder().encode(JSON.stringify(validated)).byteLength <= MAX_BODY_BYTES
    );
  } catch {
    return false;
  }
}

export async function readTriageResponse(
  response: Response,
  input: TriageInput,
): Promise<TriageResult[]> {
  if (!response.ok) throw new TriageValidationError(`HTTP ${response.status}`);

  const payload: unknown = await response.json();

  return validateTriageResults(
    { results: payload },
    input.pendingWords,
    input.acceptedWords,
  );
}

export function orderTriageWords<TWord extends TriageWord>(
  pendingWords: readonly TWord[],
  results: readonly TriageResult[],
): TriageDisplayItem<TWord>[] {
  const resultById = new Map(results.map((result) => [result.id, result]));

  return pendingWords
    .map((word, index) => ({ word, index, result: resultById.get(word.id) }))
    .sort((left, right) => {
      const relevanceDifference =
        (right.result?.relevance ?? 0) - (left.result?.relevance ?? 0);

      return relevanceDifference || left.index - right.index;
    })
    .map(({ word, result }) => ({
      word,
      attention: result?.attention ?? false,
      spellingSuggestion: result?.spellingSuggestion ?? null,
      mergeTargetId: result?.mergeTargetId ?? null,
    }));
}

export function isMeaningfullyDifferentSpelling(
  submittedText: string,
  suggestion: string | null,
) {
  if (suggestion === null) return false;

  const submittedNormalized = normalizeWord(submittedText);
  const suggestionNormalized = normalizeWord(suggestion);

  return (
    suggestion.trim() !== submittedText.trim() &&
    suggestionNormalized !== submittedNormalized
  );
}
