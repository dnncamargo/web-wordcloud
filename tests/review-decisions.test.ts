import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clearPendingSpelling,
  getPendingApprovalPlan,
  getPendingMergePlan,
  selectPendingSpelling,
} from "../lib/reviewDecisions";
import {
  getCanonicalWordCandidates,
  prepareCanonicalWordChange,
} from "../lib/firebase/canonicalWord";

test("choosing a spelling suggestion only changes ephemeral selection state", () => {
  assert.deepEqual(
    selectPendingSpelling({}, "pending-1", "Escultar", "Escutar"),
    { "pending-1": "Escutar" },
  );
});

test("selected spelling changes the eventual acceptance operation", () => {
  assert.deepEqual(getPendingApprovalPlan("Escultar", "Escutar"), {
    operation: "approveNewWordAs",
    text: "Escutar",
  });
});

test("canceling spelling selection restores original-text acceptance", () => {
  const selected = selectPendingSpelling({}, "pending-1", "Escultar", "Escutar");

  assert.deepEqual(clearPendingSpelling(selected, "pending-1"), {});
  assert.deepEqual(getPendingApprovalPlan("Escultar", undefined), {
    operation: "approveNewWord",
    text: "Escultar",
  });
});

test("ordinary acceptance remains the original operation without a spelling choice", () => {
  assert.deepEqual(getPendingApprovalPlan("Escultar", undefined), {
    operation: "approveNewWord",
    text: "Escultar",
  });
});

test("a merge suggestion produces only an explicit merge action plan", () => {
  assert.deepEqual(getPendingMergePlan("accepted-1"), {
    operation: "mergeNewWordIntoWord",
    targetWordId: "accepted-1",
  });
  assert.equal(getPendingMergePlan(null), null);
});

test("ordinary acceptance remains available instead of forcing a merge", () => {
  assert.deepEqual(getPendingApprovalPlan("Respeito sempre", undefined), {
    operation: "approveNewWord",
    text: "Respeito sempre",
  });
});

test("canonical candidates are current text followed by aliases", () => {
  assert.deepEqual(
    getCanonicalWordCandidates("Respeito", ["Respeito sempre", "Respeito"]),
    ["Respeito", "Respeito sempre"],
  );
});

test("choosing an alias swaps canonical and alias forms", () => {
  assert.deepEqual(
    prepareCanonicalWordChange("Respeito", ["Respeito sempre", "Respeito sempre"], "Respeito sempre"),
    {
      kind: "update",
      change: {
        text: "Respeito sempre",
        aliases: ["Respeito"],
      },
    },
  );
});

test("canonical swap preserves count because the change only prepares text and aliases", () => {
  const word = { text: "Respeito", aliases: ["Respeito sempre"], count: 4 };
  const decision = prepareCanonicalWordChange(word.text, word.aliases, "Respeito sempre");

  assert.equal(decision.kind, "update");
  assert.equal(word.count, 4);
});

test("canonical swap deduplicates aliases and excludes the current canonical form", () => {
  const decision = prepareCanonicalWordChange(
    "Respeito",
    ["Respeito", "Respeito sempre", "Respeito sempre", "Outra forma"],
    "Respeito sempre",
  );

  assert.deepEqual(decision, {
    kind: "update",
    change: {
      text: "Respeito sempre",
      aliases: ["Respeito", "Outra forma"],
    },
  });
});

test("invalid or stale canonical candidates are rejected", () => {
  assert.deepEqual(
    prepareCanonicalWordChange("Respeito", ["Respeito sempre"], "Respeito novo"),
    { kind: "invalid" },
  );
});

test("selecting the current canonical form performs no change", () => {
  assert.deepEqual(
    prepareCanonicalWordChange("Respeito", ["Respeito sempre"], "Respeito"),
    { kind: "noop" },
  );
});
