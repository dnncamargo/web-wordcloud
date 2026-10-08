import "server-only";

import {
  MAX_BODY_BYTES,
  validateTriageInput,
} from "@/lib/ai/triage-contract";

export {
  MAX_BODY_BYTES,
  MAX_ACCEPTED_WORDS,
  MAX_ACCEPTED_MERGE_SUGGESTIONS,
  MAX_COMBINED_WORDS,
  MAX_PENDING_WORDS,
  MAX_QUESTION_CODE_POINTS,
  MAX_WORD_ID_CODE_POINTS,
  MAX_WORD_TEXT_CODE_POINTS,
  TriageValidationError,
  validateTriageInput as validatePaidTriageInput,
  validateTriageInput,
} from "@/lib/ai/triage-contract";
export type {
  TriageInput,
  TriageResult,
  TriageResponse,
  TriageWord,
} from "@/lib/ai/triage-contract";

export type PaidTriageInput = import("@/lib/ai/triage-contract").TriageInput;

export type BoundedBodyResult =
  | Readonly<{ status: "ok"; body: string }>
  | Readonly<{ status: "too-large" }>
  | Readonly<{ status: "invalid" }>;

export type PaidTriageInputResult =
  | Readonly<{ status: "ok"; input: PaidTriageInput }>
  | Readonly<{ status: "too-large" }>
  | Readonly<{ status: "invalid" }>;

export async function readBoundedRequestBody(
  request: Request,
  maximumBytes = MAX_BODY_BYTES,
): Promise<BoundedBodyResult> {
  const contentLength = request.headers.get("content-length");

  if (contentLength !== null) {
    const parsedLength = Number(contentLength);

    if (
      Number.isSafeInteger(parsedLength) &&
      parsedLength >= 0 &&
      parsedLength > maximumBytes
    ) {
      return { status: "too-large" };
    }
  }

  if (request.body === null) {
    return { status: "ok", body: "" };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const result = await reader.read();

      if (result.done) break;

      totalBytes += result.value.byteLength;

      if (totalBytes > maximumBytes) {
        try {
          await reader.cancel();
        } catch {
          // The byte limit has already been established; cancellation failure
          // must not change the externally visible classification.
        }
        return { status: "too-large" };
      }

      chunks.push(result.value);
    }
  } catch {
    return { status: "invalid" };
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return {
      status: "ok",
      body: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  } catch {
    return { status: "invalid" };
  }
}

export async function readAndValidatePaidTriageInput(
  request: Request,
): Promise<PaidTriageInputResult> {
  const bodyResult = await readBoundedRequestBody(request);

  if (bodyResult.status !== "ok") return bodyResult;

  try {
    return {
      status: "ok",
      input: validateTriageInput(JSON.parse(bodyResult.body) as unknown),
    };
  } catch {
    return { status: "invalid" };
  }
}
