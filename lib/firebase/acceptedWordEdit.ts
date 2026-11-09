import { normalizeWord } from "@/lib/normalizeWord";

export type AcceptedWordEditState = Readonly<{
  hasDraft: boolean;
  canConfirm: boolean;
  canCancel: boolean;
}>;

export function getAcceptedWordEditState(currentText: string, wordId: string, draft: string | undefined): AcceptedWordEditState {
  const hasDraft = draft !== undefined;
  const cleanDraft = draft?.trim() ?? "";
  const canConfirm = hasDraft && Boolean(cleanDraft) && cleanDraft !== currentText && normalizeWord(cleanDraft) === wordId;
  return { hasDraft, canConfirm, canCancel: hasDraft };
}
