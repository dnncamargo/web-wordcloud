"use client";

import { FormEvent, useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";

type AiSessionState = {
  configured: boolean;
  authenticated: boolean;
  model?: string;
};

type RequestState = "idle" | "loading" | "submitting" | "logging-out";

function isAiSessionState(value: unknown): value is AiSessionState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.configured === "boolean" &&
    typeof candidate.authenticated === "boolean" &&
    (candidate.model === undefined || typeof candidate.model === "string")
  );
}

async function readSessionState(response: Response) {
  if (!response.ok) throw new Error("request-failed");

  const payload: unknown = await response.json();

  if (!isAiSessionState(payload)) throw new Error("invalid-response");

  return payload;
}

export default function AiAdminControl() {
  const [isOpen, setIsOpen] = useState(false);
  const [session, setSession] = useState<AiSessionState | null>(null);
  const [password, setPassword] = useState("");
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!isOpen) return;

    let isCurrent = true;

    void fetch("/api/ai/admin/session", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(readSessionState)
      .then((nextSession) => {
        if (!isCurrent) return;

        setSession(nextSession);
        setRequestState("idle");
      })
      .catch(() => {
        if (!isCurrent) return;

        setErrorMessage("Não foi possível verificar o estado da IA.");
        setRequestState("idle");
      });

    return () => {
      isCurrent = false;
    };
  }, [isOpen]);

  function closePanel() {
    setIsOpen(false);
    setSession(null);
    setPassword("");
    setErrorMessage("");
    setRequestState("idle");
  }

  function openPanel() {
    setIsOpen(true);
    setSession(null);
    setPassword("");
    setErrorMessage("");
    setRequestState("loading");
  }

  async function handleActivation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestState("submitting");
    setErrorMessage("");

    try {
      const response = await fetch("/api/ai/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password }),
      });
      const nextSession = await readSessionState(response);

      if (!nextSession.authenticated) throw new Error("not-authenticated");

      setSession(nextSession);
      setPassword("");
    } catch {
      setPassword("");
      setErrorMessage("Não foi possível ativar a IA. Verifique a senha.");
    } finally {
      setRequestState("idle");
    }
  }

  async function handleLogout() {
    setRequestState("logging-out");
    setErrorMessage("");

    try {
      const response = await fetch("/api/ai/admin/session", {
        method: "DELETE",
        credentials: "same-origin",
      });
      const nextSession = await readSessionState(response);

      setSession(nextSession);
    } catch {
      setErrorMessage("Não foi possível desativar a IA.");
    } finally {
      setRequestState("idle");
    }
  }

  return (
    <>
      <button
        className={`button icon-button ${session?.authenticated ? "active" : ""}`}
        onClick={openPanel}
        title="IA"
        aria-label="IA"
        type="button"
      >
        <Sparkles size={15} strokeWidth={2.2} />
      </button>

      {isOpen && (
        <div className="ai-admin-overlay" role="presentation" onClick={closePanel}>
          <section
            className="ai-admin-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-admin-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="ai-admin-panel-header">
              <div>
                <p className="ai-admin-panel-eyebrow">Controle</p>
                <h2 id="ai-admin-title">Inteligência artificial</h2>
              </div>

              <button className="button icon-button" onClick={closePanel} aria-label="Fechar" title="Fechar" type="button">
                <X size={16} strokeWidth={2.2} />
              </button>
            </header>

            {requestState === "loading" ? (
              <p className="ai-admin-panel-message">Verificando disponibilidade...</p>
            ) : !session ? (
              <p className="ai-admin-panel-error" role="alert">
                {errorMessage || "Não foi possível verificar o estado da IA."}
              </p>
            ) : !session.configured ? (
              <div className="ai-admin-panel-content">
                <p className="ai-admin-panel-status">IA não configurada neste servidor.</p>
                <p className="ai-admin-panel-description">A chave do OpenRouter precisa ser configurada no ambiente do servidor.</p>
              </div>
            ) : session.authenticated ? (
              <div className="ai-admin-panel-content">
                <p className="ai-admin-panel-status">IA ativa nesta sessão.</p>
                {session.model && <p className="ai-admin-panel-description">Modelo: {session.model}</p>}
                <button className="button ai-admin-panel-action" onClick={handleLogout} disabled={requestState === "logging-out"} type="button">
                  {requestState === "logging-out" ? "Desativando..." : "Desativar IA"}
                </button>
              </div>
            ) : (
              <form className="ai-admin-panel-content" onSubmit={handleActivation}>
                <p className="ai-admin-panel-status">IA disponível.</p>
                <label className="ai-admin-panel-label" htmlFor="ai-admin-password">
                  Senha de administração
                </label>
                <input
                  id="ai-admin-password"
                  className="ai-admin-panel-input"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  disabled={requestState === "submitting"}
                  required
                />
                {errorMessage && <p className="ai-admin-panel-error" role="alert">{errorMessage}</p>}
                <button className="highlight-button ai-admin-panel-action" disabled={requestState === "submitting"} type="submit">
                  {requestState === "submitting" ? "Ativando..." : "Ativar IA"}
                </button>
              </form>
            )}

            {errorMessage && session?.authenticated && <p className="ai-admin-panel-error" role="alert">{errorMessage}</p>}
          </section>
        </div>
      )}
    </>
  );
}
