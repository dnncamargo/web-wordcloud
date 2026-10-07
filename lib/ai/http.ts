import "server-only";

export function jsonNoStore(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  });
}

export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");

  if (!origin) return false;

  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function isJsonRequest(request: Request) {
  const contentType = request.headers.get("content-type");

  return contentType?.split(";", 1)[0].trim().toLowerCase() === "application/json";
}

export function hasOversizedContentLength(request: Request, maximumBytes: number) {
  const contentLength = request.headers.get("content-length");

  if (contentLength === null) return false;

  const parsedLength = Number(contentLength);

  return Number.isSafeInteger(parsedLength) && parsedLength > maximumBytes;
}
