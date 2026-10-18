import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSyntheticSmokeOptions,
  renderSyntheticSmokePlan,
  renderSyntheticSmokeResult,
  runSyntheticSmoke,
  SYNTHETIC_SMOKE_INPUT,
} from "../scripts/smoke-semantic-merge";

test("synthetic smoke is offline by default and never calls its executor", async () => {
  let calls = 0;
  assert.deepEqual(parseSyntheticSmokeOptions([]), { allowNetwork: false });
  assert.deepEqual(await runSyntheticSmoke({ allowNetwork: false }, async () => {
    calls += 1;
    throw new Error("must not execute");
  }), []);
  assert.equal(calls, 0);
  assert.match(renderSyntheticSmokePlan(), /network_enabled=false/);
  assert.match(renderSyntheticSmokePlan(), /planned_calls=2/);
});

test("synthetic smoke formats only safe metadata and tests both strategies independently", async () => {
  assert.deepEqual(parseSyntheticSmokeOptions(["--allow-network"]), { allowNetwork: true });
  assert.throws(() => parseSyntheticSmokeOptions(["--unexpected"]), /Usage/);
  const results = await runSyntheticSmoke({ allowNetwork: true }, async (strategy) => ({
    results: [],
    acceptedMergeSuggestions: strategy === "unified"
      ? [{ firstId: "idea-b", secondId: "idea-a" }]
      : [],
  }));
  assert.equal(results.length, 2);
  assert.equal(results[0]?.expectedPairPresent, true);
  assert.equal(results[1]?.expectedPairPresent, false);
  const output = renderSyntheticSmokeResult(results[0]!);
  assert.match(output, /strategy=unified/);
  assert.match(output, /suggestions=1/);
  assert.match(output, /pairs=idea-b\/idea-a/);
  assert.match(output, /expected_pair_present=true/);
  assert.doesNotMatch(output, new RegExp(SYNTHETIC_SMOKE_INPUT.question));
  assert.doesNotMatch(output, /Bearer|OPENROUTER_API_KEY|acceptedWords/);
});

test("synthetic smoke sanitizes provider failures", async () => {
  const results = await runSyntheticSmoke({ allowNetwork: true }, async () => {
    throw new Error("secret payload and student text");
  });
  assert.deepEqual(results.map((result) => result.error), ["provider_unknown_failure", "provider_unknown_failure"]);
  assert.equal(JSON.stringify(results).includes("secret payload"), false);
});
