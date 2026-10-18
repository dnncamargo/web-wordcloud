import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSyntheticSmokeOptions,
  renderSyntheticSmokePlan,
  renderSyntheticSmokeResult,
  runSyntheticSmoke,
  SYNTHETIC_SMOKE_CASES,
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
  assert.match(renderSyntheticSmokePlan(), /planned_calls=6/);
  assert.match(renderSyntheticSmokePlan(), /cases=A,B,C/);
});

test("synthetic smoke executes each case and strategy exactly once in injected offline tests", async () => {
  assert.deepEqual(parseSyntheticSmokeOptions(["--allow-network"]), { allowNetwork: true });
  assert.throws(() => parseSyntheticSmokeOptions(["--unexpected"]), /Usage/);
  const calls: string[] = [];
  const results = await runSyntheticSmoke({ allowNetwork: true }, async (smokeCase, strategy) => {
    calls.push(`${smokeCase.caseId}:${strategy}`);
    return {
      results: [],
      acceptedMergeSuggestions: smokeCase.caseId === "A" && strategy === "unified"
        ? [{ firstId: "idea-b", secondId: "idea-a" }]
        : [],
    };
  }, () => true);
  assert.deepEqual(calls, ["A:unified", "A:dedicated", "B:unified", "B:dedicated", "C:unified", "C:dedicated"]);
  assert.equal(results.length, SYNTHETIC_SMOKE_CASES.length * 2);
  assert.equal(results[0]?.expectedPairPresent, true);
  assert.equal(results[1]?.expectedPairPresent, false);
  assert.equal(results[2]?.expectedPairPresent, "not_applicable");
  assert.equal(results[4]?.expectedPairPresent, "not_applicable");
  const output = renderSyntheticSmokeResult(results[0]!);
  assert.match(output, /case=A/);
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
  }, () => true);
  assert.deepEqual(results.map((result) => result.error), Array.from({ length: 6 }, () => "provider_unknown_failure"));
  assert.equal(JSON.stringify(results).includes("secret payload"), false);
});

test("synthetic smoke rejects authorized execution when the API key is absent", async () => {
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  let calls = 0;
  try {
    await assert.rejects(runSyntheticSmoke({ allowNetwork: true }, async () => {
      calls += 1;
      throw new Error("must not execute");
    }), /OPENROUTER_API_KEY is required/);
    assert.equal(calls, 0);
  } finally {
    if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalApiKey;
  }
});
