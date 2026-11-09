import assert from "node:assert/strict";
import test from "node:test";
import { getServerFirestore } from "@/lib/firebase/admin";
import { applyTeacherMutation, getOperationSummaries } from "@/lib/firebase/serverOperations";

test("server mutations are atomic, scoped, summarized, and undo appends an event without rewriting history", { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const cloudId = `synthetic_${Date.now()}`;
  const db = getServerFirestore();
  const cloud = db.collection("clouds").doc(cloudId);
  try {
    await cloud.set({ title: "Synthetic cloud" });
    await cloud.collection("words").doc("community_garden").set({ text: "Community garden", normalized: "community garden", count: 2, aliases: [] });
    await cloud.collection("newWords").doc("pending_1").set({ text: "Neighborhood garden", normalized: "neighborhood garden", status: "pending", deviceId: "synthetic" });
    assert.equal(await applyTeacherMutation(cloudId, { action: "merge-pending", newWordId: "pending_1", targetWordId: "community_garden" }), true);
    const beforeUndo = await cloud.collection("operations").get();
    assert.equal(beforeUndo.size, 1);
    const original = beforeUndo.docs[0].data();
    assert.equal(original.actor, "manual_action");
    const summary = await getOperationSummaries(cloudId);
    assert.equal(summary.length, 1);
    assert.deepEqual(summary[0].affectedWords.sort(), ["Community garden", "Neighborhood garden"].sort());
    const firstUndoRace = await Promise.all([
      applyTeacherMutation(cloudId, { action: "undo", operationId: beforeUndo.docs[0].id }) as Promise<{ kind: string }>,
      applyTeacherMutation(cloudId, { action: "undo", operationId: beforeUndo.docs[0].id }) as Promise<{ kind: string }>,
    ]);
    assert.deepEqual(firstUndoRace.map(({ kind }) => kind).sort(), ["unavailable", "undone"]);
    const afterUndo = await cloud.collection("operations").get();
    assert.equal(afterUndo.size, 2);
    assert.deepEqual((await cloud.collection("operations").doc(beforeUndo.docs[0].id).get()).data(), original);
    assert.equal((await cloud.collection("newWords").doc("pending_1").get()).data()?.status, "pending");
    const latestHistory = await getOperationSummaries(cloudId);
    assert.equal(latestHistory[0].type, "undo");
    assert.equal(latestHistory.find(({ id }) => id === beforeUndo.docs[0].id)?.status, "reversed");
    const concurrentUndo = await Promise.all([
      applyTeacherMutation(cloudId, { action: "undo", operationId: beforeUndo.docs[0].id }) as Promise<{ kind: string }>,
      applyTeacherMutation(cloudId, { action: "undo", operationId: beforeUndo.docs[0].id }) as Promise<{ kind: string }>,
    ]);
    assert.deepEqual(concurrentUndo.map(({ kind }) => kind).sort(), ["unavailable", "unavailable"]);
    assert.equal((await cloud.collection("operations").get()).size, 2);
  } finally {
    const snapshot = await cloud.collection("operations").get();
    const pending = await cloud.collection("newWords").get();
    const words = await cloud.collection("words").get();
    const batch = db.batch();
    snapshot.docs.forEach((item) => batch.delete(item.ref)); pending.docs.forEach((item) => batch.delete(item.ref)); words.docs.forEach((item) => batch.delete(item.ref));
    batch.delete(cloud);
    await batch.commit();
  }
});

test("exact aggregation is revalidated case-insensitively, rejects non-matches, and records its functional source", { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const cloudId = `synthetic_exact_${Date.now()}`;
  const cloud = getServerFirestore().collection("clouds").doc(cloudId);
  try {
    await cloud.set({ title: "Synthetic" });
    await cloud.collection("words").doc("green_roof").set({ text: "Green roof", normalized: "green roof", count: 3, aliases: [] });
    await cloud.collection("newWords").doc("case_match").set({ text: "GREEN ROOF", status: "pending" });
    assert.equal(await applyTeacherMutation(cloudId, { action: "exact-aggregate", newWordId: "case_match", targetWordId: "green_roof" }), true);
    assert.equal((await cloud.collection("words").doc("green_roof").get()).data()?.count, 4);
    assert.equal((await cloud.collection("newWords").doc("case_match").get()).data()?.status, "approved");
    const exactEvent = (await cloud.collection("operations").get()).docs[0].data();
    assert.equal(exactEvent.actor, "exact_match_automation");

    await cloud.collection("words").doc("river_walk").set({ text: "River walk", normalized: "river walk", count: 1, aliases: [] });
    await cloud.collection("newWords").doc("not_exact").set({ text: "River cleanup", status: "pending" });
    assert.equal(await applyTeacherMutation(cloudId, { action: "exact-aggregate", newWordId: "not_exact", targetWordId: "river_walk" }), false);
    assert.equal((await cloud.collection("words").doc("river_walk").get()).data()?.count, 1);
    assert.equal((await cloud.collection("newWords").doc("not_exact").get()).data()?.status, "pending");

    await cloud.collection("words").doc("duplicate_river_walk").set({ text: "River walk", normalized: "river walk", count: 1 });
    await cloud.collection("newWords").doc("ambiguous_exact").set({ text: "RIVER WALK", status: "pending" });
    assert.equal(await applyTeacherMutation(cloudId, { action: "exact-aggregate", newWordId: "ambiguous_exact", targetWordId: "river_walk" }), false);
    assert.equal((await cloud.collection("words").doc("river_walk").get()).data()?.count, 1);
  } finally {
    const collections = ["operations", "newWords", "words"];
    const batch = getServerFirestore().batch();
    for (const name of collections) (await cloud.collection(name).get()).docs.forEach((item) => batch.delete(item.ref));
    batch.delete(cloud); await batch.commit();
  }
});

test("failed operation snapshot validation aborts all business writes", { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const cloudId = `synthetic_rollback_${Date.now()}`;
  const cloud = getServerFirestore().collection("clouds").doc(cloudId);
  try {
    await cloud.set({ title: "Synthetic" });
    await cloud.collection("words").doc("large_target").set({ text: "Target", normalized: "target", count: 4, aliases: [] });
    await cloud.collection("newWords").doc("large_pending").set({ text: "x".repeat(400_000), status: "pending" });
    await assert.rejects(applyTeacherMutation(cloudId, { action: "merge-pending", newWordId: "large_pending", targetWordId: "large_target" }));
    assert.equal((await cloud.collection("words").doc("large_target").get()).data()?.count, 4);
    assert.equal((await cloud.collection("newWords").doc("large_pending").get()).data()?.status, "pending");
    assert.equal((await cloud.collection("operations").get()).size, 0);
  } finally {
    const batch = getServerFirestore().batch();
    for (const name of ["operations", "newWords", "words"]) (await cloud.collection(name).get()).docs.forEach((item) => batch.delete(item.ref));
    batch.delete(cloud); await batch.commit();
  }
});

test("spelling corrections lock normalization in the transaction and undo restores the lock state", { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const cloudId = `synthetic_lock_${Date.now()}`;
  const cloud = getServerFirestore().collection("clouds").doc(cloudId);
  try {
    await cloud.set({ title: "Synthetic" });
    await cloud.collection("words").doc("river safety").set({ text: "River safety", normalized: "river safety", count: 1, aliases: [] });
    assert.equal(await applyTeacherMutation(cloudId, { action: "correct", wordId: "river safety", expectedText: "River safety", text: "RIVER SAFETY" }), "updated");
    const lock = await cloud.collection("wordNormalizationLocks").doc("river safety").get();
    assert.equal(lock.data()?.wordId, "river safety");
    const event = (await cloud.collection("operations").get()).docs[0];
    const undone = await applyTeacherMutation(cloudId, { action: "undo", operationId: event.id }) as { kind: string };
    assert.equal(undone.kind, "undone");
    assert.equal((await cloud.collection("wordNormalizationLocks").doc("river safety").get()).exists, false);
    assert.equal((await cloud.collection("words").doc("river safety").get()).data()?.text, "River safety");
    await cloud.collection("words").doc("duplicate river safety").set({ text: "River safety duplicate", normalized: "river safety", count: 1 });
    assert.equal(await applyTeacherMutation(cloudId, { action: "correct", wordId: "river safety", expectedText: "River safety", text: "RIVER SAFETY" }), "conflict");
  } finally {
    const batch = getServerFirestore().batch();
    for (const name of ["operations", "newWords", "words", "wordNormalizationLocks"]) (await cloud.collection(name).get()).docs.forEach((item) => batch.delete(item.ref));
    batch.delete(cloud); await batch.commit();
  }
});

test("accepted-word merge preserves the chosen canonical form and undo restores both original word IDs", { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const cloudId = `synthetic_accepted_merge_${Date.now()}`;
  const cloud = getServerFirestore().collection("clouds").doc(cloudId);
  try {
    await cloud.set({ title: "Synthetic" });
    await cloud.collection("words").doc("community garden").set({ text: "Community garden", normalized: "community garden", count: 3, aliases: [] });
    await cloud.collection("words").doc("school garden").set({ text: "School garden", normalized: "school garden", count: 2, aliases: [] });
    assert.equal(await applyTeacherMutation(cloudId, { action: "merge-accepted", firstWordId: "community garden", secondWordId: "school garden", text: "School garden" }), true);
    assert.equal((await cloud.collection("words").doc("school garden").get()).exists, false);
    const survivor = await cloud.collection("words").doc("community garden").get();
    assert.equal(survivor.data()?.text, "School garden");
    assert.equal(survivor.data()?.count, 5);
    const operation = (await cloud.collection("operations").get()).docs[0];
    const undo = await applyTeacherMutation(cloudId, { action: "undo", operationId: operation.id }) as { kind: string };
    assert.equal(undo.kind, "undone");
    assert.equal((await cloud.collection("words").doc("community garden").get()).data()?.count, 3);
    assert.equal((await cloud.collection("words").doc("school garden").get()).data()?.count, 2);
    assert.deepEqual((await cloud.collection("operations").doc(operation.id).get()).data(), operation.data());
  } finally {
    const batch = getServerFirestore().batch();
    for (const name of ["operations", "newWords", "words", "wordNormalizationLocks"]) (await cloud.collection(name).get()).docs.forEach((item) => batch.delete(item.ref));
    batch.delete(cloud); await batch.commit();
  }
});

test("canonical representation selection persists independently and remains undoable", { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const cloudId = `synthetic_canonical_form_${Date.now()}`;
  const cloud = getServerFirestore().collection("clouds").doc(cloudId);
  try {
    await cloud.set({ title: "Synthetic" });
    const wordRef = cloud.collection("words").doc("community garden");
    await wordRef.set({ text: "Community garden", normalized: "community garden", count: 5, aliases: ["Neighborhood garden"] });

    assert.equal(await applyTeacherMutation(cloudId, { action: "canonical-form", wordId: "community garden", text: "Neighborhood garden" }), true);

    // A fresh read represents the state restored after a page reload.
    const reloadedWord = (await wordRef.get()).data();
    assert.equal(reloadedWord?.text, "Neighborhood garden");
    assert.deepEqual(reloadedWord?.aliases, ["Community garden"]);

    const operation = (await cloud.collection("operations").get()).docs[0];
    assert.equal(operation.data().type, "spelling_correction");
    const undo = await applyTeacherMutation(cloudId, { action: "undo", operationId: operation.id }) as { kind: string };
    assert.equal(undo.kind, "undone");
    const restoredWord = (await wordRef.get()).data();
    assert.equal(restoredWord?.text, "Community garden");
    assert.deepEqual(restoredWord?.aliases, ["Neighborhood garden"]);
    assert.deepEqual((await cloud.collection("operations").doc(operation.id).get()).data(), operation.data());
    assert.equal((await cloud.collection("operations").get()).size, 2);
  } finally {
    const batch = getServerFirestore().batch();
    for (const name of ["operations", "newWords", "words", "wordNormalizationLocks"]) (await cloud.collection(name).get()).docs.forEach((item) => batch.delete(item.ref));
    batch.delete(cloud);
    await batch.commit();
  }
});

test("competing exact-match requests increment the accepted word only once", { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const cloudId = `synthetic_race_${Date.now()}`;
  const cloud = getServerFirestore().collection("clouds").doc(cloudId);
  try {
    await cloud.set({ title: "Synthetic" });
    await cloud.collection("words").doc("seed_library").set({ text: "Seed library", normalized: "seed library", count: 1, aliases: [] });
    await cloud.collection("newWords").doc("one_submission").set({ text: "SEED LIBRARY", status: "pending" });
    const outcomes = await Promise.all([
      applyTeacherMutation(cloudId, { action: "exact-aggregate", newWordId: "one_submission", targetWordId: "seed_library" }),
      applyTeacherMutation(cloudId, { action: "exact-aggregate", newWordId: "one_submission", targetWordId: "seed_library" }),
    ]);
    assert.equal(outcomes.filter(Boolean).length, 1);
    assert.equal((await cloud.collection("words").doc("seed_library").get()).data()?.count, 2);
    assert.equal((await cloud.collection("operations").get()).size, 1);
  } finally {
    const batch = getServerFirestore().batch();
    for (const name of ["operations", "newWords", "words"]) (await cloud.collection(name).get()).docs.forEach((item) => batch.delete(item.ref));
    batch.delete(cloud); await batch.commit();
  }
});
