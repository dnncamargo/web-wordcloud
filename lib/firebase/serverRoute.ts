import "server-only";

import { applyTeacherMutation, type TeacherMutation } from "@/lib/firebase/serverOperations";

const fieldSets: Record<TeacherMutation["action"], readonly string[]> = {
  approve: ["newWordId", "text"], "approve-as": ["newWordId", "text"], "exact-aggregate": ["newWordId", "targetWordId"],
  "merge-pending": ["newWordId", "targetWordId"], "canonical-form": ["wordId", "text"], "merge-accepted": ["firstWordId", "secondWordId", "text"],
  reject: ["newWordId"], correct: ["wordId", "expectedText", "text"], delete: ["wordId"], undo: ["operationId"],
};

export async function handleTeacherMutation(request: Request, cloudId: string, action: TeacherMutation["action"]): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(cloudId)) return Response.json({ error: "Nuvem inválida." }, { status: 400 });
  const origin = request.headers.get("origin");
  const requestUrl = new URL(request.url);
  let parsedOrigin: URL | null = null;
  try { if (origin) parsedOrigin = new URL(origin); } catch { /* Invalid origins are denied below. */ }
  if (!parsedOrigin || parsedOrigin.origin !== requestUrl.origin) return Response.json({ error: "Origem da solicitação inválida." }, { status: 403 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return Response.json({ error: "Formato de solicitação inválido." }, { status: 415 });
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 16_384) return Response.json({ error: "Solicitação excede o limite permitido." }, { status: 413 });
  let body: unknown;
  try {
    if (request.body) {
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > 16_384) { await reader.cancel(); return Response.json({ error: "Solicitação excede o limite permitido." }, { status: 413 }); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      body = JSON.parse(new TextDecoder().decode(bytes));
    } else body = null;
  } catch { return Response.json({ error: "Solicitação inválida." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Solicitação inválida." }, { status: 400 });
  const record = body as Record<string, unknown>;
  const allowed = ["action", ...fieldSets[action]];
  if (record.action !== action || Object.keys(record).some((key) => !allowed.includes(key)) || fieldSets[action].some((key) => typeof record[key] !== "string" || (record[key] as string).length > 4000)) {
    return Response.json({ error: "Dados da operação inválidos." }, { status: 400 });
  }
  if (fieldSets[action].some((key) => /Id$/u.test(key) && (!(record[key] as string) || (record[key] as string).includes("/") || record[key] === "." || record[key] === ".."))) {
    return Response.json({ error: "Referência de documento inválida." }, { status: 400 });
  }
  try {
    const result = await applyTeacherMutation(cloudId, record as unknown as TeacherMutation);
    return Response.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Não foi possível concluir a operação. Nenhuma confirmação de alteração foi recebida." }, { status: 500 });
  }
}
