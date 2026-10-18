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
