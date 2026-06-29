import { db } from "@/lib/firebase/client";
import { normalizeWord } from "@/lib/normalizeWord";
import { addDoc, collection, deleteDoc, doc, getDoc, increment, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";

export type FirebaseCloud = {
  id: string;
  title: string;
  publicTitle: string;
  status: "draft" | "open" | "closed" | "archived";
};

export type FirebaseWord = {
  id: string;
  text: string;
  normalized: string;
  count: number;
  aliases?: string[];
};

export type FirebaseNewWord = {
  id: string;
  text: string;
  normalized: string;
  status: "pending" | "approved" | "rejected" | "merged";
  deviceId: string;
};

export type GlobalSettings = {
  activeCloudId: string | null;
  windSeed: number;
};

export function listenGlobalSettings(callback: (activeCloudId: string | null, windSeed: number) => void) {
  return onSnapshot(doc(db, "settings", "global"), (snapshot) => {
    const data = snapshot.data();

    callback(data?.activeCloudId ?? null, Number(data?.windSeed ?? 1));
  });
}

export function listenClouds(callback: (clouds: FirebaseCloud[]) => void) {
  return onSnapshot(collection(db, "clouds"), (snapshot) => {
    const statusOrder: Record<FirebaseCloud["status"], number> = {
      open: 0,
      draft: 1,
      closed: 2,
      archived: 3,
    };

    const clouds = snapshot.docs
      .map((document) => {
        const data = document.data();

        return {
          id: document.id,
          title: String(data.title ?? ""),
          publicTitle: String(data.publicTitle ?? ""),
          status: data.status ?? "draft",
        } as FirebaseCloud;
      })
      .sort((a, b) => {
        const statusDifference = statusOrder[a.status] - statusOrder[b.status];

        if (statusDifference !== 0) return statusDifference;

        return a.title.localeCompare(b.title, "pt-BR");
      });

    callback(clouds);
  });
}

export function listenCloud(cloudId: string, callback: (cloud: FirebaseCloud | null) => void) {
  return onSnapshot(doc(db, "clouds", cloudId), (snapshot) => {
    if (!snapshot.exists()) {
      callback(null);
      return;
    }

    const data = snapshot.data();

    callback({
      id: snapshot.id,
      title: String(data.title ?? ""),
      publicTitle: String(data.publicTitle ?? ""),
      status: data.status ?? "draft",
    });
  });
}

export function listenWords(cloudId: string, callback: (words: FirebaseWord[]) => void) {
  return onSnapshot(collection(db, "clouds", cloudId, "words"), (snapshot) => {
    callback(
      snapshot.docs.map((document) => {
        const data = document.data();

        return {
          id: document.id,
          text: String(data.text ?? ""),
          normalized: String(data.normalized ?? document.id),
          count: Number(data.count ?? 1),
          aliases: Array.isArray(data.aliases) ? data.aliases : [],
        };
      }),
    );
  });
}

export function listenNewWords(cloudId: string, callback: (words: FirebaseNewWord[]) => void) {
  return onSnapshot(collection(db, "clouds", cloudId, "newWords"), (snapshot) => {
    const words: FirebaseNewWord[] = snapshot.docs
      .map((document) => {
        const data = document.data();

        return {
          id: document.id,
          text: String(data.text ?? ""),
          normalized: String(data.normalized ?? ""),
          status: data.status ?? "pending",
          deviceId: String(data.deviceId ?? ""),
        };
      })
      .filter((word) => word.status === "pending");

    callback(words);
  });
}

export async function createCloud() {
  const cloudRef = doc(collection(db, "clouds"));

  await setDoc(cloudRef, {
    title: "Nova nuvem",
    publicTitle: "Digite a pergunta investigadora",
    status: "draft",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return cloudRef.id;
}

export async function activateCloud(cloudId: string) {
  const settingsRef = doc(db, "settings", "global");
  const settingsSnapshot = await getDoc(settingsRef);
  const previousActiveCloudId = settingsSnapshot.data()?.activeCloudId ?? null;

  if (previousActiveCloudId && previousActiveCloudId !== cloudId) {
    await updateDoc(doc(db, "clouds", previousActiveCloudId), {
      status: "closed",
      closedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  await updateDoc(doc(db, "clouds", cloudId), {
    status: "open",
    activatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await setDoc(
    settingsRef,
    {
      activeCloudId: cloudId,
    },
    { merge: true },
  );
}

export async function archiveCloud(cloudId: string) {
  await updateDoc(doc(db, "clouds", cloudId), {
    status: "archived",
    archivedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const settingsRef = doc(db, "settings", "global");
  const settingsSnapshot = await getDoc(settingsRef);

  if (settingsSnapshot.data()?.activeCloudId === cloudId) {
    await setDoc(
      settingsRef,
      {
        activeCloudId: null,
      },
      { merge: true },
    );
  }
}

export async function unarchiveCloud(cloudId: string) {
  await updateDoc(doc(db, "clouds", cloudId), {
    status: "closed",
    unarchivedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateCloudText(cloudId: string, field: "title" | "publicTitle", value: string) {
  await updateDoc(doc(db, "clouds", cloudId), {
    [field]: value,
    updatedAt: serverTimestamp(),
  });
}

export async function submitNewWord(cloudId: string, text: string, deviceId: string) {
  const normalized = normalizeWord(text);

  if (!normalized) return;

  await addDoc(collection(db, "clouds", cloudId, "newWords"), {
    text: text.trim(),
    normalized,
    status: "pending",
    deviceId,
    createdAt: serverTimestamp(),
  });
}

export async function approveNewWord(cloudId: string, newWordId: string, text: string) {
  const normalized = normalizeWord(text);

  if (!normalized) return;

  const wordRef = doc(db, "clouds", cloudId, "words", normalized);
  const wordSnapshot = await getDoc(wordRef);

  if (wordSnapshot.exists()) {
    await updateDoc(wordRef, {
      count: increment(1),
      updatedAt: serverTimestamp(),
    });
  } else {
    await setDoc(wordRef, {
      text: text.trim(),
      normalized,
      count: 1,
      aliases: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  await updateDoc(doc(db, "clouds", cloudId, "newWords", newWordId), {
    status: "approved",
    reviewedAt: serverTimestamp(),
  });
}

export async function mergeNewWordIntoWord(cloudId: string, newWord: FirebaseNewWord, targetWord: FirebaseWord) {
  await updateDoc(doc(db, "clouds", cloudId, "words", targetWord.id), {
    count: increment(1),
    aliases: [...new Set([...(targetWord.aliases ?? []), newWord.text])],
    updatedAt: serverTimestamp(),
  });

  await updateDoc(doc(db, "clouds", cloudId, "newWords", newWord.id), {
    status: "merged",
    mergedIntoWordId: targetWord.id,
    reviewedAt: serverTimestamp(),
  });
}

export async function rejectNewWord(cloudId: string, newWordId: string) {
  await updateDoc(doc(db, "clouds", cloudId, "newWords", newWordId), {
    status: "rejected",
    reviewedAt: serverTimestamp(),
  });
}

export async function updateWordText(cloudId: string, word: FirebaseWord, nextText: string) {
  await updateDoc(doc(db, "clouds", cloudId, "words", word.id), {
    text: nextText.trim(),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteWord(cloudId: string, wordId: string) {
  await deleteDoc(doc(db, "clouds", cloudId, "words", wordId));
}

export async function blowWind() {
  await setDoc(
    doc(db, "settings", "global"),
    {
      windSeed: Date.now(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}
