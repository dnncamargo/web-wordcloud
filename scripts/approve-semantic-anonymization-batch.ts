import { randomUUID } from "node:crypto";
import { link, unlink, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  anonymizeEvaluationPlan,
  loadAnonymizationDictionary,
  loadRunnerData,
  parseRunnerOptions,
  planEvaluationCalls,
  preflightResultsPath,
  requireExternalPath,
  type SemanticRunnerOptions,
} from "./evaluate-semantic-merges";
import {
  createBatchApprovalStore,
  type AnonymizationApprovalStore,
  type AnonymizationDictionary,
} from "./semantic-merge-anonymizer";

export type BatchApprovalOptions = Readonly<{
  confirmedReviewedAll: boolean;
  outputPath: string;
}>;

export type BatchApprovalDependencies = Readonly<{
  writeFileFn?: typeof writeFile;
  linkFile?: typeof link;
}>;

export class BatchApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BatchApprovalError";
  }
}

export function parseBatchApprovalOptions(args: readonly string[]): BatchApprovalOptions {
  let confirmedReviewedAll = false;
  let outputPath = "";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--confirm-reviewed-all") {
      confirmedReviewedAll = true;
    } else if (arg === "--output") {
      outputPath = args[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
    } else {
      throw new BatchApprovalError("Usage: approve-semantic-anonymization-batch.ts --confirm-reviewed-all --output ABSOLUTE_EXTERNAL_PATH");
    }
  }
  if (!confirmedReviewedAll) throw new BatchApprovalError("Explicit batch review confirmation is required.");
  if (!outputPath) throw new BatchApprovalError("A new absolute external output path is required.");
  return { confirmedReviewedAll, outputPath };
}

export async function writeBatchApprovalStore(
  outputPath: string,
  store: AnonymizationApprovalStore,
  dependencies: BatchApprovalDependencies = {},
): Promise<void> {
  const preflight = await preflightResultsPath(outputPath);
  const temporary = `${preflight.targetPath}.${process.pid}.${randomUUID()}.partial`;
  const writeFileFn = dependencies.writeFileFn ?? writeFile;
  const linkFile = dependencies.linkFile ?? link;
  try {
    await writeFileFn(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await linkFile(temporary, preflight.targetPath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw new BatchApprovalError(error instanceof Error ? error.message : "Unable to publish batch approvals.");
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export function renderBatchApprovalMetadata(
  store: AnonymizationApprovalStore,
  review: Readonly<{ replacementCount: number; unresolvedRiskCount: number }>,
): string {
  return [
    "SEMANTIC MERGE BATCH APPROVAL",
    "approval_mode=operator-batch",
    `approved_items=${store.approvals.length}`,
    `declared_item_count=${store.declaredItemCount ?? 0}`,
    `corpus_version=${store.corpusVersion}`,
    `rules_fingerprint=${store.rulesFingerprint}`,
    `declaration_fingerprint=${store.declarationFingerprint ?? "unknown"}`,
    `anonymization_replacements=${review.replacementCount}`,
    `anonymization_unresolved_risks=${review.unresolvedRiskCount}`,
    "original_texts_printed=false",
    "openrouter_calls=0",
  ].join("\n");
}

async function runBatchApproval(options: BatchApprovalOptions): Promise<void> {
  const outputPath = requireExternalPath(options.outputPath, "Batch approval output path");
  const runnerOptions: SemanticRunnerOptions = parseRunnerOptions(["--dry-run", "--strategy", "both"]);
  const data = await loadRunnerData(runnerOptions);
  const rawPlan = planEvaluationCalls(data.imported.acceptedMergeBenchmarkCases, data.queue, "both", data.annotatedCases);
  const dictionary: AnonymizationDictionary = await loadAnonymizationDictionary(runnerOptions.anonymizationDictionaryPath);
  const plan = anonymizeEvaluationPlan(rawPlan, dictionary);
  if (!plan.anonymizationItems || !plan.anonymization) throw new BatchApprovalError("Anonymization review is unavailable.");
  const store = createBatchApprovalStore(plan.anonymizationItems, plan.anonymization, options.confirmedReviewedAll, dictionary);
  console.log(renderBatchApprovalMetadata(store, plan.anonymization));
  await writeBatchApprovalStore(outputPath, store);
  console.log("approval_write=complete");
}

function isMainModule(): boolean {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  runBatchApproval(parseBatchApprovalOptions(process.argv.slice(2))).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Batch approval failed.");
    process.exitCode = 1;
  });
}
