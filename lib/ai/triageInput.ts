import "server-only";

export const MAX_BODY_BYTES = 32 * 1024;
export const MAX_QUESTION_CODE_POINTS = 1_000;
export const MAX_WORD_ID_CODE_POINTS = 128;
export const MAX_WORD_TEXT_CODE_POINTS = 256;
export const MAX_ACCEPTED_WORDS = 100;
export const MAX_PENDING_WORDS = 40;
export const MAX_COMBINED_WORDS = 120;

export type TriageInputWord = Readonly<{
  id: string;
  text: string;
}>;

export type PaidTriageInput = Readonly<{
  question: string;
  acceptedWords: readonly TriageInputWord[];
  pendingWords: readonly TriageInputWord[];
}>;

export type BoundedBodyResult =
  | Readonly<{ status: "ok"; body: string }>
  | Readonly<{ status: "too-large" }>
  | Readonly<{ status: "invalid" }>;

export type PaidTriageInputResult =
  | Readonly<{ status: "ok"; input: PaidTriageInput }>
  | Readonly<{ status: "too-large" }>
  | Readonly<{ status: "invalid" }>;

export class TriageInputValidationError extends Error {
  constructor(message = "Invalid triage input.") {
    super(message);
    this.name = "TriageInputValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();

  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  );
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function validateWordList(
  value: unknown,
  fieldName: "acceptedWords" | "pendingWords",
  maximum: number,
): TriageInputWord[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new TriageInputValidationError(
      `${fieldName} exceeds its item limit.`,
    );
  }

  return value.map((candidate, index) => {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, ["id", "text"]) ||
      typeof candidate.id !== "string" ||
      typeof candidate.text !== "string" ||
      candidate.id.length === 0 ||
      codePointLength(candidate.id) > MAX_WORD_ID_CODE_POINTS ||
      codePointLength(candidate.text) > MAX_WORD_TEXT_CODE_POINTS
    ) {
      throw new TriageInputValidationError(
        `Invalid ${fieldName}[${index}].`,
      );
    }

    return { id: candidate.id, text: candidate.text };
  });
}

export function validatePaidTriageInput(value: unknown): PaidTriageInput {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["question", "acceptedWords", "pendingWords"]) ||
    typeof value.question !== "string" ||
    codePointLength(value.question) > MAX_QUESTION_CODE_POINTS
  ) {
    throw new TriageInputValidationError();
  }

  const acceptedWords = validateWordList(
    value.acceptedWords,
    "acceptedWords",
    MAX_ACCEPTED_WORDS,
  );
  const pendingWords = validateWordList(
    value.pendingWords,
    "pendingWords",
    MAX_PENDING_WORDS,
  );

  if (acceptedWords.length + pendingWords.length > MAX_COMBINED_WORDS) {
    throw new TriageInputValidationError(
      "The combined word count exceeds its item limit.",
    );
  }

  const ids = new Set<string>();

  for (const word of [...acceptedWords, ...pendingWords]) {
    if (ids.has(word.id)) {
      throw new TriageInputValidationError("Triage word ids must be unique.");
    }

    ids.add(word.id);
  }

  return { question: value.question, acceptedWords, pendingWords };
}

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

      if (result.done) {
        break;
      }

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

  if (bodyResult.status !== "ok") {
    return bodyResult;
  }

  try {
    return {
      status: "ok",
      input: validatePaidTriageInput(JSON.parse(bodyResult.body) as unknown),
    };
  } catch {
    return { status: "invalid" };
  }
}
