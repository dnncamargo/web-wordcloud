import { normalizeWord } from "@/lib/normalizeWord";

export type ExactAggregationWord = Readonly<{
  id: string;
  text: string;
}>;

export function findUniqueExactAcceptedWord(
  pendingText: string,
  acceptedWords: readonly ExactAggregationWord[],
) {
  const normalizedPendingText = normalizeWord(pendingText);

  if (!normalizedPendingText) return null;

  const matches = acceptedWords.filter(
    (word) => normalizeWord(word.text) === normalizedPendingText,
  );

  return matches.length === 1 ? matches[0] : null;
}
