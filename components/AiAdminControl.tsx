"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import {
  isAiSessionState,
  type AiSessionState,
} from "@/lib/ai/admin-session-contract";

type RequestState = "idle" | "loading" | "submitting" | "logging-out";

export type AiAdminControlProps = Readonly<{
  onSessionChange?: (session: AiSessionState | null) => void;
  sessionInvalidationToken?: number;
}>;

async function readSessionState(response: Response) {
  if (!response.ok) throw new Error("request-failed");

  const payload: unknown = await response.json();

  if (!isAiSessionState(payload)) throw new Error("invalid-response");

  return payload;
}

export default function AiAdminControl({
  onSessionChange,
  sessionInvalidationToken = 0,
}: AiAdminControlProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [session, setSession] = useState<AiSessionState | null>(null);
  const [password, setPassword] = useState("");
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const onSessionChangeRef = useRef(onSessionChange);

  useEffect(() => {
    onSessionChangeRef.current = onSessionChange;
  }, [onSessionChange]);

  useEffect(() => {
    let isCurrent = true;

    void fetch("/api/ai/admin/session", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(readSessionState)
      .then((nextSession) => {
        if (!isCurrent) return;

        setSession(nextSession);
        onSessionChangeRef.current?.(nextSession);
        setErrorMessage("");
        setRequestState("idle");
      })
      .catch(() => {
        if (!isCurrent) return;

        setSession(null);
        onSessionChangeRef.current?.(null);
        setErrorMessage("Não foi possível verificar o estado da IA.");
        setRequestState("idle");
      });

    return () => {
      isCurrent = false;
    };
  }, [isOpen, sessionInvalidationToken]);

  function closePanel() {
    setIsOpen(false);
    setPassword("");
    setErrorMessage("");
    setRequestState("idle");
  }

  function openPanel() {
    setIsOpen(true);
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
      onSessionChangeRef.current?.(nextSession);
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
      onSessionChangeRef.current?.(nextSession);
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
                <p className="ai-admin-panel-description">A chave do serviço precisa ser configurada no ambiente do servidor.</p>
              </div>
            ) : session.authenticated ? (
              <div className="ai-admin-panel-content">
                <p className="ai-admin-panel-status">IA ativa nesta sessão.</p>
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
