/** Expected labels and reviewer rationale, kept separate from execution text. */
export const SEMANTIC_MERGE_HOLDOUT_AUDIT = [
  {
    caseId: "H01",
    category: "positive",
    expectedPairs: [["h01-idea-a", "h01-idea-b"]],
    justification: "Both propose remote online access to digitized historic photographs; mailing printed reproductions is a different service.",
  },
  {
    caseId: "H02",
    category: "positive",
    expectedPairs: [["h02-idea-a", "h02-idea-b"]],
    justification: "Both propose notifying bus passengers about service changes by SMS; printed detour maps are a different channel and deliverable.",
  },
  {
    caseId: "H03",
    category: "positive",
    expectedPairs: [["h03-idea-a", "h03-idea-b"]],
    justification: "Both propose advance online booking of theater seats; a student discount is a separate pricing proposal.",
  },
  {
    caseId: "H04",
    category: "positive",
    expectedPairs: [["h04-idea-a", "h04-idea-b"]],
    justification: "Both propose recurring volunteer-led sessions that repair household appliances; publishing self-service guides is a different activity.",
  },
  {
    caseId: "H05",
    category: "negative",
    expectedPairs: [],
    justification: "Benches, shade trees, and path lighting are three distinct physical improvements that can complement one another.",
  },
  {
    caseId: "H06",
    category: "negative",
    expectedPairs: [],
    justification: "Texts, phone calls, and printed cards use different channels and require different actions, despite serving the same reminder goal.",
  },
  {
    caseId: "H07",
    category: "negative",
    expectedPairs: [],
    justification: "Preserving heritage is a broad objective; restoring plasterwork and preserving posters are distinct possible projects, not duplicates of that objective or each other.",
  },
  {
    caseId: "H08",
    category: "negative",
    expectedPairs: [],
    justification: "Low-flow fixtures, linen reuse, and leak repair are complementary but operationally different water-saving measures.",
  },
  {
    caseId: "H09",
    category: "negative",
    expectedPairs: [],
    justification: "A market, affordable studio space, and an art grant are different ways to support artists and create different commitments.",
  },
  {
    caseId: "H10",
    category: "negative",
    expectedPairs: [],
    justification: "Reducing overall power use is a broad objective; replacing servers and changing cooling are specific, distinct implementations.",
  },
] as const satisfies readonly Readonly<{
  caseId: string;
  category: "positive" | "negative";
  expectedPairs: readonly (readonly [string, string])[];
  justification: string;
}>[];
