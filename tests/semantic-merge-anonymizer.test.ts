import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { anonymizeEvaluationPlan } from "../scripts/evaluate-semantic-merges";
import { startAnonymizationReviewServer } from "../scripts/review-semantic-anonymization";
import {
  anonymizationRulesFingerprint,
  applyAnonymizationApprovals,
  buildAnonymizationReview,
  corpusVersionForInputs,
  parseAnonymizationDictionary,
  validateApprovedAnonymizedText,
} from "../scripts/semantic-merge-anonymizer";

function syntheticEntries() {
  return [{
    cloudPseudonym: "cloud-pseudonym",
    input: {
      question: "Como ajudar Alice Silva na Escola Aurora?",
      acceptedWords: [{ id: "word-pseudonym", text: "Rua das Flores" }],
      pendingWords: [],
    },
  }];
}

test("local review deduplicates by pseudonymous context and preserves required fields", () => {
  const entries = [...syntheticEntries(), ...syntheticEntries()];
  const dictionary = parseAnonymizationDictionary({ "Alice Silva": "[PERSON]", "Escola Aurora": "[SCHOOL]", "Rua das Flores": "[PLACE]" });
  const review = buildAnonymizationReview(entries, dictionary);
  assert.equal(review.items.length, 2);
  assert.equal(review.items.every((item) => item.cloudPseudonym === "cloud-pseudonym"), true);
  assert.equal(review.items.every((item) => item.originalText.length > 0 && item.anonymizedText !== item.originalText), true);
});

test("unsafe dictionary replacements are rejected", () => {
  assert.throws(() => parseAnonymizationDictionary({ "Alice Silva": "Alice Silva" }), /unsafe replacement/);
  assert.throws(() => parseAnonymizationDictionary({ "Alice Silva": "https://example.test" }), /unsafe replacement/);
  assert.equal(validateApprovedAnonymizedText("[PERSON]", new Map([["Alice Silva", "[PERSON]"]])), true);
});

test("all items require current explicit approvals and stale approvals remain pending", () => {
  const entries = syntheticEntries();
  const dictionary = parseAnonymizationDictionary({ "Alice Silva": "[PERSON]", "Escola Aurora": "[SCHOOL]", "Rua das Flores": "[PLACE]" });
  const prepared = buildAnonymizationReview(entries, dictionary);
  const review = { ...prepared.review, corpusVersion: corpusVersionForInputs(entries), rulesFingerprint: anonymizationRulesFingerprint(dictionary) };
  const approvals = prepared.items.map((item) => ({ reviewId: item.reviewId, sourceTextFingerprint: item.sourceTextFingerprint, baseAnonymizedTextFingerprint: item.anonymizedTextFingerprint, approvedText: item.anonymizedText, approvedTextFingerprint: "wrong", status: "approved" as const }));
  const incomplete = applyAnonymizationApprovals(entries, prepared.items, review, { version: "semantic-merge-anonymization-approval-v1", corpusVersion: review.corpusVersion!, rulesFingerprint: review.rulesFingerprint!, approvals }, dictionary);
  assert.equal(incomplete.review.approvalComplete, false);
  assert.equal(incomplete.review.pendingApprovalCount, prepared.items.length);
  const valid = applyAnonymizationApprovals(entries, prepared.items, review, {
    version: "semantic-merge-anonymization-approval-v1",
    corpusVersion: review.corpusVersion!,
    rulesFingerprint: review.rulesFingerprint!,
    approvals: prepared.items.map((item) => ({ reviewId: item.reviewId, sourceTextFingerprint: item.sourceTextFingerprint, baseAnonymizedTextFingerprint: item.anonymizedTextFingerprint, approvedText: item.anonymizedText, approvedTextFingerprint: createHash("sha256").update(item.anonymizedText).digest("hex"), status: "approved" as const })),
  }, dictionary);
  assert.equal(valid.review.approvalComplete, true);
  assert.equal(valid.review.pendingApprovalCount, 0);
  const stale = applyAnonymizationApprovals(entries, prepared.items, { ...review, corpusVersion: "stale" }, undefined, dictionary);
  assert.equal(stale.review.approvalComplete, false);
});

test("rules version changes invalidate prior approvals without reusing them", () => {
  const entries = syntheticEntries();
  const dictionary = parseAnonymizationDictionary({ "Alice Silva": "[PERSON]", "Escola Aurora": "[SCHOOL]", "Rua das Flores": "[PLACE]" });
  const prepared = buildAnonymizationReview(entries, dictionary);
  const review = { ...prepared.review, corpusVersion: corpusVersionForInputs(entries), rulesFingerprint: anonymizationRulesFingerprint(dictionary) };
  const legacy = applyAnonymizationApprovals(entries, prepared.items, review, {
    version: "semantic-merge-anonymization-approval-v1",
    corpusVersion: review.corpusVersion!,
    rulesFingerprint: "semantic-merge-anonymizer-v2-legacy",
    approvals: prepared.items.map((item) => ({ reviewId: item.reviewId, sourceTextFingerprint: item.sourceTextFingerprint, baseAnonymizedTextFingerprint: item.anonymizedTextFingerprint, approvedText: item.anonymizedText, approvedTextFingerprint: createHash("sha256").update(item.anonymizedText).digest("hex"), status: "approved" as const })),
  }, dictionary);
  assert.equal(legacy.review.approvalComplete, false);
  assert.equal(legacy.review.approvedItemCount, 0);
  assert.equal(legacy.review.pendingApprovalCount, prepared.items.length);
  assert.notEqual(review.rulesFingerprint, "semantic-merge-anonymizer-v2-legacy");
});

test("local review server persists only sanitized approval text", async () => {
  const root = await mkdtemp(join(tmpdir(), "semantic-anonymization-review-"));
  let server: Awaited<ReturnType<typeof startAnonymizationReviewServer>> | undefined;
  try {
    const dictionary = new Map<string, string>();
    const plan = anonymizeEvaluationPlan({
      queue: { benchmarkVersion: "semantic-merge-v1", selectionVersion: "lexical-stratified-v1", targetCount: 0, candidateCount: 0, selectedCount: 0, selectionCriteria: [], tierCounts: { high: 0, medium: 0, low: 0 }, cloudCounts: {}, items: [] },
      entries: [{ strategy: "unified", cloudPseudonym: "cloud", input: { question: "Nome: joao", acceptedWords: [], pendingWords: [] }, queueCaseCount: 0, inputCharacterCount: 0 }],
      clouds: 1, callsPerStrategy: 1, totalCalls: 1, acceptedWordCount: 0, inputCharacterCount: 0, scorableCases: 0, positiveAnnotationCount: 0,
    }, dictionary);
    const approvalPath = join(root, "approvals.json");
    await writeFile(approvalPath, JSON.stringify({ version: "semantic-merge-anonymization-approval-v1", corpusVersion: "old-corpus", rulesFingerprint: "old-rules", approvals: [{ reviewId: "old", status: "approved" }] }), { flag: "wx" });
    server = await startAnonymizationReviewServer(plan, approvalPath, dictionary, 0);
    const address = server.address();
    assert.equal(typeof address, "object");
    const base = `http://127.0.0.1:${(address as { port: number }).port}`;
    const state = await (await fetch(`${base}/state`)).json() as { items: Array<{ reviewId: string; anonymizedText: string }>; approvals: unknown[]; storeCompatible: boolean };
    assert.equal(state.items.length, 1);
    assert.equal(state.approvals.length, 0);
    assert.equal(state.storeCompatible, true);
    const response = await fetch(`${base}/approval`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reviewId: state.items[0]!.reviewId, status: "approved", approvedText: "[PERSON]" }) });
    assert.equal(response.status, 200);
    const stored = await readFile(approvalPath, "utf8");
    assert.equal(stored.includes("Nome: joao"), false);
    const approvedStore = JSON.parse(stored);
    const approvedPlan = applyAnonymizationApprovals(plan.entries, plan.anonymizationItems!, plan.anonymization!, approvedStore, dictionary);
    assert.equal(approvedPlan.review.approvalComplete, true);
    const rejected = await fetch(`${base}/approval`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reviewId: state.items[0]!.reviewId, status: "rejected", approvedText: "edited but rejected" }) });
    assert.equal(rejected.status, 200);
    const rejectedStore = await readFile(approvalPath, "utf8");
    assert.equal(rejectedStore.includes("edited but rejected"), false);
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
