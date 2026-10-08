import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildCalibrationExport,
  collectCalibrationExport,
  createFirestoreRestClient,
  parseAcceptedWordDocument,
  parseCliArgs,
  parseSubmissionDocument,
  serializeCalibrationExport,
  type FetchImplementation,
} from "../scripts/export-firestore-calibration";

const credentials = {
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "project-secret-example",
  NEXT_PUBLIC_FIREBASE_API_KEY: "api-key-secret-example",
};
const credentialValues = {
  projectId: credentials.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  apiKey: credentials.NEXT_PUBLIC_FIREBASE_API_KEY,
};

function stringValue(value: string) {
  return { stringValue: value };
}

function integerValue(value: number) {
  return { integerValue: String(value) };
}

function document(name: string, fields: Record<string, unknown>) {
  return { name, fields };
}

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as const;
}

function queuedFetch(responses: readonly ReturnType<typeof response>[]) {
  const calls: Array<{ url: string; method: string | undefined }> = [];
  let index = 0;
  const fetchImplementation: FetchImplementation = async (url, init) => {
    calls.push({ url, method: init.method });
    const next = responses[index];
    index += 1;
    if (!next) throw new Error("Unexpected request");
    return next;
  };
  return { calls, fetchImplementation };
}

test("parses cloud selection, all selection, output, and invalid combinations", () => {
  assert.deepEqual(parseCliArgs(["--cloud", "0I7JYTf4K5AsGx890Ccd", "--out", "export.json"]), {
    mode: "cloud",
    cloudId: "0I7JYTf4K5AsGx890Ccd",
    outPath: "export.json",
  });
  assert.deepEqual(parseCliArgs(["--all"]), { mode: "all" });
  assert.throws(() => parseCliArgs([]), /exactly one/);
  assert.throws(() => parseCliArgs(["--cloud", "one", "--all"]), /exactly one/);
  assert.throws(() => parseCliArgs(["--unknown"]), /Unknown CLI argument/);
});

test("parses accepted words, deduplicates aliases, and excludes timestamps", () => {
  assert.deepEqual(
    parseAcceptedWordDocument(
      document("projects/p/databases/(default)/documents/clouds/c1/words/w2", {
        text: stringValue("Cuidar"),
        normalized: stringValue("cuidar"),
        count: integerValue(4),
        aliases: { arrayValue: { values: [stringValue("Z"), stringValue("A"), stringValue("Z")] } },
        deviceId: stringValue("must-not-export"),
        createdAt: stringValue("must-not-export"),
        updatedAt: stringValue("must-not-export"),
      }),
    ),
    {
      id: "w2",
      text: "Cuidar",
      normalized: "cuidar",
      count: 4,
      aliases: ["A", "Z"],
    },
  );
});

test("parses all review statuses and preserves merged target", () => {
  for (const status of ["pending", "approved", "rejected", "merged"] as const) {
    assert.deepEqual(
      parseSubmissionDocument(
        document(`projects/p/databases/(default)/documents/clouds/c1/newWords/${status}`, {
          text: stringValue(`text-${status}`),
          normalized: stringValue(`normalized-${status}`),
          status: stringValue(status),
          mergedIntoWordId: status === "merged" ? stringValue("w1") : { nullValue: null },
          reviewedAt: stringValue("must-not-export"),
          deviceId: stringValue("must-not-export"),
        }),
      ),
      {
        id: status,
        text: `text-${status}`,
        normalized: `normalized-${status}`,
        status,
        mergedIntoWordId: status === "merged" ? "w1" : null,
      },
    );
  }
});

test("sorts clouds and child collections deterministically", () => {
  const unsorted = buildCalibrationExport([
    {
      id: "cloud-b",
      title: "B",
      publicTitle: "B",
      status: "open",
      acceptedWords: [
        { id: "word-b", text: "B", normalized: "b", count: 1, aliases: [] },
        { id: "word-a", text: "A", normalized: "a", count: 1, aliases: [] },
      ],
      submissions: [
        { id: "submission-b", text: "B", normalized: "b", status: "pending", mergedIntoWordId: null },
        { id: "submission-a", text: "A", normalized: "a", status: "approved", mergedIntoWordId: null },
      ],
    },
    {
      id: "cloud-a",
      title: "A",
      publicTitle: "A",
      status: "draft",
      acceptedWords: [],
      submissions: [],
    },
  ]);

  assert.deepEqual(unsorted.clouds.map((cloud) => cloud.id), ["cloud-a", "cloud-b"]);
  assert.deepEqual(unsorted.clouds[1]?.acceptedWords.map((word) => word.id), ["word-a", "word-b"]);
  assert.deepEqual(unsorted.clouds[1]?.submissions.map((submission) => submission.id), ["submission-a", "submission-b"]);
});

test("handles collection pagination for all clouds and both subcollections", async () => {
  const calls: Array<{ url: string; method: string | undefined }> = [];
  const fetchImplementation: FetchImplementation = async (url, init) => {
    calls.push({ url, method: init.method });
    const requestUrl = new URL(url);
    const path = requestUrl.pathname;
    const token = requestUrl.searchParams.get("pageToken");
    if (path.endsWith("/documents/clouds") && !token) {
      return response({
        documents: [document("projects/p/databases/(default)/documents/clouds/cloud-b", { title: stringValue("B"), publicTitle: stringValue("B"), status: stringValue("open") })],
        nextPageToken: "cloud-page-2",
      });
    }
    if (path.endsWith("/documents/clouds") && token === "cloud-page-2") {
      return response({
        documents: [document("projects/p/databases/(default)/documents/clouds/cloud-a", { title: stringValue("A"), publicTitle: stringValue("A"), status: stringValue("draft") })],
      });
    }
    if (path.endsWith("/documents/clouds/cloud-b")) {
      return response({ name: "projects/p/databases/(default)/documents/clouds/cloud-b", fields: { title: stringValue("B"), publicTitle: stringValue("B"), status: stringValue("open") } });
    }
    if (path.endsWith("/documents/clouds/cloud-a")) {
      return response({ name: "projects/p/databases/(default)/documents/clouds/cloud-a", fields: { title: stringValue("A"), publicTitle: stringValue("A"), status: stringValue("draft") } });
    }
    if (path.endsWith("/cloud-b/words") && !token) {
      return response({ documents: [document("projects/p/databases/(default)/documents/clouds/cloud-b/words/w2", { text: stringValue("B"), normalized: stringValue("b"), count: integerValue(2) })], nextPageToken: "words-page-2" });
    }
    if (path.endsWith("/cloud-b/words") && token === "words-page-2") {
      return response({ documents: [document("projects/p/databases/(default)/documents/clouds/cloud-b/words/w1", { text: stringValue("A"), normalized: stringValue("a"), count: integerValue(1) })] });
    }
    if (path.endsWith("/cloud-b/newWords") && !token) {
      return response({ documents: [document("projects/p/databases/(default)/documents/clouds/cloud-b/newWords/s2", { text: stringValue("S"), normalized: stringValue("s"), status: stringValue("merged"), mergedIntoWordId: stringValue("w2") })], nextPageToken: "new-page-2" });
    }
    if (path.endsWith("/cloud-b/newWords") && token === "new-page-2") {
      return response({ documents: [document("projects/p/databases/(default)/documents/clouds/cloud-b/newWords/s1", { text: stringValue("P"), normalized: stringValue("p"), status: stringValue("pending") })] });
    }
    if (path.includes("/cloud-a/words") || path.includes("/cloud-a/newWords")) return response({ documents: [] });
    throw new Error("Unexpected request");
  };

  const result = await collectCalibrationExport(
    { mode: "all" },
    credentials,
    fetchImplementation,
  );

  assert.deepEqual(result.data.clouds.map((cloud) => cloud.id), ["cloud-a", "cloud-b"]);
  assert.deepEqual(result.data.clouds[1]?.acceptedWords.map((word) => word.id), ["w1", "w2"]);
  assert.deepEqual(result.data.clouds[1]?.submissions.map((submission) => submission.id), ["s1", "s2"]);
  assert.ok(calls.some((call) => call.url.includes("pageToken=cloud-page-2")));
  assert.ok(calls.some((call) => call.url.includes("pageToken=words-page-2")));
  assert.ok(calls.some((call) => call.url.includes("pageToken=new-page-2")));
});

test("missing subcollections become empty arrays, malformed responses fail clearly", async () => {
  const missing = queuedFetch([
    response({ name: "projects/p/databases/(default)/documents/clouds/c1", fields: { title: stringValue("C"), publicTitle: stringValue("P"), status: stringValue("draft") } }),
    response({}, 404),
    response({}, 404),
  ]);
  const result = await collectCalibrationExport({ mode: "cloud", cloudId: "c1" }, credentials, missing.fetchImplementation);
  assert.deepEqual(result.data.clouds[0]?.acceptedWords, []);
  assert.deepEqual(result.data.clouds[0]?.submissions, []);

  const malformedResponse = queuedFetch([response({ documents: "not-an-array" })]);
  await assert.rejects(
    () => collectCalibrationExport({ mode: "all" }, credentials, malformedResponse.fetchImplementation),
    /Malformed Firestore response/,
  );
});

test("transport issues GET requests only and never emits credentials", async () => {
  const queued = queuedFetch([response({ documents: [] })]);
  const client = createFirestoreRestClient("project-secret-example", "api-key-secret-example", queued.fetchImplementation);
  await client.listDocuments(["clouds"]);
  assert.deepEqual(queued.calls.map((call) => call.method), ["GET"]);

  const output = serializeCalibrationExport({ schemaVersion: 1, clouds: [] }, credentialValues);
  assert.doesNotMatch(output, /project-secret-example|api-key-secret-example/);
  assert.throws(
    () => serializeCalibrationExport({ schemaVersion: 1, clouds: [{ id: "project-secret-example", title: "", publicTitle: "", status: "draft", acceptedWords: [], submissions: [] }] }, credentialValues),
    /credentials/,
  );
});
