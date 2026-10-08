import { isMeaningfullyDifferentSpelling } from "@/lib/ai/triage-client";

export type PendingSpellingSelections = Readonly<Record<string, string>>;

export type PendingApprovalPlan = Readonly<{
  operation: "approveNewWord" | "approveNewWordAs";
  text: string;
}>;

export type PendingMergePlan = Readonly<{
  operation: "mergeNewWordIntoWord";
  targetWordId: string;
}>;

export function selectPendingSpelling(
  selections: PendingSpellingSelections,
  pendingWordId: string,
  submittedText: string,
  spelling: string,
): PendingSpellingSelections {
  if (!isMeaningfullyDifferentSpelling(submittedText, spelling)) return selections;

  return {
    ...selections,
    [pendingWordId]: spelling,
  };
}

export function clearPendingSpelling(
  selections: PendingSpellingSelections,
  pendingWordId: string,
): PendingSpellingSelections {
  if (!(pendingWordId in selections)) return selections;

  const nextSelections = { ...selections };
  delete nextSelections[pendingWordId];
  return nextSelections;
}

export function getPendingApprovalPlan(
  submittedText: string,
  selectedSpelling: string | undefined,
): PendingApprovalPlan {
  if (selectedSpelling && isMeaningfullyDifferentSpelling(submittedText, selectedSpelling)) {
    return {
      operation: "approveNewWordAs",
      text: selectedSpelling,
    };
  }

  return {
    operation: "approveNewWord",
    text: submittedText,
  };
}

export function getPendingMergePlan(targetWordId: string | null): PendingMergePlan | null {
  if (!targetWordId) return null;

  return {
    operation: "mergeNewWordIntoWord",
    targetWordId,
  };
}
