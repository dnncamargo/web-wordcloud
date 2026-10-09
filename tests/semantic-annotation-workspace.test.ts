import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmptyAnnotationStore,
  filterAnnotationQueue,
  moveAnnotationIndex,
  parseAnnotationStore,
  renderAnnotationWorkspaceHtml,
  saltFingerprint,
  serializeAnnotationStore,
} from "../scripts/semantic-annotation-workspace";
import type { SemanticMergeAnnotationQueue, SemanticAnnotationRecord } from "../scripts/semantic-merge-benchmark";

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

function record(caseId: string, status: SemanticAnnotationRecord["adjudicationStatus"]): SemanticAnnotationRecord {
  return {
    benchmarkVersion: "semantic-merge-v1",
    caseId,
    pairIdentity: `pair-${caseId}`,
    humanLabel: "equivalent",
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
});

test("filters pending and reviewed cases and clamps navigation", () => {
  const annotations = [record("case-a", "adjudicated")];
  assert.deepEqual(filterAnnotationQueue(queue, "all", "reviewed", annotations).map((item) => item.caseId), ["case-a"]);
  assert.deepEqual(filterAnnotationQueue(queue, "all", "pending", annotations).map((item) => item.caseId), ["case-b"]);
  assert.deepEqual(filterAnnotationQueue(queue, "cloud-b", "all", annotations).map((item) => item.caseId), ["case-b"]);
  assert.equal(moveAnnotationIndex(0, -1, 2), 0);
  assert.equal(moveAnnotationIndex(1, 1, 2), 1);
  assert.equal(moveAnnotationIndex(0, 1, 0), 0);
});

test("workspace renders data-safe DOM assignment code without interpolated case content", () => {
  const html = renderAnnotationWorkspaceHtml();
  assert.equal(html.includes("textContent = value"), true);
  assert.equal(html.includes("innerHTML"), false);
  assert.equal(html.includes("<script>alert"), false);
});
