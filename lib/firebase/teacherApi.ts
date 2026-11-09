"use client";

export type TeacherAction = "approve" | "approve-as" | "exact-aggregate" | "merge-pending" | "canonical-form" | "merge-accepted" | "reject" | "correct" | "delete" | "undo";

export async function callTeacherAction<T>(cloudId: string, action: TeacherAction, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(`/api/clouds/${encodeURIComponent(cloudId)}/operations/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ action, ...payload }),
  });
  const result = await response.json().catch(() => null) as { result?: T; error?: string } | null;
  if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "Não foi possível concluir a operação.");
  return result?.result as T;
}

export function listenTeacherOperationSummaries(cloudId: string, callback: (operations: WordOperationSummary[]) => void) {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const poll = async () => {
    controller = new AbortController();
    try {
      const response = await fetch(`/api/clouds/${encodeURIComponent(cloudId)}/operations`, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
      if (response.ok) {
        const payload = await response.json() as { operations?: WordOperationSummary[] };
        if (active && Array.isArray(payload.operations)) callback(payload.operations);
      }
    } catch {
      // Retain the last displayed history while the server is temporarily unavailable.
    } finally {
      if (active) timer = setTimeout(poll, 5000);
    }
  };
  void poll();
  return () => { active = false; controller?.abort(); if (timer) clearTimeout(timer); };
}

import type { WordOperationSummary } from "@/lib/firebase/cloudService";
