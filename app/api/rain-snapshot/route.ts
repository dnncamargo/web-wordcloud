export const dynamic = "force-dynamic";

type FirestoreFields = Record<string, any>;

function firestoreUrl(path: string) {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

  if (!projectId || !apiKey) {
    throw new Error("Firebase env ausente.");
  }

  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}?key=${apiKey}`;
}

function getString(fields: FirestoreFields | undefined, key: string) {
  return fields?.[key]?.stringValue ?? "";
}

function getNumber(fields: FirestoreFields | undefined, key: string) {
  return Number(fields?.[key]?.integerValue ?? fields?.[key]?.doubleValue ?? 0);
}

export async function GET() {
  try {
    const settingsResponse = await fetch(firestoreUrl("settings/global"), {
      cache: "no-store",
    });

    if (!settingsResponse.ok) {
      return Response.json(
        {
          ok: false,
          error: "Não foi possível ler settings/global.",
          status: settingsResponse.status,
        },
        { status: 200 }
      );
    }

    const settingsDoc = await settingsResponse.json();
    const activeCloudId = getString(settingsDoc.fields, "activeCloudId");

    if (!activeCloudId) {
      return Response.json(
        {
          ok: true,
          activeCloudId: null,
          cloud: null,
          words: [],
        },
        {
          headers: {
            "cache-control": "no-store",
          },
        }
      );
    }

    const [cloudResponse, wordsResponse] = await Promise.all([
      fetch(firestoreUrl(`clouds/${activeCloudId}`), { cache: "no-store" }),
      fetch(firestoreUrl(`clouds/${activeCloudId}/words`), {
        cache: "no-store",
      }),
    ]);

    if (!cloudResponse.ok) {
      return Response.json(
        {
          ok: false,
          error: "Não foi possível ler a nuvem ativa.",
          status: cloudResponse.status,
          activeCloudId,
        },
        { status: 200 }
      );
    }

    const cloudDoc = await cloudResponse.json();
    const wordsList = wordsResponse.ok ? await wordsResponse.json() : {};

    const cloud = {
      id: activeCloudId,
      title: getString(cloudDoc.fields, "title"),
      publicTitle: getString(cloudDoc.fields, "publicTitle"),
      status: getString(cloudDoc.fields, "status"),
    };

    const words = (wordsList.documents ?? [])
      .map((document: any) => {
        const nameParts = String(document.name ?? "").split("/");

        return {
          id: nameParts[nameParts.length - 1],
          text: getString(document.fields, "text"),
          count: getNumber(document.fields, "count") || 1,
        };
      })
      .sort((a: any, b: any) => b.count - a.count);

    return Response.json(
      {
        ok: true,
        activeCloudId,
        cloud,
        words,
      },
      {
        headers: {
          "cache-control": "no-store",
        },
      }
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro desconhecido ao gerar snapshot.",
      },
      { status: 200 }
    );
  }
}