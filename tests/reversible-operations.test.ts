import assert from "node:assert/strict";
import test from "node:test";
import {
  isOperationSnapshotWithinLimit,
  isReversibleOperationRecord,
  planReversibleUndo,
  snapshotsEqual,
  type ReversibleDocumentSnapshot,
} from "@/lib/firebase/reversibleOperations";

const originalActiveWord = {
  text: "Harbor restoration",
  normalized: "harbor restoration",
  count: 4,
  aliases: ["Restore the harbor"],
  createdAt: new Date("2025-01-01T00:00:00Z"),
  updatedAt: new Date("2025-02-01T00:00:00Z"),
};
const originalAbsorbedWord = {
  text: "Restore coastal habitat",
  normalized: "restore coastal habitat",
  count: 2,
  aliases: [],
  createdAt: new Date("2025-01-02T00:00:00Z"),
  updatedAt: new Date("2025-02-02T00:00:00Z"),
};
const mergedActiveWord = {
  ...originalActiveWord,
  text: "Restore coastal habitat",
  count: 6,
  aliases: ["Harbor restoration", "Restore the harbor"],
  lastOperationId: "op-merge-01",
};

const acceptedMergeOperation = {
  schemaVersion: 1,
  operationId: "op-merge-01",
  cloudId: "cloud-synthetic-a",
  type: "accepted_merge",
  status: "applied",
  actor: "teacher",
  createdAt: new Date("2025-03-01T00:00:00Z"),
  documents: [
    {
      before: { kind: "words", documentId: "accepted-a", existed: true, data: originalActiveWord },
      after: {
        kind: "words",
        documentId: "accepted-a",
        existed: true,
        data: {
          ...mergedActiveWord,
        },
      },
    },
    {
      before: { kind: "words", documentId: "accepted-b", existed: true, data: originalAbsorbedWord },
      after: {
        kind: "words",
        documentId: "accepted-b",
        existed: false,
        data: null,
      },
    },
  ],
} as const;

function snapshot(
  documentId: string,
  data: Record<string, unknown>,
): ReversibleDocumentSnapshot {
  return { kind: "words", documentId, existed: true, data };
}

test("accepted merge undo plan restores both original document IDs and individual counts", () => {
  assert.equal(isReversibleOperationRecord(acceptedMergeOperation), true);

  const plan = planReversibleUndo(
    acceptedMergeOperation,
    "cloud-synthetic-a",
    "op-merge-01",
    [
      snapshot("accepted-a", mergedActiveWord),
      { kind: "words", documentId: "accepted-b", existed: false, data: null },
    ],
  );

  assert.equal(plan.kind, "ready");
  if (plan.kind !== "ready") return;
  assert.deepEqual(plan.restore.map(({ documentId }) => documentId), ["accepted-a", "accepted-b"]);
  assert.deepEqual(plan.restore.map(({ data }) => data?.count), [4, 2]);
  assert.deepEqual(plan.restore.map(({ data }) => data?.text), ["Harbor restoration", "Restore coastal habitat"]);
});

test("undo is blocked after a later edit or count change", () => {
  const changedTarget = { ...mergedActiveWord, count: 7 };
  const plan = planReversibleUndo(
    acceptedMergeOperation,
    "cloud-synthetic-a",
    "op-merge-01",
    [snapshot("accepted-a", changedTarget), { kind: "words", documentId: "accepted-b", existed: false, data: null }],
  );
  assert.deepEqual(plan, { kind: "changed_since_operation" });
});

test("changing the selected representation after a merge blocks unsafe undo", () => {
  const changedRepresentation = {
    ...mergedActiveWord,
    text: "A newly selected representation",
    lastOperationId: "op-canonical-change",
  };
  const plan = planReversibleUndo(
    acceptedMergeOperation,
    "cloud-synthetic-a",
    "op-merge-01",
    [snapshot("accepted-a", changedRepresentation), { kind: "words", documentId: "accepted-b", existed: false, data: null }],
  );
  assert.deepEqual(plan, { kind: "changed_since_operation" });
});

test("operation status and cloud identity make undo idempotent and scoped", () => {
  const reversed = { ...acceptedMergeOperation, status: "reversed" };
  assert.deepEqual(
    planReversibleUndo(reversed, "cloud-synthetic-a", "op-merge-01", []),
    { kind: "unavailable" },
  );
  assert.deepEqual(
    planReversibleUndo(acceptedMergeOperation, "another-cloud", "op-merge-01", []),
    { kind: "unavailable" },
  );
});

test("missing legacy history and a reused absorbed ID never receive a false undo", () => {
  assert.deepEqual(planReversibleUndo(null, "cloud-synthetic-a", "op-merge-01", []), { kind: "unavailable" });
  const reusedId = snapshot("accepted-b", {
    text: "A new unrelated word",
    normalized: "a new unrelated word",
    count: 1,
    aliases: [],
    lastOperationId: "op-new-record",
  });
  assert.deepEqual(
    planReversibleUndo(acceptedMergeOperation, "cloud-synthetic-a", "op-merge-01", [snapshot("accepted-a", mergedActiveWord), reusedId]),
    { kind: "changed_since_operation" },
  );
});

test("dependent operations must be undone in reverse order", () => {
  const firstAfter = { ...originalActiveWord, count: 5, lastOperationId: "op-first" };
  const secondAfter = { ...originalActiveWord, count: 6, lastOperationId: "op-second" };
  const operation = (operationId: string, before: typeof originalActiveWord, after: typeof firstAfter) => ({
    schemaVersion: 1,
    operationId,
    cloudId: "cloud-synthetic-a",
    type: "exact_match_aggregation",
    status: "applied",
    actor: "exact_match_automation",
    createdAt: new Date("2025-07-01T00:00:00Z"),
    documents: [{
      before: { kind: "words", documentId: "stable-word", existed: true, data: before },
      after: { kind: "words", documentId: "stable-word", existed: true, data: after },
    }],
  });
  const first = operation("op-first", originalActiveWord, firstAfter);
  const second = operation("op-second", firstAfter, secondAfter);

  assert.deepEqual(
    planReversibleUndo(first, "cloud-synthetic-a", "op-first", [snapshot("stable-word", secondAfter)]),
    { kind: "changed_since_operation" },
  );
  const undoSecond = planReversibleUndo(second, "cloud-synthetic-a", "op-second", [snapshot("stable-word", secondAfter)]);
  assert.equal(undoSecond.kind, "ready");
  if (undoSecond.kind !== "ready") return;
  const undoFirst = planReversibleUndo(first, "cloud-synthetic-a", "op-first", [undoSecond.restore[0]]);
  assert.equal(undoFirst.kind, "ready");
  if (undoFirst.kind === "ready") assert.equal(undoFirst.restore[0].data?.count, 4);
});

test("a created correction target is removed and the pending submission can be restored", () => {
  const beforePending = { text: "A beacon for storms", status: "pending", normalized: "a beacon for storms" };
  const afterPending = { ...beforePending, status: "approved", lastOperationId: "op-correction-01" };
  const correctedWord = {
    text: "A beacon for storms",
    normalized: "a beacon for storms",
    count: 1,
    aliases: [],
    lastOperationId: "op-correction-01",
  };
  const operation = {
    schemaVersion: 1,
    operationId: "op-correction-01",
    cloudId: "cloud-synthetic-a",
    type: "spelling_correction",
    status: "applied",
    actor: "teacher",
    createdAt: new Date("2025-04-01T00:00:00Z"),
    documents: [
      { before: { kind: "words", documentId: "a beacon for storms", existed: false, data: null }, after: { kind: "words", documentId: "a beacon for storms", existed: true, data: correctedWord } },
      { before: { kind: "newWords", documentId: "pending-a", existed: true, data: beforePending }, after: { kind: "newWords", documentId: "pending-a", existed: true, data: afterPending } },
    ],
  } as const;
  const plan = planReversibleUndo(operation, "cloud-synthetic-a", "op-correction-01", [
    snapshot("a beacon for storms", correctedWord),
    { kind: "newWords", documentId: "pending-a", existed: true, data: afterPending },
  ]);
  assert.equal(plan.kind, "ready");
  if (plan.kind !== "ready") return;
  assert.equal(plan.restore[0].existed, false);
  assert.equal(plan.restore[0].data, null);
  assert.deepEqual(plan.restore[1].data, beforePending);
});

test("manual pending merge undo removes only its increment and restores the pending record", () => {
  const beforeTarget = { text: "Community greenhouse", normalized: "community greenhouse", count: 5, aliases: ["Shared greenhouse"] };
  const afterTarget = { ...beforeTarget, count: 6, aliases: ["Shared greenhouse", "Neighborhood greenhouse"], lastOperationId: "op-pending-01" };
  const beforePending = { text: "Neighborhood greenhouse", status: "pending", mergedIntoWordId: null };
  const afterPending = { ...beforePending, status: "merged", mergedIntoWordId: "target-greenhouse", lastOperationId: "op-pending-01" };
  const operation = {
    schemaVersion: 1,
    operationId: "op-pending-01",
    cloudId: "cloud-synthetic-a",
    type: "pending_merge",
    status: "applied",
    actor: "teacher",
    createdAt: new Date("2025-05-01T00:00:00Z"),
    documents: [
      { before: { kind: "words", documentId: "target-greenhouse", existed: true, data: beforeTarget }, after: { kind: "words", documentId: "target-greenhouse", existed: true, data: afterTarget } },
      { before: { kind: "newWords", documentId: "pending-greenhouse", existed: true, data: beforePending }, after: { kind: "newWords", documentId: "pending-greenhouse", existed: true, data: afterPending } },
    ],
  } as const;
  const plan = planReversibleUndo(operation, operation.cloudId, operation.operationId, [
    snapshot("target-greenhouse", afterTarget),
    { kind: "newWords", documentId: "pending-greenhouse", existed: true, data: afterPending },
  ]);
  assert.equal(plan.kind, "ready");
  if (plan.kind !== "ready") return;
  assert.equal(plan.restore[0].data?.count, 5);
  assert.deepEqual(plan.restore[0].data?.aliases, ["Shared greenhouse"]);
  assert.deepEqual(plan.restore[1].data, beforePending);
});

test("exact-match aggregation undo restores only the exact contribution", () => {
  const original = { text: "Mend old bicycles", normalized: "mend old bicycles", count: 12, aliases: [] };
  const after = { ...original, count: 13, lastOperationId: "op-exact-01" };
  const beforePending = { text: "MEND OLD BICYCLES", status: "pending" };
  const afterPending = { ...beforePending, status: "approved", lastOperationId: "op-exact-01" };
  const operation = {
    schemaVersion: 1,
    operationId: "op-exact-01",
    cloudId: "cloud-synthetic-a",
    type: "exact_match_aggregation",
    status: "applied",
    actor: "exact_match_automation",
    createdAt: new Date("2025-06-01T00:00:00Z"),
    documents: [
      { before: { kind: "words", documentId: "bicycles", existed: true, data: original }, after: { kind: "words", documentId: "bicycles", existed: true, data: after } },
      { before: { kind: "newWords", documentId: "exact-pending", existed: true, data: beforePending }, after: { kind: "newWords", documentId: "exact-pending", existed: true, data: afterPending } },
    ],
  } as const;
  const plan = planReversibleUndo(operation, operation.cloudId, operation.operationId, [
    snapshot("bicycles", after),
    { kind: "newWords", documentId: "exact-pending", existed: true, data: afterPending },
  ]);
  assert.equal(plan.kind, "ready");
  if (plan.kind !== "ready") return;
  assert.equal(plan.restore[0].data?.count, 12);
  assert.equal(plan.restore[1].data?.status, "pending");
});

test("normalization lock snapshots are restored with the original word identity", () => {
  const lockBefore = { wordId: "stable-word-id" };
  const lockAfter = { wordId: "stable-word-id", lastOperationId: "op-correction-02" };
  const operation = {
    ...acceptedMergeOperation,
    type: "spelling_correction",
    operationId: "op-correction-02",
    documents: [
      {
        before: { kind: "wordNormalizationLocks", documentId: "new-normalized-form", existed: false, data: null },
        after: { kind: "wordNormalizationLocks", documentId: "new-normalized-form", existed: true, data: lockAfter },
      },
    ],
  } as const;
  const plan = planReversibleUndo(operation, operation.cloudId, operation.operationId, [
    { kind: "wordNormalizationLocks", documentId: "new-normalized-form", existed: true, data: lockAfter },
  ]);
  assert.equal(plan.kind, "ready");
  if (plan.kind !== "ready") return;
  assert.deepEqual(plan.restore[0], {
    kind: "wordNormalizationLocks",
    documentId: "new-normalized-form",
    existed: false,
    data: null,
  });
  assert.equal(lockBefore.wordId, "stable-word-id");
});

test("snapshot comparison ignores server-managed timestamps but detects content changes", () => {
  assert.equal(
    snapshotsEqual(
      { text: "Measure river clarity", count: 3, updatedAt: new Date("2025-01-01T00:00:00Z") },
      { text: "Measure river clarity", count: 3 },
    ),
    true,
  );
  assert.equal(snapshotsEqual({ text: "Measure river clarity", count: 4 }, { text: "Measure river clarity", count: 3 }), false);
});

test("operation snapshots are size-limited for safe single-document history entries", () => {
  assert.equal(isOperationSnapshotWithinLimit({ text: "small synthetic snapshot" }), true);
  assert.equal(isOperationSnapshotWithinLimit({ text: "x".repeat(800 * 1024) }), false);
});
