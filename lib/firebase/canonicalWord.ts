export type CanonicalWordChange = Readonly<{
  text: string;
  aliases: string[];
}>;

export type CanonicalWordChangeDecision =
  | Readonly<{ kind: "invalid" }>
  | Readonly<{ kind: "noop" }>
  | Readonly<{ kind: "update"; change: CanonicalWordChange }>;

export function getCanonicalWordCandidates(
  text: string,
  aliases: readonly string[] = [],
) {
  return [...new Set([text, ...aliases])];
}

export function prepareCanonicalWordChange(
  currentText: string,
  currentAliases: readonly string[],
  candidate: string,
): CanonicalWordChangeDecision {
  const aliases = [...new Set(currentAliases)];
  const candidates = getCanonicalWordCandidates(currentText, aliases);

  if (!candidates.includes(candidate)) return { kind: "invalid" };
  if (candidate === currentText) return { kind: "noop" };

  return {
    kind: "update",
    change: {
      text: candidate,
      aliases: [...new Set([
        currentText,
        ...aliases.filter((alias) => alias !== currentText && alias !== candidate),
      ])],
    },
  };
}
