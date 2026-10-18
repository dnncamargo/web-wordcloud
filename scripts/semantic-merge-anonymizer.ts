import type { TriageInput } from "../lib/ai/openRouterTriage";

export type AnonymizationDictionary = ReadonlyMap<string, string>;

export type AnonymizationReview = Readonly<{
  dictionaryEntries: number;
  replacementCount: number;
  reviewedTextFields: number;
  unresolvedRiskCount: number;
  reviewComplete: boolean;
}>;

export class AnonymizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnonymizationError";
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceMatches(
  input: string,
  pattern: RegExp,
  replacement: string,
  count: { value: number },
): string {
  return input.replace(pattern, () => {
    count.value += 1;
    return replacement;
  });
}

export function parseAnonymizationDictionary(value: unknown): AnonymizationDictionary {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AnonymizationError("Anonymization dictionary must be a JSON object.");
  }
  const entries: [string, string][] = [];
  for (const [term, replacement] of Object.entries(value)) {
    if (!term.trim() || typeof replacement !== "string" || !replacement.trim()) {
      throw new AnonymizationError("Anonymization dictionary contains an invalid entry.");
    }
    entries.push([term, replacement]);
  }
  entries.sort(([first], [second]) => second.length - first.length);
  return new Map(entries);
}

function hasUnresolvedRisk(value: string): boolean {
  return /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|https?:\/\/|www\.|(?<!\w)@\w{2,}|\b(?:cpf|rg|matr[ií]cula|student\s*id|personal\s*id)\b\s*[:#-]?\s*[A-Z0-9][A-Z0-9._-]*|\b(?:nome|name|escola|school|cidade|city|bairro|neighborhood|rua|street)\b\s*[:=-]?\s+\S+|\b(?:meu nome é|my name is)\s+\S+)/iu.test(value);
}

function anonymizeText(
  value: string,
  dictionary: AnonymizationDictionary,
  count: { value: number },
): { text: string; unresolved: number } {
  let text = value;
  for (const [term, replacement] of dictionary) {
    text = replaceMatches(text, new RegExp(escapeRegExp(term), "giu"), replacement, count);
  }
  text = replaceMatches(text, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[EMAIL]", count);
  text = replaceMatches(text, /(?:https?:\/\/|www\.)[^\s<]+/giu, "[URL]", count);
  text = replaceMatches(text, /(?<!\w)\+?\d[\d\s().-]{7,}\d(?!\w)/gu, "[PHONE]", count);
  text = replaceMatches(
    text,
    /\b(?:cpf|rg|matr[ií]cula|student\s*id|personal\s*id)\b\s*[:#-]?\s*[A-Z0-9][A-Z0-9._-]*/giu,
    "[PERSONAL_ID]",
    count,
  );
  text = replaceMatches(text, /(?<!\w)@[A-Za-z0-9_]{2,}/g, "[USERNAME]", count);
  text = replaceMatches(
    text,
    /\b(?:Nome|Name|Escola|School|Cidade|City|Bairro|Neighborhood|Rua|Street)\s*[:=-]?\s+\p{Lu}[\p{L}'-]*(?:\s+\p{Lu}[\p{L}'-]*){0,3}/gu,
    "[IDENTIFIER]",
    count,
  );
  text = replaceMatches(
    text,
    /\b(?:Meu nome é|My name is)\s+\p{Lu}[\p{L}'-]*(?:\s+\p{Lu}[\p{L}'-]*){0,3}/gu,
    "[IDENTIFIER]",
    count,
  );
  return { text, unresolved: hasUnresolvedRisk(text) ? 1 : 0 };
}

export function anonymizeTriageInput(
  input: TriageInput,
  dictionary: AnonymizationDictionary = new Map(),
): { input: TriageInput; review: AnonymizationReview } {
  const count = { value: 0 };
  let unresolvedRiskCount = 0;
  let reviewedTextFields = 0;
  const sanitize = (value: string): string => {
    reviewedTextFields += 1;
    const result = anonymizeText(value, dictionary, count);
    unresolvedRiskCount += result.unresolved;
    return result.text;
  };
  const sanitized: TriageInput = {
    question: sanitize(input.question),
    acceptedWords: input.acceptedWords.map((word) => ({ ...word, text: sanitize(word.text) })),
    pendingWords: input.pendingWords.map((word) => ({ ...word, text: sanitize(word.text) })),
  };
  return {
    input: sanitized,
    review: {
      dictionaryEntries: dictionary.size,
      replacementCount: count.value,
      reviewedTextFields,
      unresolvedRiskCount,
      reviewComplete: unresolvedRiskCount === 0,
    },
  };
}

export function mergeAnonymizationReviews(
  reviews: readonly AnonymizationReview[],
): AnonymizationReview {
  return {
    dictionaryEntries: reviews[0]?.dictionaryEntries ?? 0,
    replacementCount: reviews.reduce((total, review) => total + review.replacementCount, 0),
    reviewedTextFields: reviews.reduce((total, review) => total + review.reviewedTextFields, 0),
    unresolvedRiskCount: reviews.reduce((total, review) => total + review.unresolvedRiskCount, 0),
    reviewComplete: reviews.every((review) => review.reviewComplete),
  };
}
