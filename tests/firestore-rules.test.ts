import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
test("Firestore rules preserve open reads and pending submissions while denying protected direct mutations", { skip: !emulatorHost }, async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  const host = emulatorHost!.split(":");
  const env = await initializeTestEnvironment({ projectId: "demo-web-wordcloud", firestore: { host: host[0], port: Number(host[1]), rules } });
  try {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "clouds/c01"), { title: "Synthetic" });
      await setDoc(doc(context.firestore(), "clouds/c01/words/w01"), { text: "synthetic word", normalized: "synthetic word", count: 1 });
      await setDoc(doc(context.firestore(), "clouds/c01/newWords/n01"), { text: "synthetic pending", normalized: "synthetic pending", status: "pending", deviceId: "synthetic-device", createdAt: new Date() });
      await setDoc(doc(context.firestore(), "clouds/c01/operations/o01"), { type: "synthetic" });
      await setDoc(doc(context.firestore(), "clouds/c01/wordNormalizationLocks/l01"), { wordId: "w01" });
      await setDoc(doc(context.firestore(), "settings/global"), { activeCloudId: "c01" });
    });
    const firestore = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(firestore, "clouds/c01")));
    await assertSucceeds(getDocs(collection(firestore, "clouds/c01/words")));
    await assertSucceeds(getDocs(collection(firestore, "clouds/c01/newWords")));
    await assertSucceeds(getDoc(doc(firestore, "settings/global")));
    await assertSucceeds(setDoc(doc(firestore, "settings/global"), { windSeed: 9 }, { merge: true }));
    await assertSucceeds(updateDoc(doc(firestore, "clouds/c01"), { title: "Still public baseline" }));
    await assertSucceeds(setDoc(doc(firestore, "connectionTests/synthetic"), { ready: true }));
    await assertFails(updateDoc(doc(firestore, "connectionTests/synthetic"), { ready: false }));
    await assertSucceeds(setDoc(doc(firestore, "clouds/c01/newWords/n02"), { text: "another synthetic submission", normalized: "another synthetic submission", status: "pending", deviceId: "synthetic-device", createdAt: new Date() }));
    await assertFails(setDoc(doc(firestore, "clouds/c01/newWords/n03"), { text: "wrong status", normalized: "wrong status", status: "approved", deviceId: "synthetic-device", createdAt: new Date() }));
    await assertFails(updateDoc(doc(firestore, "clouds/c01/newWords/n01"), { status: "approved" }));
    await assertFails(deleteDoc(doc(firestore, "clouds/c01/words/w01")));
    await assertFails(setDoc(doc(firestore, "clouds/c01/words/w02"), { text: "direct client mutation" }));
    await assertFails(getDoc(doc(firestore, "clouds/c01/operations/o01")));
    await assertFails(setDoc(doc(firestore, "clouds/c01/operations/o02"), { type: "direct" }));
    await assertFails(getDoc(doc(firestore, "clouds/c01/wordNormalizationLocks/l01")));
    await assertFails(deleteDoc(doc(firestore, "clouds/c01/wordNormalizationLocks/l01")));
    await assertFails(getDoc(doc(firestore, "clouds/c01/privateCollection/x01")));
  } finally {
    await env.cleanup();
  }
});
