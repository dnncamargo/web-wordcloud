import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  parseBatchApprovalOptions,
  renderBatchApprovalMetadata,
  writeBatchApprovalStore,
} from "../scripts/approve-semantic-anonymization-batch";
import {
  anonymizationRulesFingerprint,
  applyAnonymizationApprovals,
  type AnonymizationApprovalStore,
  buildAnonymizationReview,
  corpusVersionForInputs,
  createBatchApprovalStore,
  parseAnonymizationDictionary,
} from "../scripts/semantic-merge-anonymizer";

function syntheticReview() {
  const entries = [{
    cloudPseudonym: "cloud-pseudonym",
    input: {
      question: "Como ajudar Alice Silva na Escola Aurora?",
      acceptedWords: [{ id: "word-pseudonym", text: "Rua das Flores" }],
      pendingWords: [],
    },
  }];
  const dictionary = parseAnonymizationDictionary({ "Alice Silva": "[PERSON]", "Escola Aurora": "[SCHOOL]", "Rua das Flores": "[PLACE]" });
  const prepared = buildAnonymizationReview(entries, dictionary);
  const review = { ...prepared.review, corpusVersion: corpusVersionForInputs(entries), rulesFingerprint: anonymizationRulesFingerprint(dictionary) };
  return { dictionary, prepared, review };
}

test("batch approval requires explicit confirmation", () => {
  assert.throws(() => parseBatchApprovalOptions(["--output", "D:\\external\\approvals.json"]), /confirmation/);
  assert.throws(() => parseBatchApprovalOptions(["--confirm-reviewed-all"]), /output path/);
});

test("explicit batch approval creates one declaration for every current item", () => {
  const { dictionary, prepared, review } = syntheticReview();
  const store = createBatchApprovalStore(prepared.items, review, true, dictionary);
  assert.equal(store.approvalMode, "operator-batch");
  assert.equal(store.approvals.length, prepared.items.length);
  assert.equal(store.declaredItemCount, prepared.items.length);
  assert.ok(store.declarationFingerprint);
  assert.equal(renderBatchApprovalMetadata(store, review).includes("original_texts_printed=false"), true);
  assert.equal(JSON.stringify(store).includes("Alice Silva"), false);
  assert.equal(JSON.stringify(store).includes("Escola Aurora"), false);
  assert.equal(applyAnonymizationApprovals([], prepared.items, review, store, dictionary).review.approvalComplete, true);
});

test("batch declaration is invalidated by any set, count, identity, or final approval change", () => {
  const { dictionary, prepared, review } = syntheticReview();
  const store = createBatchApprovalStore(prepared.items, review, true, dictionary);
  type MutableBatchStore = {
    declarationFingerprint?: string;
    declaredItemCount?: number;
    dictionaryFingerprint?: string;
    approvalMode?: "individual" | "operator-batch";
    approvals: Array<{ reviewId: string; approvedText?: string; approvedTextFingerprint?: string; [key: string]: unknown }>;
  };
  const apply = (change: (copy: MutableBatchStore) => void) => {
    const copy = JSON.parse(JSON.stringify(store)) as MutableBatchStore;
    change(copy);
    return applyAnonymizationApprovals([], prepared.items, review, copy as unknown as AnonymizationApprovalStore, dictionary).review;
  };
  assert.equal(apply((copy) => { copy.declarationFingerprint = "tampered"; }).approvalComplete, false);
  assert.equal(apply((copy) => { copy.declaredItemCount = (copy.declaredItemCount ?? 0) + 1; }).approvalComplete, false);
  assert.equal(apply((copy) => { copy.approvals[0].reviewId = "unknown"; }).approvalComplete, false);
  assert.equal(apply((copy) => { copy.approvals[0].approvedText = "[EDITED]"; }).approvalComplete, false);
  assert.equal(apply((copy) => { copy.approvals[0].approvedTextFingerprint = "tampered"; }).approvalComplete, false);
  assert.equal(apply((copy) => { copy.approvals.push({ ...copy.approvals[0] }); }).approvalComplete, false);
  assert.equal(apply((copy) => { copy.approvals.pop(); }).approvalComplete, false);
  assert.equal(apply((copy) => { copy.approvalMode = undefined; }).approvalComplete, false);
  assert.equal(apply((copy) => { copy.approvalMode = "individual"; }).approvalComplete, false);
  assert.equal(apply((copy) => { copy.dictionaryFingerprint = "tampered"; }).approvalComplete, false);
  const unknownMode = { ...store, approvalMode: "unknown" } as unknown as AnonymizationApprovalStore;
  assert.equal(applyAnonymizationApprovals([], prepared.items, review, unknownMode, dictionary).review.approvalComplete, false);
});

test("individual approval stores remain compatible without a batch declaration", () => {
  const { dictionary, prepared, review } = syntheticReview();
  const batch = createBatchApprovalStore(prepared.items, review, true, dictionary);
  const individual = {
    version: batch.version,
    corpusVersion: batch.corpusVersion,
    rulesFingerprint: batch.rulesFingerprint,
    approvals: batch.approvals,
  } as const;
  assert.equal(applyAnonymizationApprovals([], prepared.items, review, individual, dictionary).review.approvalComplete, true);
});

test("batch approval publication is external, atomic, and never overwrites", async () => {
  const root = await mkdtemp(join(tmpdir(), "semantic-batch-approval-"));
  try {
    const { dictionary, prepared, review } = syntheticReview();
    const store = createBatchApprovalStore(prepared.items, review, true, dictionary);
    const target = join(root, "approvals.json");
    await writeBatchApprovalStore(target, store);
    assert.equal(JSON.parse(await readFile(target, "utf8")).approvalMode, "operator-batch");
    await assert.rejects(writeBatchApprovalStore(target, store), /already exists/);
    assert.deepEqual((await readdir(root)).sort(), ["approvals.json"]);
    await assert.rejects(writeBatchApprovalStore(resolve("batch-approvals.json"), store), /outside the repository/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("batch approval write failure leaves no temporary file", async () => {
  const root = await mkdtemp(join(tmpdir(), "semantic-batch-approval-"));
  try {
    const { dictionary, prepared, review } = syntheticReview();
    const store = createBatchApprovalStore(prepared.items, review, true, dictionary);
    const target = join(root, "approvals.json");
    await assert.rejects(writeBatchApprovalStore(target, store, { writeFileFn: async () => { throw new Error("simulated write failure"); } }), /simulated write failure/);
    assert.deepEqual((await readdir(root)).sort(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
