"use client";

import { useActionState } from "react";
import { loginSky, type SkyLoginState } from "@/app/sky/actions";

const initialState: SkyLoginState = { error: null };

export default function SkyLoginForm() {
  const [state, formAction, isPending] = useActionState(loginSky, initialState);

  return (
    <form className="sky-login-card" action={formAction}>
      <div>
        <p className="sky-login-eyebrow">Nuvem Digital</p>
        <h1>Entrar no Céu</h1>
        <p className="sky-login-description">Acesso administrativo.</p>
      </div>

      <label className="sky-login-label" htmlFor="sky-password">
        Senha
      </label>
      <input
        id="sky-password"
        name="password"
        type="password"
        autoComplete="current-password"
        className="sky-login-input"
        required
        autoFocus
      />

      <button className="highlight-button sky-login-button" type="submit" disabled={isPending}>
        {isPending ? "Entrando..." : "Entrar"}
      </button>

      <p className="sky-login-error" aria-live="polite">
        {state.error}
      </p>
    </form>
  );
}
