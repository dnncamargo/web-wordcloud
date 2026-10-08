import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FIRESTORE_BASE_URL = "https://firestore.googleapis.com/v1";
const PAGE_SIZE = 1_000;
const REVIEW_STATUSES = ["pending", "approved", "rejected", "merged"] as const;
const CLOUD_STATUSES = ["draft", "open", "closed", "archived"] as const;

type ReviewStatus = (typeof REVIEW_STATUSES)[number];
type CloudStatus = (typeof CLOUD_STATUSES)[number];

export type CalibrationAcceptedWord = Readonly<{
  id: string;
  text: string;
  normalized: string;
  count: number;
  aliases: readonly string[];
}>;

export type CalibrationSubmission = Readonly<{
  id: string;
  text: string;
  normalized: string;
  status: ReviewStatus;
  mergedIntoWordId: string | null;
}>;

export type CalibrationCloud = Readonly<{
  id: string;
  title: string;
  publicTitle: string;
  status: CloudStatus;
  acceptedWords: readonly CalibrationAcceptedWord[];
  submissions: readonly CalibrationSubmission[];
}>;

export type CalibrationExport = Readonly<{
  schemaVersion: 1;
  clouds: readonly CalibrationCloud[];
}>;

export type CliOptions = Readonly<{
  mode: "cloud" | "all";
  cloudId?: string;
  outPath?: string;
}>;

type FirestoreValue = Readonly<Record<string, unknown>>;
type FirestoreFields = Readonly<Record<string, FirestoreValue>>;
type FirestoreDocument = Readonly<{
  name?: unknown;
  fields?: unknown;
}>;
type FirestoreListResponse = Readonly<{
  documents?: unknown;
  nextPageToken?: unknown;
}>;

export type FetchImplementation = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

export class CalibrationExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalibrationExportError";
  }
}

class FirestoreHttpError extends CalibrationExportError {
  readonly status: number;

  constructor(status: number) {
    super(`Firestore read failed with HTTP status ${status}.`);
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function malformed(message: string): never {
  throw new CalibrationExportError(`Malformed Firestore response: ${message}`);
}

function compareStrings(first: string, second: string): number {
  if (first < second) return -1;
  if (first > second) return 1;
  return 0;
}

function requireString(value: unknown, description: string): string {
  if (typeof value !== "string") malformed(`${description} must be a string.`);
  return value;
}

function getField(fields: FirestoreFields, key: string): FirestoreValue | undefined {
  const field = fields[key];
  if (field === undefined) return undefined;
  if (!isRecord(field)) malformed(`field ${key} must be a Firestore value.`);
  return field;
}

function decodeStringField(
  fields: FirestoreFields,
  key: string,
  fallback = "",
): string {
  const field = getField(fields, key);
  if (field === undefined) return fallback;

  if (typeof field.stringValue !== "string") {
    malformed(`field ${key} must use stringValue.`);
  }

  return field.stringValue;
}

function decodeNullableStringField(
  fields: FirestoreFields,
  key: string,
): string | null {
  const field = getField(fields, key);
  if (field === undefined || field.nullValue === null) return null;

  if (typeof field.stringValue !== "string") {
    malformed(`field ${key} must use stringValue or nullValue.`);
  }

  return field.stringValue;
}

function decodeNumberField(fields: FirestoreFields, key: string, fallback = 0): number {
  const field = getField(fields, key);
  if (field === undefined) return fallback;

  let value: number;
  if (typeof field.integerValue === "string") {
    value = Number(field.integerValue);
  } else if (typeof field.doubleValue === "number") {
    value = field.doubleValue;
  } else {
    malformed(`field ${key} must use integerValue or doubleValue.`);
  }

  if (!Number.isFinite(value)) malformed(`field ${key} must contain a finite number.`);
  return value;
}

function decodeStringArrayField(fields: FirestoreFields, key: string): string[] {
  const field = getField(fields, key);
  if (field === undefined) return [];
  if (!isRecord(field.arrayValue)) malformed(`field ${key} must use arrayValue.`);

  const values = field.arrayValue.values;
  if (values === undefined) return [];
  if (!Array.isArray(values)) malformed(`field ${key}.arrayValue.values must be an array.`);

  return values.map((value, index) => {
    if (!isRecord(value) || typeof value.stringValue !== "string") {
      malformed(`field ${key} value ${index} must use stringValue.`);
    }
    return value.stringValue;
  });
}

function decodeFields(document: FirestoreDocument): FirestoreFields {
  if (document.fields === undefined) return {};
  if (!isRecord(document.fields)) malformed("document fields must be an object.");

  for (const [key, value] of Object.entries(document.fields)) {
    if (!isRecord(value)) malformed(`field ${key} must be an object.`);
  }

  return document.fields as FirestoreFields;
}

function decodeDocument(value: unknown): FirestoreDocument {
  if (!isRecord(value)) malformed("document must be an object.");
  if (value.name !== undefined && typeof value.name !== "string") {
    malformed("document name must be a string.");
  }

  return value as FirestoreDocument;
}

function decodeCloudStatus(value: string): CloudStatus {
  if (!(CLOUD_STATUSES as readonly string[]).includes(value)) {
    malformed(`cloud status ${value || "<empty>"} is unknown.`);
  }
  return value as CloudStatus;
}

function decodeReviewStatus(value: string): ReviewStatus {
  if (!(REVIEW_STATUSES as readonly string[]).includes(value)) {
    malformed(`submission status ${value || "<empty>"} is unknown.`);
  }
  return value as ReviewStatus;
}

function documentIdFromName(name: unknown): string {
  const documentName = requireString(name, "document name");
  const segments = documentName.split("/");
  const id = segments.at(-1);
  if (!id || segments.length < 2) malformed("document name has no document id.");
  return id;
}

export function parseAcceptedWordDocument(documentValue: unknown): CalibrationAcceptedWord {
  const document = decodeDocument(documentValue);
  const id = documentIdFromName(document.name);
  const fields = decodeFields(document);
  const aliases = [...new Set(decodeStringArrayField(fields, "aliases"))].sort(compareStrings);

  return {
    id,
    text: decodeStringField(fields, "text"),
    normalized: decodeStringField(fields, "normalized", id),
    count: decodeNumberField(fields, "count", 1),
    aliases,
  };
}

export function parseSubmissionDocument(documentValue: unknown): CalibrationSubmission {
  const document = decodeDocument(documentValue);
  const fields = decodeFields(document);

  return {
    id: documentIdFromName(document.name),
    text: decodeStringField(fields, "text"),
    normalized: decodeStringField(fields, "normalized"),
    status: decodeReviewStatus(decodeStringField(fields, "status", "pending")),
    mergedIntoWordId: decodeNullableStringField(fields, "mergedIntoWordId"),
  };
}

function parseCloudDocument(documentValue: unknown, expectedId?: string): CalibrationCloud {
  const document = decodeDocument(documentValue);
  const documentId = documentIdFromName(document.name);
  if (expectedId !== undefined && documentId !== expectedId) {
    malformed(`cloud document id does not match ${expectedId}.`);
  }

  const fields = decodeFields(document);
  return {
    id: expectedId ?? documentId,
    title: decodeStringField(fields, "title"),
    publicTitle: decodeStringField(fields, "publicTitle"),
    status: decodeCloudStatus(decodeStringField(fields, "status", "draft")),
    acceptedWords: [],
    submissions: [],
  };
}

function decodeListResponse(value: unknown): FirestoreListResponse {
  if (!isRecord(value)) malformed("list response must be an object.");
  if (value.documents !== undefined && !Array.isArray(value.documents)) {
    malformed("list response documents must be an array.");
  }
  if (value.nextPageToken !== undefined && typeof value.nextPageToken !== "string") {
    malformed("list response nextPageToken must be a string.");
  }

  return value as FirestoreListResponse;
}

type FirebaseEnvironment = Readonly<Record<string, string | undefined>>;

function getRequiredEnvironment(environment: FirebaseEnvironment): Readonly<{
  projectId: string;
  apiKey: string;
}> {
  const projectId = environment.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  const apiKey = environment.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();

  if (!projectId) throw new CalibrationExportError("Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID.");
  if (!apiKey) throw new CalibrationExportError("Missing NEXT_PUBLIC_FIREBASE_API_KEY.");

  return { projectId, apiKey };
}

function assertCloudId(cloudId: string): string {
  if (!cloudId || cloudId.includes("/") || /[\u0000-\u001f]/u.test(cloudId)) {
    throw new CalibrationExportError("--cloud requires a valid Firestore cloud id.");
  }
  return cloudId;
}

export function parseCliArgs(args: readonly string[]): CliOptions {
  let mode: CliOptions["mode"] | undefined;
  let cloudId: string | undefined;
  let outPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--all") {
      if (mode !== undefined) throw new CalibrationExportError("Use exactly one of --cloud or --all.");
      mode = "all";
      continue;
    }

    if (argument === "--cloud") {
      if (mode !== undefined) throw new CalibrationExportError("Use exactly one of --cloud or --all.");
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new CalibrationExportError("--cloud requires a value.");
      }
      cloudId = assertCloudId(value);
      mode = "cloud";
      index += 1;
      continue;
    }

    if (argument === "--out") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new CalibrationExportError("--out requires a file path.");
      }
      if (outPath !== undefined) throw new CalibrationExportError("--out may be used only once.");
      outPath = value;
      index += 1;
      continue;
    }

    throw new CalibrationExportError("Unknown CLI argument.");
  }

  if (mode === undefined) throw new CalibrationExportError("Require exactly one of --cloud or --all.");

  if (mode === "all") {
    return outPath === undefined ? { mode } : { mode, outPath };
  }

  return outPath === undefined ? { mode, cloudId } : { mode, cloudId, outPath };
}

function firestoreUrl(
  projectId: string,
  apiKey: string,
  path: readonly string[],
  pageToken?: string,
): string {
  const url = new URL(
    `${FIRESTORE_BASE_URL}/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${path.map(encodeURIComponent).join("/")}`,
  );
  url.searchParams.set("key", apiKey);
  url.searchParams.set("pageSize", String(PAGE_SIZE));
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  return url.toString();
}

export function createFirestoreRestClient(
  projectId: string,
  apiKey: string,
  fetchImplementation: FetchImplementation = fetch as unknown as FetchImplementation,
) {
  async function getJson(
    path: readonly string[],
    pageToken?: string,
  ): Promise<unknown> {
    let response: Pick<Response, "ok" | "status" | "json">;
    try {
      response = await fetchImplementation(
        firestoreUrl(projectId, apiKey, path, pageToken),
        { method: "GET", cache: "no-store" },
      );
    } catch {
      throw new CalibrationExportError("Firestore GET request failed.");
    }

    if (!response.ok) throw new FirestoreHttpError(response.status);

    try {
      return await response.json();
    } catch {
      throw new CalibrationExportError("Malformed Firestore response: JSON could not be decoded.");
    }
  }

  return {
    async getCloud(cloudId: string): Promise<CalibrationCloud> {
      const value = await getJson(["clouds", cloudId]);
      return parseCloudDocument(value, cloudId);
    },

    async listDocuments(
      path: readonly string[],
      options: Readonly<{ missingIsEmpty?: boolean }> = {},
    ): Promise<readonly unknown[]> {
      const documents: unknown[] = [];
      let pageToken: string | undefined;

      do {
        let value: unknown;
        try {
          value = await getJson(path, pageToken);
        } catch (error) {
          if (options.missingIsEmpty && error instanceof FirestoreHttpError && error.status === 404) {
            return [];
          }
          throw error;
        }

        const page = decodeListResponse(value);
        documents.push(...(page.documents as unknown[] | undefined ?? []));
        pageToken = page.nextPageToken as string | undefined;
      } while (pageToken !== undefined && pageToken !== "");

      return documents;
    },
  };
}

function withSubcollections(
  cloud: CalibrationCloud,
  acceptedWords: readonly CalibrationAcceptedWord[],
  submissions: readonly CalibrationSubmission[],
): CalibrationCloud {
  return {
    ...cloud,
    acceptedWords: [...acceptedWords].sort((first, second) => compareStrings(first.id, second.id)),
    submissions: [...submissions].sort((first, second) => compareStrings(first.id, second.id)),
  };
}

export function buildCalibrationExport(clouds: readonly CalibrationCloud[]): CalibrationExport {
  return {
    schemaVersion: 1,
    clouds: [...clouds]
      .map((cloud) => withSubcollections(cloud, cloud.acceptedWords, cloud.submissions))
      .sort((first, second) => compareStrings(first.id, second.id)),
  };
}

export function serializeCalibrationExport(
  exportData: CalibrationExport,
  credentials: Readonly<{ projectId: string; apiKey: string }>,
): string {
  const serialized = `${JSON.stringify(exportData, null, 2)}\n`;

  if (
    (credentials.projectId && serialized.includes(credentials.projectId)) ||
    (credentials.apiKey && serialized.includes(credentials.apiKey))
  ) {
    throw new CalibrationExportError("Refusing to emit credentials in calibration output.");
  }

  return serialized;
}

async function exportCloud(
  client: ReturnType<typeof createFirestoreRestClient>,
  cloudId: string,
): Promise<CalibrationCloud> {
  const cloud = await client.getCloud(cloudId);
  const [wordDocuments, submissionDocuments] = await Promise.all([
    client.listDocuments(["clouds", cloudId, "words"], { missingIsEmpty: true }),
    client.listDocuments(["clouds", cloudId, "newWords"], { missingIsEmpty: true }),
  ]);

  return withSubcollections(
    cloud,
    wordDocuments.map(parseAcceptedWordDocument),
    submissionDocuments.map(parseSubmissionDocument),
  );
}

export async function collectCalibrationExport(
  options: CliOptions,
  environment: FirebaseEnvironment,
  fetchImplementation?: FetchImplementation,
): Promise<Readonly<{ data: CalibrationExport; credentials: Readonly<{ projectId: string; apiKey: string }> }>> {
  const credentials = getRequiredEnvironment(environment);
  const client = createFirestoreRestClient(
    credentials.projectId,
    credentials.apiKey,
    fetchImplementation,
  );

  if (options.mode === "cloud") {
    if (!options.cloudId) throw new CalibrationExportError("--cloud requires a value.");
    return { data: buildCalibrationExport([await exportCloud(client, options.cloudId)]), credentials };
  }

  const cloudDocuments = await client.listDocuments(["clouds"]);
  const cloudIds = cloudDocuments.map((document) => documentIdFromName(decodeDocument(document).name));
  const clouds = await Promise.all(cloudIds.map((cloudId) => exportCloud(client, cloudId)));
  return { data: buildCalibrationExport(clouds), credentials };
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const result = await collectCalibrationExport(options, process.env);
  const serialized = serializeCalibrationExport(result.data, result.credentials);

  if (options.outPath) {
    try {
      await writeFile(options.outPath, serialized, "utf8");
    } catch {
      throw new CalibrationExportError("Unable to write the requested output file.");
    }
    console.log(`Exported ${result.data.clouds.length} cloud(s).`);
    return;
  }

  process.stdout.write(serialized);
}

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";

if (import.meta.url === entrypoint) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown export failure.";
    console.error(`EXPORT FAILED: ${message}`);
    process.exitCode = 1;
  });
}
