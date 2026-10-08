import { normalizeWord } from "@/lib/normalizeWord";

export type ApprovedWordReplacement = Readonly<{
  sourceText: string;
  text: string;
  normalized: string;
  action: "create" | "increment";
}>;

export type OriginalApprovedWord = Readonly<{
  text: string;
  normalized: string;
}>;

export function prepareOriginalApprovedWord(
  persistedText: string | null | undefined,
  submittedText: string,
): OriginalApprovedWord | null {
  const text = (persistedText ?? submittedText).trim();
  const normalized = normalizeWord(text);

  if (!text || !normalized) return null;

  return { text, normalized };
}

export function prepareApprovedWordReplacement(
  sourceText: string,
  replacementText: string,
  targetExists: boolean,
): ApprovedWordReplacement | null {
  const source = sourceText.trim();
  const text = replacementText.trim();
  const normalized = normalizeWord(text);

  if (!source || !text || !normalized) return null;

  return {
    sourceText: source,
    text,
    normalized,
    action: targetExists ? "increment" : "create",
  };
}
