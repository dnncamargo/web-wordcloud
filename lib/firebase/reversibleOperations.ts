export type ReversibleDocumentKind = "words" | "newWords" | "wordNormalizationLocks";

export type ReversibleDocumentSnapshot = Readonly<{
  kind: ReversibleDocumentKind;
  documentId: string;
  existed: boolean;
  data: Readonly<Record<string, unknown>> | null;
}>;

export type ReversibleOperationType =
  | "pending_merge"
  | "manual_approval_aggregation"
  | "exact_match_aggregation"
  | "accepted_merge"
  | "spelling_correction"
  | "pending_rejection"
  | "delete_word";

export type ReversibleOperationRecord = Readonly<{
  schemaVersion: 1;
  operationId: string;
  cloudId: string;
  type: ReversibleOperationType | "undo";
  status: "applied" | "reversed";
  actor: "manual_action" | "exact_match_automation" | "ai_assisted_operation" | "undo" | "teacher" | "teacher_action" | "system_undo";
  createdAt: unknown;
  documents: readonly Readonly<{
    before: ReversibleDocumentSnapshot;
    after: ReversibleDocumentSnapshot;
  }> [];
  reversesOperationId?: string;
  reversedByOperationId?: string;
  reversedAt?: unknown;
}>;

const MAX_OPERATION_SNAPSHOT_BYTES = 700 * 1024;

export function estimateOperationSnapshotBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? "").byteLength;
}

export function isOperationSnapshotWithinLimit(value: unknown): boolean {
  return estimateOperationSnapshotBytes(value) <= MAX_OPERATION_SNAPSHOT_BYTES;
}

function normalizeSnapshotValue(value: unknown): unknown {
  if (value instanceof Date) return { __timestampMs: value.getTime() };

  if (
    value &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof value.toMillis === "function"
  ) {
    return { __timestampMs: value.toMillis() };
  }

  if (Array.isArray(value)) return value.map(normalizeSnapshotValue);

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !["createdAt", "updatedAt", "reviewedAt"].includes(key))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, normalizeSnapshotValue(nestedValue)]),
    );
  }

  return value;
}

export function snapshotsEqual(
  current: Readonly<Record<string, unknown>> | null,
  expected: Readonly<Record<string, unknown>> | null,
): boolean {
  if (current === null || expected === null) return current === expected;

  return (
    JSON.stringify(normalizeSnapshotValue(current)) ===
    JSON.stringify(normalizeSnapshotValue(expected))
  );
}

export function isReversibleOperationRecord(
  value: unknown,
): value is ReversibleOperationRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const record = value as Record<string, unknown>;

  if (
    record.schemaVersion !== 1 ||
    typeof record.operationId !== "string" ||
    typeof record.cloudId !== "string" ||
    !["pending_merge", "manual_approval_aggregation", "exact_match_aggregation", "accepted_merge", "spelling_correction", "pending_rejection", "delete_word", "undo"].includes(String(record.type)) ||
    !["applied", "reversed"].includes(String(record.status)) ||
    !["manual_action", "exact_match_automation", "ai_assisted_operation", "undo", "teacher", "teacher_action", "system_undo"].includes(String(record.actor)) ||
    !Array.isArray(record.documents) ||
    record.documents.length === 0
  ) {
    return false;
  }

  return record.documents.every((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const pair = entry as Record<string, unknown>;
    return isReversibleDocumentSnapshot(pair.before) && isReversibleDocumentSnapshot(pair.after);
  });
}

export type ReversibleUndoPlan =
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{ kind: "changed_since_operation" }>
  | Readonly<{
      kind: "ready";
      restore: readonly ReversibleDocumentSnapshot[];
      reversalDocuments: readonly Readonly<{
        before: ReversibleDocumentSnapshot;
        after: ReversibleDocumentSnapshot;
      }>[];
    }>;

export function planReversibleUndo(
  operationValue: unknown,
  cloudId: string,
  operationId: string,
  current: readonly ReversibleDocumentSnapshot[],
): ReversibleUndoPlan {
  if (!isReversibleOperationRecord(operationValue)) return { kind: "unavailable" };
  const operation = operationValue;
  if (
    operation.cloudId !== cloudId ||
    operation.operationId !== operationId ||
    operation.type === "undo" ||
    operation.status !== "applied"
  ) return { kind: "unavailable" };
  if (current.length !== operation.documents.length) return { kind: "changed_since_operation" };

  const unchanged = operation.documents.every((pair, index) => {
    const currentSnapshot = current[index];
    return (
      currentSnapshot.kind === pair.after.kind &&
      currentSnapshot.documentId === pair.after.documentId &&
      currentSnapshot.existed === pair.after.existed &&
      snapshotsEqual(currentSnapshot.data, pair.after.data)
    );
  });
  if (!unchanged) return { kind: "changed_since_operation" };

  return {
    kind: "ready",
    restore: operation.documents.map((pair) => pair.before),
    reversalDocuments: operation.documents.map((pair, index) => ({
      before: current[index],
      after: pair.before,
    })),
  };
}

function isReversibleDocumentSnapshot(value: unknown): value is ReversibleDocumentSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  return (
    ["words", "newWords", "wordNormalizationLocks"].includes(String(snapshot.kind)) &&
    typeof snapshot.documentId === "string" &&
    snapshot.documentId.length > 0 &&
    !snapshot.documentId.includes("/") &&
    snapshot.documentId !== "." &&
    snapshot.documentId !== ".." &&
    typeof snapshot.existed === "boolean" &&
    (snapshot.data === null || (typeof snapshot.data === "object" && !Array.isArray(snapshot.data))) &&
    (snapshot.existed ? snapshot.data !== null : snapshot.data === null)
  );
}
