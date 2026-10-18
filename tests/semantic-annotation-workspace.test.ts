import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createEmptyAnnotationStore,
  filterAnnotationQueue,
  moveAnnotationIndex,
  parseAnnotationStore,
  replaceAnnotationRecord,
  renderAnnotationWorkspaceHtml,
  saltFingerprint,
  SEMANTIC_LABEL_UI,
  serializeAnnotationStore,
} from "../scripts/semantic-annotation-workspace";
import {
  importCalibrationCorpus,
  loadCalibrationExport,
  selectSemanticMergeAnnotationQueue,
  type SemanticMergeAnnotationQueue,
  type SemanticAnnotationRecord,
} from "../scripts/semantic-merge-benchmark";

const queue: SemanticMergeAnnotationQueue = {
  benchmarkVersion: "semantic-merge-v1",
  selectionVersion: "lexical-stratified-v1",
  targetCount: 2,
  candidateCount: 2,
  selectedCount: 2,
  selectionCriteria: [],
  tierCounts: { high: 1, medium: 1, low: 0 },
  cloudCounts: { "cloud-a": 1, "cloud-b": 1 },
  items: [
    { caseId: "case-a", cloudPseudonym: "cloud-a", lexicalSimilarity: 0.9, lexicalTier: "high" },
    { caseId: "case-b", cloudPseudonym: "cloud-b", lexicalSimilarity: 0.3, lexicalTier: "medium" },
  ],
};

function record(
  caseId: string,
  status: SemanticAnnotationRecord["adjudicationStatus"],
  humanLabel: SemanticAnnotationRecord["humanLabel"] = "equivalent",
): SemanticAnnotationRecord {
  return {
    benchmarkVersion: "semantic-merge-v1",
    caseId,
    pairIdentity: `pair-${caseId}`,
    humanLabel,
    confidence: "high",
    administrativeDecision: "not_recorded",
    adjudicationStatus: status,
  };
}

test("annotation store persists and recovers only pseudonymous decisions", () => {
  const fingerprint = saltFingerprint("synthetic-persisted-salt");
  const store = { ...createEmptyAnnotationStore(fingerprint), annotations: [record("case-a", "adjudicated")] };
  const serialized = serializeAnnotationStore(store);
  assert.equal(serialized.includes("synthetic student text"), false);
  assert.equal(serialized.includes("original-student-id"), false);
  assert.deepEqual(parseAnnotationStore(JSON.parse(serialized), fingerprint), store);
  assert.throws(() => parseAnnotationStore(JSON.parse(serialized), saltFingerprint("another-persisted-salt")), /another salt/);
  assert.throws(() => parseAnnotationStore({ ...JSON.parse(serialized), storageVersion: "old" }, fingerprint), /incompatible/);
  const unrelated = { ...record("case-unrelated", "adjudicated", "unrelated"), confidence: "medium" as const };
  const unrelatedStore = { ...store, annotations: [unrelated] };
  assert.equal(parseAnnotationStore(JSON.parse(serializeAnnotationStore(unrelatedStore)), fingerprint).annotations[0]?.humanLabel, "unrelated");
});

test("filters pending and reviewed cases and clamps navigation", () => {
  const annotations = [record("case-a", "adjudicated")];
  assert.deepEqual(filterAnnotationQueue(queue, "all", "reviewed", annotations).map((item) => item.caseId), ["case-a"]);
  assert.deepEqual(filterAnnotationQueue(queue, "all", "pending", annotations).map((item) => item.caseId), ["case-b"]);
  assert.deepEqual(filterAnnotationQueue(queue, "cloud-b", "all", annotations).map((item) => item.caseId), ["case-b"]);
  assert.deepEqual(
    filterAnnotationQueue(queue, "all", "all", [record("case-a", "adjudicated", "unrelated")], "unrelated").map((item) => item.caseId),
    ["case-a"],
  );
  assert.equal(moveAnnotationIndex(0, -1, 2), 0);
  assert.equal(moveAnnotationIndex(1, 1, 2), 1);
  assert.equal(moveAnnotationIndex(0, 1, 0), 0);
});

test("classification changes preserve confidence, administrative decision, and adjudication", () => {
  const original = {
    ...record("case-a", "adjudicated", "related_but_distinct"),
    confidence: "low" as const,
    administrativeDecision: "keep_separate" as const,
  };
  const updated = replaceAnnotationRecord([original], "case-a", { humanLabel: "unrelated" });
  assert.deepEqual(updated, [{ ...original, humanLabel: "unrelated" }]);
});

test("workspace renders data-safe DOM assignment code without interpolated case content", () => {
  const html = renderAnnotationWorkspaceHtml();
  assert.equal(html.includes("textContent = value"), true);
  assert.equal(html.includes("innerHTML"), false);
  assert.equal(html.includes("<script>alert"), false);
  assert.equal(html.includes("Revisar: Relacionadas, mas distintas"), true);
  assert.equal(html.includes("Não relacionadas"), true);
  assert.equal(html.includes("Mesclagem administrativa: decisão contextual"), true);
  assert.equal(SEMANTIC_LABEL_UI.length, 6);
});

test("loads the existing external annotation file without migration when available", async (context) => {
  const annotationPath = process.env.SEMANTIC_MERGE_ANNOTATIONS_PATH;
  const saltPath = process.env.SEMANTIC_MERGE_SALT_PATH;
  if (!annotationPath || !saltPath) {
    context.skip("External annotation paths are not set.");
    return;
  }
  const raw = await readFile(annotationPath, "utf8");
  const salt = (await readFile(saltPath, "utf8")).trim();
  const store = parseAnnotationStore(JSON.parse(raw), saltFingerprint(salt));
  assert.equal(store.annotations.length, 60);
  assert.equal(store.annotations.filter((item) => item.humanLabel === "related_but_distinct").length, 42);
  assert.equal(store.annotations.filter((item) => item.humanLabel === "unrelated").length, 0);
  assert.equal(store.annotations.every((item) => item.adjudicationStatus === "adjudicated"), true);
});

test("targeted review filter selects the 42 existing related-but-distinct cases", async (context) => {
  const corpusPath = process.env.SEMANTIC_MERGE_CORPUS_PATH;
  const annotationPath = process.env.SEMANTIC_MERGE_ANNOTATIONS_PATH;
  const saltPath = process.env.SEMANTIC_MERGE_SALT_PATH;
  if (!corpusPath || !annotationPath || !saltPath) {
    context.skip("External benchmark paths are not set.");
    return;
  }
  const salt = (await readFile(saltPath, "utf8")).trim();
  const imported = importCalibrationCorpus(await loadCalibrationExport(corpusPath), salt);
  const queue = selectSemanticMergeAnnotationQueue(imported.acceptedMergeBenchmarkCases, 60);
  const store = parseAnnotationStore(
    JSON.parse(await readFile(annotationPath, "utf8")),
    saltFingerprint(salt),
  );
  assert.equal(
    filterAnnotationQueue(queue, "all", "all", store.annotations, "related_but_distinct").length,
    42,
  );
});
