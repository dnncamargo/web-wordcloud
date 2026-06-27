"use client";

import { useState } from "react";
import { db } from "@/lib/firebase/client";
import {
  addDoc,
  collection,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";

export default function FirebaseTestPage() {
  const [status, setStatus] = useState("Aguardando teste...");
  const [items, setItems] = useState<string[]>([]);

  async function handleTest() {
    try {
      setStatus("Enviando documento para o Firebase...");

      await addDoc(collection(db, "connectionTests"), {
        message: "Conexão funcionando",
        createdAt: serverTimestamp(),
      });

      setStatus("Documento gravado. Lendo coleção...");

      const snapshot = await getDocs(collection(db, "connectionTests"));

      setItems(
        snapshot.docs.map((doc) => {
          const data = doc.data();
          return `${doc.id}: ${data.message ?? "sem mensagem"}`;
        })
      );

      setStatus("Conexão com Firebase funcionando.");
    } catch (error) {
      console.error(error);
      setStatus(
        error instanceof Error
          ? `Erro: ${error.message}`
          : "Erro desconhecido ao conectar ao Firebase."
      );
    }
  }

  return (
    <main className="evaporation-shell">
      <section className="evaporation-card">
        <p className="eyebrow">Firebase</p>
        <h1>Teste de conexão</h1>

        <p>{status}</p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleTest();
          }}
          className="idea-form"
        >
          <button type="submit">Testar Firebase</button>
        </form>

        <section className="local-list">
          <h2>Documentos lidos</h2>

          {items.length === 0 ? (
            <p className="empty-message">Nenhum documento lido ainda.</p>
          ) : (
            <ul>
              {items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </section>
      </section>
    </main>
  );
}