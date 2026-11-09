import "server-only";

import { getOperationSummaries } from "@/lib/firebase/serverOperations";

export async function GET(request: Request, { params }: { params: Promise<{ cloudId: string }> }) {
  const { cloudId } = await params;
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(cloudId)) return Response.json({ error: "Nuvem inválida." }, { status: 400 });
  try {
    const operations = await getOperationSummaries(cloudId);
    return Response.json({ operations }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Não foi possível carregar o histórico." }, { status: 503 });
  }
}
