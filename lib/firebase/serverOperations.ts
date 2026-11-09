import "server-only";

import { FieldValue, type DocumentData } from "firebase-admin/firestore";
import { getServerFirestore } from "@/lib/firebase/admin";
import { normalizeWord } from "@/lib/normalizeWord";
import { prepareOriginalApprovedWord, prepareApprovedWordReplacement } from "@/lib/firebase/wordApproval";
import { prepareCanonicalWordChange } from "@/lib/firebase/canonicalWord";
import { getAcceptedMergeDocumentRoles, prepareAcceptedWordMerge } from "@/lib/firebase/acceptedWordMerge";
import { isOperationSnapshotWithinLimit, isReversibleOperationRecord, planReversibleUndo, type ReversibleDocumentKind, type ReversibleDocumentSnapshot, type ReversibleOperationRecord, type ReversibleOperationType } from "@/lib/firebase/reversibleOperations";

export type TeacherMutation =
  | { action: "approve"; newWordId: string; text: string }
  | { action: "approve-as"; newWordId: string; text: string }
  | { action: "exact-aggregate"; newWordId: string; targetWordId: string }
  | { action: "merge-pending"; newWordId: string; targetWordId: string }
  | { action: "canonical-form"; wordId: string; text: string }
  | { action: "merge-accepted"; firstWordId: string; secondWordId: string; text: string }
  | { action: "reject"; newWordId: string }
  | { action: "correct"; wordId: string; expectedText: string; text: string }
  | { action: "delete"; wordId: string }
  | { action: "undo"; operationId: string };

type Pair = { before: ReversibleDocumentSnapshot; after: ReversibleDocumentSnapshot };
const tooLarge = "Esta operação não pode ser registrada com segurança porque os dados associados excedem o limite de histórico.";
const db = () => getServerFirestore();
const isActive = (data: DocumentData) => data.mergeState !== "absorbed" && typeof data.mergedIntoWordId !== "string";
const assertDocId = (value: string) => {
  if (!value || value.includes("/") || value === "." || value === ".." || value.length > 1500) throw new Error("Invalid document reference.");
};

function snapshot(kind: ReversibleDocumentKind, id: string, data: DocumentData | null): ReversibleDocumentSnapshot {
  return { kind, documentId: id, existed: data !== null, data };
}
function pair(kind: ReversibleDocumentKind, id: string, before: DocumentData | null, after: DocumentData | null): Pair {
  const comparableAfter = after ? { ...after } : null;
  if (comparableAfter) for (const key of ["createdAt", "updatedAt", "reviewedAt"]) delete comparableAfter[key];
  return { before: snapshot(kind, id, before), after: snapshot(kind, id, comparableAfter) };
}
function operation(cloudId: string, operationId: string, type: ReversibleOperationType | "undo", actor: ReversibleOperationRecord["actor"], documents: Pair[], reversesOperationId?: string): ReversibleOperationRecord {
  if (!isOperationSnapshotWithinLimit(documents)) throw new Error(tooLarge);
  return { schemaVersion: 1, operationId, cloudId, type, status: "applied", actor, createdAt: FieldValue.serverTimestamp(), documents, ...(reversesOperationId ? { reversesOperationId } : {}) };
}
function refs(cloudId: string, id: string) {
  assertDocId(cloudId); assertDocId(id);
  const store = db();
  return { cloud: store.collection("clouds").doc(cloudId), id };
}

export async function applyTeacherMutation(cloudId: string, mutation: TeacherMutation): Promise<unknown> {
  const { cloud } = refs(cloudId, "guard");
  const store = db();
  const words = cloud.collection("words");
  const pending = cloud.collection("newWords");
  const operations = cloud.collection("operations");
  const locks = cloud.collection("wordNormalizationLocks");
  const newOperation = () => operations.doc();

  switch (mutation.action) {
    case "approve":
    case "approve-as":
    case "exact-aggregate":
    case "merge-pending":
    case "reject": {
      assertDocId(mutation.newWordId);
      const pendingRef = pending.doc(mutation.newWordId);
      const operationRef = newOperation();
      return store.runTransaction(async (tx) => {
        if (!(await tx.get(cloud)).exists) return mutation.action === "approve" || mutation.action === "approve-as" ? "unavailable" : false;
        const pendingSnap = await tx.get(pendingRef);
        if (!pendingSnap.exists || pendingSnap.data()?.status !== "pending") return mutation.action === "approve" || mutation.action === "approve-as" ? "unavailable" : false;
        const pendingData = pendingSnap.data()!;
        const now = FieldValue.serverTimestamp();
        if (mutation.action === "reject") {
          const updated = { ...pendingData, status: "rejected", reviewedAt: now, lastOperationId: operationRef.id };
          tx.update(pendingRef, { status: "rejected", reviewedAt: now, lastOperationId: operationRef.id });
          tx.create(operationRef, operation(cloudId, operationRef.id, "pending_rejection", "manual_action", [pair("newWords", mutation.newWordId, pendingData, updated)]));
          return true;
        }

        let targetRef;
        let targetSnap;
        let targetBefore: DocumentData | null = null;
        let targetAfter: DocumentData;
        let status: string;
        let type: ReversibleOperationType;
        let actor: ReversibleOperationRecord["actor"] = "manual_action";
        let lockRef;
        let lockSnap;
        if (mutation.action === "merge-pending" || mutation.action === "exact-aggregate") {
          assertDocId(mutation.targetWordId);
          targetRef = words.doc(mutation.targetWordId);
          targetSnap = await tx.get(targetRef);
          if (!targetSnap.exists || !isActive(targetSnap.data()!)) return false;
          const target = targetSnap.data()!;
          const sourceText = String(pendingData.text ?? "");
          if (mutation.action === "exact-aggregate") {
            const normalizedSource = normalizeWord(sourceText);
            if (!normalizedSource || normalizedSource !== normalizeWord(String(target.text ?? ""))) return false;
            const matchingTargets = await tx.get(words);
            const uniqueActiveTargets = matchingTargets.docs.filter((candidate) => isActive(candidate.data()) && normalizeWord(String(candidate.data().text ?? "")) === normalizedSource);
            if (uniqueActiveTargets.length !== 1 || uniqueActiveTargets[0].id !== mutation.targetWordId) return false;
          }
          targetBefore = target;
          const aliases = Array.isArray(target.aliases) ? target.aliases.map(String) : [];
          targetAfter = { ...target, count: Number(target.count ?? 1) + 1, aliases: mutation.action === "merge-pending" ? [...new Set([...aliases, sourceText])] : aliases, updatedAt: now, lastOperationId: operationRef.id };
          status = mutation.action === "merge-pending" ? "merged" : "approved";
          type = mutation.action === "merge-pending" ? "pending_merge" : "exact_match_aggregation";
          if (mutation.action === "exact-aggregate") actor = "exact_match_automation";
        } else {
          const original = prepareOriginalApprovedWord(String(pendingData.text ?? ""), mutation.text);
          const approved = mutation.action === "approve-as" ? prepareApprovedWordReplacement(String(pendingData.text ?? ""), mutation.text, false) : null;
          const normalized = approved?.normalized ?? original?.normalized;
          const text = approved?.text ?? original?.text;
          if (!normalized || !text) return "unavailable";
          lockRef = locks.doc(normalized);
          lockSnap = await tx.get(lockRef);
          const reservedWordId = lockSnap.exists ? String(lockSnap.data()?.wordId ?? "") : "";
          if (lockSnap.exists && mutation.action === "approve" && !reservedWordId) return "conflict";
          targetRef = words.doc(mutation.action === "approve" && reservedWordId ? reservedWordId : normalized);
          targetSnap = await tx.get(targetRef);
          if (mutation.action === "approve-as" && (lockSnap.exists || targetSnap.exists)) return "conflict";
          if (mutation.action === "approve-as") {
            const matchingWords = await tx.get(words);
            if (matchingWords.docs.some((candidate) => isActive(candidate.data()))) return "conflict";
          }
          if (mutation.action === "approve" && lockSnap.exists && !targetSnap.exists) return "conflict";
          if (lockSnap?.exists && String(lockSnap.data()?.wordId ?? "") !== targetRef.id) return "conflict";
          if (targetSnap.exists) {
            targetBefore = targetSnap.data()!;
            if (!isActive(targetBefore) || String(targetBefore.normalized ?? "") !== normalized) return "conflict";
            targetAfter = { ...targetBefore, count: Number(targetBefore.count ?? 1) + 1, updatedAt: now, lastOperationId: operationRef.id };
          } else {
            targetAfter = { text, normalized, count: 1, aliases: [], createdAt: now, updatedAt: now, lastOperationId: operationRef.id };
          }
          status = "approved";
          type = mutation.action === "approve-as" ? "spelling_correction" : "manual_approval_aggregation";
        }
        const mergedInto = mutation.action === "merge-pending" ? { mergedIntoWordId: mutation.targetWordId } : {};
        const updatedPending = { ...pendingData, status, ...mergedInto, reviewedAt: now, lastOperationId: operationRef.id };
        tx.set(targetRef!, targetAfter!);
        tx.update(pendingRef, { status, ...mergedInto, reviewedAt: now, lastOperationId: operationRef.id });
          tx.create(operationRef, operation(cloudId, operationRef.id, type!, actor === "exact_match_automation" ? actor : "manual_action", [pair("words", targetRef!.id, targetBefore, targetAfter!), pair("newWords", mutation.newWordId, pendingData, updatedPending)]));
        return mutation.action === "approve" || mutation.action === "approve-as" ? "approved" : true;
      });
    }
    case "canonical-form": {
      assertDocId(mutation.wordId);
      const wordRef = words.doc(mutation.wordId); const opRef = newOperation();
      return store.runTransaction(async (tx) => {
        if (!(await tx.get(cloud)).exists) return false;
        const snap = await tx.get(wordRef); if (!snap.exists || !isActive(snap.data()!)) return false;
        const before = snap.data()!; const decision = prepareCanonicalWordChange(String(before.text ?? ""), Array.isArray(before.aliases) ? before.aliases.map(String) : [], mutation.text);
        if (decision.kind !== "update") return false;
        const after = { ...before, ...decision.change, updatedAt: FieldValue.serverTimestamp(), lastOperationId: opRef.id };
        tx.update(wordRef, { ...decision.change, updatedAt: FieldValue.serverTimestamp(), lastOperationId: opRef.id });
        tx.create(opRef, operation(cloudId, opRef.id, "spelling_correction", "manual_action", [pair("words", wordRef.id, before, after)])); return true;
      });
    }
    case "merge-accepted": {
      assertDocId(mutation.firstWordId); assertDocId(mutation.secondWordId);
      const roles = getAcceptedMergeDocumentRoles(mutation.firstWordId, mutation.secondWordId); if (!roles) return false;
      const survivorRef = words.doc(roles.survivorId); const absorbedRef = words.doc(roles.absorbedId); const opRef = newOperation();
      return store.runTransaction(async (tx) => {
        if (!(await tx.get(cloud)).exists) return false;
        const survivorSnap = await tx.get(survivorRef); const absorbedSnap = await tx.get(absorbedRef);
        if (!survivorSnap.exists || !absorbedSnap.exists || !isActive(survivorSnap.data()!) || !isActive(absorbedSnap.data()!)) return false;
        const survivor = survivorSnap.data()!; const absorbed = absorbedSnap.data()!;
        const decision = prepareAcceptedWordMerge({ id: survivorSnap.id, text: String(survivor.text ?? ""), count: Number(survivor.count ?? 0), aliases: Array.isArray(survivor.aliases) ? survivor.aliases.map(String) : [] }, { id: absorbedSnap.id, text: String(absorbed.text ?? ""), count: Number(absorbed.count ?? 0), aliases: Array.isArray(absorbed.aliases) ? absorbed.aliases.map(String) : [] }, mutation.text);
        if (decision.kind !== "update") return false;
        const after = { ...survivor, ...decision.change, updatedAt: FieldValue.serverTimestamp(), lastOperationId: opRef.id };
        tx.update(survivorRef, { ...decision.change, updatedAt: FieldValue.serverTimestamp(), lastOperationId: opRef.id }); tx.delete(absorbedRef);
        tx.create(opRef, operation(cloudId, opRef.id, "accepted_merge", "manual_action", [pair("words", survivorRef.id, survivor, after), pair("words", absorbedRef.id, absorbed, null)])); return true;
      });
    }
    case "correct": {
      assertDocId(mutation.wordId); const clean = mutation.text.trim(); const normalized = normalizeWord(clean); if (!clean || !normalized) return "unchanged"; if (mutation.wordId !== normalized) return "conflict";
      const wordRef = words.doc(mutation.wordId); const lockRef = locks.doc(normalized); const normRef = words.doc(normalized); const opRef = newOperation();
      return store.runTransaction(async (tx) => {
        if (!(await tx.get(cloud)).exists) return "unavailable";
        const snap = await tx.get(wordRef); const lock = await tx.get(lockRef); const normalizedSnap = normRef.path === wordRef.path ? snap : await tx.get(normRef);
        const matchingWords = await tx.get(words);
        if (!snap.exists || !isActive(snap.data()!) || String(snap.data()?.text ?? "") !== mutation.expectedText) return "unavailable";
        if ((lock.exists && String(lock.data()?.wordId ?? "") !== mutation.wordId) || (normalizedSnap.exists && normalizedSnap.id !== mutation.wordId) || matchingWords.docs.some((candidate) => candidate.id !== mutation.wordId && isActive(candidate.data()))) return "conflict";
        const before = snap.data()!; if (String(before.text ?? "") === clean && String(before.normalized ?? "") === normalized) return "unchanged";
        const beforeLock = lock.exists ? lock.data()! : null; const afterLock = { ...(beforeLock ?? {}), wordId: mutation.wordId, lastOperationId: opRef.id };
        const after = { ...before, text: clean, normalized, updatedAt: FieldValue.serverTimestamp(), lastOperationId: opRef.id };
        tx.update(wordRef, { text: clean, normalized, updatedAt: FieldValue.serverTimestamp(), lastOperationId: opRef.id }); tx.set(lockRef, afterLock);
        tx.create(opRef, operation(cloudId, opRef.id, "spelling_correction", "manual_action", [pair("words", wordRef.id, before, after), pair("wordNormalizationLocks", normalized, beforeLock, afterLock)])); return "updated";
      });
    }
    case "delete": {
      assertDocId(mutation.wordId); const wordRef = words.doc(mutation.wordId); const opRef = newOperation();
      return store.runTransaction(async (tx) => { if (!(await tx.get(cloud)).exists) return false; const snap = await tx.get(wordRef); if (!snap.exists || !isActive(snap.data()!)) return false; const before = snap.data()!; tx.delete(wordRef); tx.create(opRef, operation(cloudId, opRef.id, "delete_word", "manual_action", [pair("words", wordRef.id, before, null)])); return true; });
    }
    case "undo": {
      assertDocId(mutation.operationId); const opRef = operations.doc(mutation.operationId); const undoRef = newOperation();
      return store.runTransaction(async (tx) => {
        if (!(await tx.get(cloud)).exists) return { kind: "unavailable" };
        const originalSnap = await tx.get(opRef); if (!originalSnap.exists) return { kind: "unavailable" };
        const originalValue = originalSnap.data();
        if (!isReversibleOperationRecord(originalValue)) return { kind: "unavailable" };
        const original = originalValue;
        if (original.type === "undo") return { kind: "unavailable" };
        const undoAlready = await tx.get(operations.where("reversesOperationId", "==", mutation.operationId).limit(1));
        if (!undoAlready.empty) return { kind: "unavailable" };
        const current: ReversibleDocumentSnapshot[] = [];
        const docRefs = original.documents.map((entry) => {
          const ref = cloud.collection(entry.after.kind).doc(entry.after.documentId);
          return ref;
        });
        for (let index = 0; index < docRefs.length; index++) { const snap = await tx.get(docRefs[index]); const entry = original.documents[index]; current.push(snapshot(entry.after.kind, entry.after.documentId, snap.exists ? snap.data()! : null)); }
        const plan = planReversibleUndo(original, cloudId, mutation.operationId, current);
        if (plan.kind !== "ready") return plan;
        plan.restore.forEach((restore, index) => { const ref = docRefs[index]; if (restore.existed && restore.data) tx.set(ref, restore.data); else tx.delete(ref); });
        const undoDocuments = plan.reversalDocuments;
        tx.create(undoRef, operation(cloudId, undoRef.id, "undo", "undo", [...undoDocuments], mutation.operationId));
        return { kind: "undone", undoOperationId: undoRef.id };
      });
    }
  }
}

export async function getOperationSummaries(cloudId: string) {
  const { cloud } = refs(cloudId, "guard");
  const snapshot = await cloud.collection("operations").orderBy("createdAt", "desc").limit(30).get();
  const documents = snapshot.docs.filter((item) => isReversibleOperationRecord(item.data())).map((item) => ({ id: item.id, data: item.data() }));
  const reversibleIds = documents.filter(({ data }) => data.type !== "undo").map(({ id }) => id);
  const reversed = new Set<string>();
  for (let index = 0; index < reversibleIds.length; index += 30) {
    const ids = reversibleIds.slice(index, index + 30);
    if (ids.length === 0) continue;
    const undoEvents = await cloud.collection("operations").where("reversesOperationId", "in", ids).get();
    undoEvents.docs.forEach((event) => { const target = event.data().reversesOperationId; if (typeof target === "string") reversed.add(target); });
  }
  return documents.map(({ id, data }) => ({ id, type: data.type, status: data.type === "undo" ? "applied" : reversed.has(id) || data.status === "reversed" ? "reversed" : "applied", actor: data.actor, createdAt: data.createdAt?.toDate?.().toISOString?.() ?? null, affectedWords: [...new Set((Array.isArray(data.documents) ? data.documents : []).flatMap((entry: Pair) => [entry.before?.data?.text, entry.after?.data?.text]).filter((text): text is string => typeof text === "string" && Boolean(text)))], ...(typeof data.reversesOperationId === "string" ? { reversesOperationId: data.reversesOperationId } : {}) }));
}
