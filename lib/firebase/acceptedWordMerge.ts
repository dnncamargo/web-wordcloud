export type AcceptedMergeWord = Readonly<{
  id: string;
  text: string;
  count: number;
  aliases?: readonly string[];
}>;

export type AcceptedWordMergeDecision =
  | Readonly<{ kind: "invalid" }>
  | Readonly<{
      kind: "update";
      change: Readonly<{
        text: string;
        count: number;
        aliases: string[];
      }>;
    }>;

export type AcceptedMergeDocumentRoles = Readonly<{
  survivorId: string;
  absorbedId: string;
}>;

function getWordForms(word: Pick<AcceptedMergeWord, "text" | "aliases">) {
  return [word.text, ...(word.aliases ?? [])];
}

export function getAcceptedMergePairKey(firstId: string, secondId: string) {
  return JSON.stringify([firstId, secondId].sort());
}

export function getAcceptedMergeDocumentRoles(
  firstId: string,
  secondId: string,
): AcceptedMergeDocumentRoles | null {
  if (firstId === secondId) return null;

  const survivorId = firstId < secondId ? firstId : secondId;

  return {
    survivorId,
    absorbedId: survivorId === firstId ? secondId : firstId,
  };
}

export function getAcceptedMergeCanonicalCandidates(
  firstWord: Pick<AcceptedMergeWord, "text" | "aliases">,
  secondWord: Pick<AcceptedMergeWord, "text" | "aliases">,
) {
  return [...new Set([...getWordForms(firstWord), ...getWordForms(secondWord)])];
}

export function prepareAcceptedWordMerge(
  firstWord: AcceptedMergeWord,
  secondWord: AcceptedMergeWord,
  canonicalText: string,
): AcceptedWordMergeDecision {
  if (firstWord.id === secondWord.id) return { kind: "invalid" };

  const forms = getAcceptedMergeCanonicalCandidates(firstWord, secondWord);

  if (!forms.includes(canonicalText)) return { kind: "invalid" };

  return {
    kind: "update",
    change: {
      text: canonicalText,
      count: firstWord.count + secondWord.count,
      aliases: forms.filter((form) => form !== canonicalText),
    },
  };
}
