import { createHash } from "node:crypto";
import type { TriageInput } from "../lib/ai/openRouterTriage";

export type AnonymizationDictionary = ReadonlyMap<string, string>;
export const ANONYMIZATION_RULES_VERSION = "semantic-merge-anonymizer-v3" as const;

export type AnonymizationReview = Readonly<{
  dictionaryEntries: number;
  replacementCount: number;
  reviewedTextFields: number;
  unresolvedRiskCount: number;
  reviewComplete: boolean;
  corpusVersion?: string;
  rulesFingerprint?: string;
  dictionaryFingerprint?: string;
  approvedItemCount?: number;
  pendingApprovalCount?: number;
  approvalComplete?: boolean;
}>;

export type AnonymizationReviewItem = Readonly<{
  reviewId: string;
  cloudPseudonym: string;
  field: "question" | "acceptedWord" | "pendingWord";
  wordPseudonym?: string;
  originalText: string;
  anonymizedText: string;
  sourceTextFingerprint: string;
  anonymizedTextFingerprint: string;
}>;

export type AnonymizationApproval = Readonly<{
  reviewId: string;
  sourceTextFingerprint: string;
  baseAnonymizedTextFingerprint: string;
  approvedText?: string;
  approvedTextFingerprint?: string;
  status: "approved" | "rejected";
}>;

export type AnonymizationApprovalStore = Readonly<{
  version: "semantic-merge-anonymization-approval-v1";
  corpusVersion: string;
  rulesFingerprint: string;
  dictionaryFingerprint?: string;
  approvals: readonly AnonymizationApproval[];
  approvalMode?: "individual" | "operator-batch";
  declarationFingerprint?: string;
  declaredItemCount?: number;
}>;

const BATCH_DECLARATION_VERSION = "semantic-merge-approval-declaration-v2" as const;

export class AnonymizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnonymizationError";
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function anonymizationRulesFingerprint(dictionary: AnonymizationDictionary): string {
  return fingerprint(JSON.stringify({ version: ANONYMIZATION_RULES_VERSION, dictionary: [...dictionary].sort(([first], [second]) => first.localeCompare(second)) }));
}

export function anonymizationDictionaryFingerprint(dictionary: AnonymizationDictionary): string {
  return fingerprint(JSON.stringify({ version: "semantic-merge-dictionary-v1", dictionary: [...dictionary].sort(([first], [second]) => first.localeCompare(second)) }));
}

export function corpusVersionForInputs(
  entries: readonly Readonly<{ cloudPseudonym: string; input: TriageInput }>[],
): string {
  return fingerprint(JSON.stringify(entries.map((entry) => ({
    cloudPseudonym: entry.cloudPseudonym,
    question: entry.input.question,
    acceptedWords: entry.input.acceptedWords,
    pendingWords: entry.input.pendingWords,
  }))));
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
  for (const [, replacement] of entries) {
    const lowerReplacement = replacement.toLocaleLowerCase();
    if (entries.some(([term]) => lowerReplacement.includes(term.toLocaleLowerCase())) || hasUnresolvedRisk(replacement)) {
      throw new AnonymizationError("Anonymization dictionary contains an unsafe replacement.");
    }
  }
  entries.sort(([first], [second]) => second.length - first.length);
  return new Map(entries);
}

function hasUnresolvedRisk(value: string): boolean {
  return /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|https?:\/\/|www\.|(?<!\w)@\w{2,}|\b(?:cpf|rg|matr[ií]cula|student\s*id|personal\s*id)\b\s*[:#-]?\s*[A-Z0-9][A-Z0-9._-]*|\b(?:nome|name|escola|school|cidade|city|bairro|neighborhood|rua|street)\b\s*[:=-]?\s+(?!\[[A-Z_]+\])\S+|\b(?:meu nome é|my name is)\s+(?!\[[A-Z_]+\])\S+)/iu.test(value);
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

export function validateApprovedAnonymizedText(
  value: string,
  dictionary: AnonymizationDictionary = new Map(),
): boolean {
  const count = { value: 0 };
  const checked = anonymizeText(value, dictionary, count);
  return checked.unresolved === 0 && checked.text === value;
}

export function buildAnonymizationReview(
  entries: readonly Readonly<{ cloudPseudonym: string; input: TriageInput }>[],
  dictionary: AnonymizationDictionary = new Map(),
): { inputs: readonly TriageInput[]; items: readonly AnonymizationReviewItem[]; review: AnonymizationReview } {
  const items = new Map<string, AnonymizationReviewItem>();
  const sanitizedInputs: TriageInput[] = [];
  const reviews: AnonymizationReview[] = [];
  for (const entry of entries) {
    const result = anonymizeTriageInput(entry.input, dictionary);
    sanitizedInputs.push(result.input);
    reviews.push(result.review);
    const add = (field: AnonymizationReviewItem["field"], originalText: string, anonymizedText: string, wordPseudonym?: string) => {
      const reviewId = fingerprint(JSON.stringify({ cloudPseudonym: entry.cloudPseudonym, field, wordPseudonym, anonymizedText }));
      if (!items.has(reviewId)) {
        items.set(reviewId, {
          reviewId,
          cloudPseudonym: entry.cloudPseudonym,
          field,
          wordPseudonym,
          originalText,
          anonymizedText,
          sourceTextFingerprint: fingerprint(originalText),
          anonymizedTextFingerprint: fingerprint(anonymizedText),
        });
      }
    };
    add("question", entry.input.question, result.input.question);
    entry.input.acceptedWords.forEach((word, index) => add("acceptedWord", word.text, result.input.acceptedWords[index]!.text, word.id));
    entry.input.pendingWords.forEach((word, index) => add("pendingWord", word.text, result.input.pendingWords[index]!.text, word.id));
  }
  const review = mergeAnonymizationReviews(reviews);
  return { inputs: sanitizedInputs, items: [...items.values()], review };
}

export function applyAnonymizationApprovals(
  entries: readonly Readonly<{ cloudPseudonym: string; input: TriageInput }>[],
  items: readonly AnonymizationReviewItem[],
  review: AnonymizationReview,
  store: AnonymizationApprovalStore | undefined,
  dictionary: AnonymizationDictionary = new Map(),
): { inputs: readonly TriageInput[]; review: AnonymizationReview } {
  const baseStoreIsValid = store?.version === "semantic-merge-anonymization-approval-v1" &&
    store.corpusVersion === review.corpusVersion &&
    store.rulesFingerprint === review.rulesFingerprint;
  const isBatch = store?.approvalMode === "operator-batch";
  const currentDictionaryFingerprint = anonymizationDictionaryFingerprint(dictionary);
  const currentItemsById = new Map(items.map((item) => [item.reviewId, item]));
  const batchDeclarationIsValid = isBatch && baseStoreIsValid && store?.dictionaryFingerprint === currentDictionaryFingerprint &&
    store.declaredItemCount === items.length && store.approvals.length === items.length &&
    new Set(store.approvals.map((approval) => approval.reviewId)).size === items.length &&
    new Set(items.map((item) => item.reviewId)).size === items.length &&
    store.approvals.every((approval) => items.some((item) => item.reviewId === approval.reviewId)) &&
    store.approvals.every((approval) => {
      const item = currentItemsById.get(approval.reviewId);
      return approval.status === "approved" && item !== undefined &&
        approval.sourceTextFingerprint === item.sourceTextFingerprint &&
        approval.baseAnonymizedTextFingerprint === item.anonymizedTextFingerprint &&
        typeof approval.approvedText === "string" &&
        approval.approvedTextFingerprint === fingerprint(approval.approvedText) &&
        validateApprovedAnonymizedText(approval.approvedText, dictionary);
    }) &&
    store.declarationFingerprint === batchDeclarationFingerprint(items, store.approvals, review, dictionary);
  const validStore = baseStoreIsValid && (!isBatch || batchDeclarationIsValid);
  const approvals = new Map((validStore ? store!.approvals : []).map((approval) => [approval.reviewId, approval]));
  const approvedTexts = new Map<string, string>();
  let approvedItemCount = 0;
  let pendingApprovalCount = 0;
  for (const item of items) {
    const approval = approvals.get(item.reviewId);
    if (
      approval?.status === "approved" &&
      typeof approval.approvedText === "string" &&
      typeof approval.approvedTextFingerprint === "string" &&
      approval.sourceTextFingerprint === item.sourceTextFingerprint &&
      approval.baseAnonymizedTextFingerprint === item.anonymizedTextFingerprint &&
      approval.approvedTextFingerprint === fingerprint(approval.approvedText) &&
      validateApprovedAnonymizedText(approval.approvedText, dictionary)
    ) {
      approvedTexts.set(item.reviewId, approval.approvedText);
      approvedItemCount += 1;
    } else {
      pendingApprovalCount += 1;
    }
  }
  const inputs = entries.map((entry) => {
    const replace = (field: AnonymizationReviewItem["field"], text: string, wordPseudonym?: string): string => {
      const item = items.find((candidate) => candidate.cloudPseudonym === entry.cloudPseudonym && candidate.field === field && candidate.wordPseudonym === wordPseudonym && (candidate.originalText === text || candidate.anonymizedText === text));
      return item ? approvedTexts.get(item.reviewId) ?? item.anonymizedText : text;
    };
    return {
      question: replace("question", entry.input.question),
      acceptedWords: entry.input.acceptedWords.map((word) => ({ ...word, text: replace("acceptedWord", word.text, word.id) })),
      pendingWords: entry.input.pendingWords.map((word) => ({ ...word, text: replace("pendingWord", word.text, word.id) })),
    } satisfies TriageInput;
  });
  return {
    inputs,
    review: {
      ...review,
      approvedItemCount,
      pendingApprovalCount,
      approvalComplete: pendingApprovalCount === 0,
    },
  };
}

export function createBatchApprovalStore(
  items: readonly AnonymizationReviewItem[],
  review: AnonymizationReview,
  confirmedReviewedAll: boolean,
  dictionary: AnonymizationDictionary = new Map(),
): AnonymizationApprovalStore {
  if (!confirmedReviewedAll) throw new AnonymizationError("Explicit batch review confirmation is required.");
  if (!review.reviewComplete || review.unresolvedRiskCount !== 0) {
    throw new AnonymizationError("Unresolved anonymization risks block batch approval.");
  }
  if (!review.corpusVersion || !review.rulesFingerprint || items.length === 0) {
    throw new AnonymizationError("The anonymization review is incomplete.");
  }
  const uniqueIds = new Set(items.map((item) => item.reviewId));
  if (uniqueIds.size !== items.length || items.some((item) => !validateApprovedAnonymizedText(item.anonymizedText, dictionary))) {
    throw new AnonymizationError("The anonymization review items are inconsistent.");
  }
  const approvals = items.map((item) => ({
    reviewId: item.reviewId,
    sourceTextFingerprint: item.sourceTextFingerprint,
    baseAnonymizedTextFingerprint: item.anonymizedTextFingerprint,
    approvedText: item.anonymizedText,
    approvedTextFingerprint: fingerprint(item.anonymizedText),
    status: "approved" as const,
  }));
  const declarationFingerprint = batchDeclarationFingerprint(items, approvals, review, dictionary);
  return {
    version: "semantic-merge-anonymization-approval-v1",
    corpusVersion: review.corpusVersion,
    rulesFingerprint: review.rulesFingerprint,
    dictionaryFingerprint: anonymizationDictionaryFingerprint(dictionary),
    approvalMode: "operator-batch",
    declarationFingerprint,
    declaredItemCount: items.length,
    approvals,
  };
}

export function batchDeclarationFingerprint(
  items: readonly AnonymizationReviewItem[],
  approvals: readonly AnonymizationApproval[],
  review: AnonymizationReview,
  dictionary: AnonymizationDictionary = new Map(),
): string {
  const approvalsById = new Map(approvals.map((approval) => [approval.reviewId, approval]));
  const canonicalItems = [...items]
    .sort((first, second) => first.reviewId.localeCompare(second.reviewId))
    .map((item) => {
      const approval = approvalsById.get(item.reviewId);
      return {
        reviewId: item.reviewId,
        cloudPseudonym: item.cloudPseudonym,
        field: item.field,
        wordPseudonym: item.wordPseudonym ?? null,
        sourceTextFingerprint: item.sourceTextFingerprint,
        baseAnonymizedTextFingerprint: item.anonymizedTextFingerprint,
        finalApprovedTextFingerprint: approval?.approvedTextFingerprint ?? null,
      };
    });
  return fingerprint(JSON.stringify({
    version: BATCH_DECLARATION_VERSION,
    rulesVersion: ANONYMIZATION_RULES_VERSION,
    rulesFingerprint: review.rulesFingerprint,
    dictionaryFingerprint: review.dictionaryFingerprint ?? anonymizationDictionaryFingerprint(dictionary),
    corpusVersion: review.corpusVersion,
    declaredItemCount: items.length,
    items: canonicalItems,
  }));
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
