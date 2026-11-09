import assert from "node:assert/strict";
import test from "node:test";
import { handleTeacherMutation } from "@/lib/firebase/serverRoute";
import { getServerFirestore } from "@/lib/firebase/admin";

const url = "http://localhost:3000/api/clouds/synthetic/operations/approve";
const request = (body: unknown, origin = "http://localhost:3000") => new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });

test("teacher mutation route rejects cross-origin requests before any database access", async () => {
  const response = await handleTeacherMutation(request({ action: "approve", newWordId: "pending_1", text: "synthetic" }, "https://attacker.example"), "synthetic", "approve");
  assert.equal(response.status, 403);
});

test("teacher mutation route accepts only the operation-specific shape and cannot accept a client actor", async () => {
  const extra = await handleTeacherMutation(request({ action: "approve", newWordId: "pending_1", text: "synthetic", actor: "ai_assisted_operation" }), "synthetic", "approve");
  assert.equal(extra.status, 400);
  const wrongAction = await handleTeacherMutation(request({ action: "exact-aggregate", newWordId: "pending_1", text: "synthetic" }), "synthetic", "approve");
  assert.equal(wrongAction.status, 400);
});

test("teacher mutation route rejects a document id that attempts to escape the cloud path", async () => {
  const response = await handleTeacherMutation(request({ action: "approve", newWordId: "other-cloud/pending", text: "synthetic" }), "synthetic", "approve");
  assert.equal(response.status, 400);
});

test("manual approve remains available without a PIN and the server records a manual actor", { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const cloudId = `synthetic_route_${Date.now()}`;
  const cloud = getServerFirestore().collection("clouds").doc(cloudId);
  try {
    await cloud.set({ title: "Synthetic route cloud" });
    await cloud.collection("newWords").doc("pending_1").set({ text: "Synthetic lantern", status: "pending", deviceId: "synthetic" });
    const response = await handleTeacherMutation(request({ action: "approve", newWordId: "pending_1", text: "Synthetic lantern" }), cloudId, "approve");
    assert.equal(response.status, 200);
    assert.equal((await cloud.collection("operations").get()).docs[0].data().actor, "manual_action");
    assert.equal((await cloud.collection("newWords").doc("pending_1").get()).data()?.status, "approved");
  } finally {
    const batch = getServerFirestore().batch();
    for (const name of ["operations", "newWords", "words"]) (await cloud.collection(name).get()).docs.forEach((item) => batch.delete(item.ref));
    batch.delete(cloud);
    await batch.commit();
  }
});

test("manual route does not mutate a nonexistent cloud", { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const cloudId = `missing_${Date.now()}`;
  const response = await handleTeacherMutation(request({ action: "approve", newWordId: "pending_1", text: "Synthetic" }), cloudId, "approve");
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { result: string }).result, "unavailable");
});
