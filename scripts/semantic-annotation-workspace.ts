import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  consolidateAnnotationRecords,
  importCalibrationCorpus,
  loadCalibrationExport,
  selectSemanticMergeAnnotationQueue,
  SEMANTIC_MERGE_BENCHMARK_VERSION,
  type AcceptedMergeBenchmarkCase,
  type AdministrativeDecision,
  type AnnotationConfidence,
  type AdjudicationStatus,
  type SemanticAnnotationRecord,
  type SemanticMergeAnnotationQueue,
  type SemanticMergeLabel,
} from "./semantic-merge-benchmark";

export const ANNOTATION_STORAGE_VERSION = "semantic-merge-v1-annotations" as const;
export const DEFAULT_WORKSPACE_PORT = 4317;

export type AnnotationStore = Readonly<{
  storageVersion: typeof ANNOTATION_STORAGE_VERSION;
  benchmarkVersion: typeof SEMANTIC_MERGE_BENCHMARK_VERSION;
  selectionVersion: "lexical-stratified-v1";
  saltFingerprint: string;
  annotations: readonly SemanticAnnotationRecord[];
  updatedAt: string | null;
}>;

export type AnnotationReviewFilter = "all" | "pending" | "reviewed";

export class SemanticAnnotationWorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SemanticAnnotationWorkspaceError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPathOutsideRepository(path: string): boolean {
  if (!isAbsolute(path)) return false;
  const repository = resolve(process.cwd());
  const candidate = resolve(path);
  const relation = relative(repository, candidate);
  return (
    relation === ".." ||
    relation.startsWith("../") ||
    relation.startsWith("..\\") ||
    isAbsolute(relation)
  );
}

function requireExternalPath(path: string, description: string): string {
  if (!isPathOutsideRepository(path)) {
    throw new SemanticAnnotationWorkspaceError(`${description} must be outside the repository.`);
  }
  return resolve(path);
}

export function saltFingerprint(salt: string): string {
  if (salt.length < 16 || salt.length > 512) {
    throw new SemanticAnnotationWorkspaceError("Annotation salt has an invalid length.");
  }
  return createHash("sha256").update(salt).digest("hex");
}

export function createEmptyAnnotationStore(fingerprint: string): AnnotationStore {
  return {
    storageVersion: ANNOTATION_STORAGE_VERSION,
    benchmarkVersion: SEMANTIC_MERGE_BENCHMARK_VERSION,
    selectionVersion: "lexical-stratified-v1",
    saltFingerprint: fingerprint,
    annotations: [],
    updatedAt: null,
  };
}

export function parseAnnotationStore(
  value: unknown,
  expectedSaltFingerprint: string,
): AnnotationStore {
  if (!isRecord(value)) {
    throw new SemanticAnnotationWorkspaceError("Annotation store must be an object.");
  }
  const expectedKeys = [
    "storageVersion",
    "benchmarkVersion",
    "selectionVersion",
    "saltFingerprint",
    "annotations",
    "updatedAt",
  ].sort();
  const actualKeys = Object.keys(value).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new SemanticAnnotationWorkspaceError("Annotation store has an incompatible shape.");
  }
  if (
    value.storageVersion !== ANNOTATION_STORAGE_VERSION ||
    value.benchmarkVersion !== SEMANTIC_MERGE_BENCHMARK_VERSION ||
    value.selectionVersion !== "lexical-stratified-v1"
  ) {
    throw new SemanticAnnotationWorkspaceError("Annotation store version is incompatible.");
  }
  if (value.saltFingerprint !== expectedSaltFingerprint) {
    throw new SemanticAnnotationWorkspaceError("Annotation store belongs to another salt.");
  }
  if (value.updatedAt !== null && typeof value.updatedAt !== "string") {
    throw new SemanticAnnotationWorkspaceError("Annotation store updatedAt is invalid.");
  }
  if (!Array.isArray(value.annotations)) {
    throw new SemanticAnnotationWorkspaceError("Annotation store annotations must be an array.");
  }
  let annotations: readonly SemanticAnnotationRecord[];
  try {
    annotations = consolidateAnnotationRecords(
      value.annotations as SemanticAnnotationRecord[],
    );
  } catch (error) {
    if (error instanceof Error) throw new SemanticAnnotationWorkspaceError(error.message);
    throw new SemanticAnnotationWorkspaceError("Annotation store contains invalid records.");
  }
  return {
    storageVersion: ANNOTATION_STORAGE_VERSION,
    benchmarkVersion: SEMANTIC_MERGE_BENCHMARK_VERSION,
    selectionVersion: "lexical-stratified-v1",
    saltFingerprint: expectedSaltFingerprint,
    annotations,
    updatedAt: value.updatedAt as string | null,
  };
}

export function serializeAnnotationStore(store: AnnotationStore): string {
  const normalized = parseAnnotationStore(store, store.saltFingerprint);
  return `${JSON.stringify(normalized, null, 2)}\n`;
}

async function readAnnotationStore(
  path: string,
  expectedSaltFingerprint: string,
): Promise<AnnotationStore> {
  try {
    const text = await readFile(path, "utf8");
    try {
      return parseAnnotationStore(JSON.parse(text), expectedSaltFingerprint);
    } catch (error) {
      if (error instanceof SemanticAnnotationWorkspaceError) throw error;
      throw new SemanticAnnotationWorkspaceError("Annotation store is not valid JSON.");
    }
  } catch (error) {
    if (error instanceof SemanticAnnotationWorkspaceError) throw error;
    if (isRecord(error) && error.code === "ENOENT") {
      return createEmptyAnnotationStore(expectedSaltFingerprint);
    }
    throw new SemanticAnnotationWorkspaceError("Unable to read annotation store.");
  }
}

async function writeAnnotationStore(path: string, store: AnnotationStore): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, serializeAnnotationStore(store), {
    encoding: "utf8",
    flag: "wx",
  });
  try {
    await rename(temporaryPath, path);
  } catch (error) {
    try {
      await writeFile(temporaryPath, "", { flag: "wx" });
    } catch {
      // The temporary file is deliberately left recoverable if cleanup races.
    }
    throw new SemanticAnnotationWorkspaceError(
      error instanceof Error ? error.message : "Unable to save annotation store.",
    );
  }
}

export function filterAnnotationQueue(
  queue: SemanticMergeAnnotationQueue,
  cloudPseudonym: string | "all",
  reviewFilter: AnnotationReviewFilter,
  annotations: readonly SemanticAnnotationRecord[],
): readonly SemanticMergeAnnotationQueue["items"][number][] {
  const byCase = new Map(annotations.map((annotation) => [annotation.caseId, annotation]));
  return queue.items.filter((item) => {
    if (cloudPseudonym !== "all" && item.cloudPseudonym !== cloudPseudonym) return false;
    if (reviewFilter === "all") return true;
    const annotation = byCase.get(item.caseId);
    const reviewed = annotation !== undefined && annotation.adjudicationStatus !== "unadjudicated";
    return reviewFilter === "reviewed" ? reviewed : !reviewed;
  });
}

export function moveAnnotationIndex(current: number, delta: -1 | 1, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, current + delta));
}

export function renderAnnotationWorkspaceHtml(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Semantic Merge Annotation Workspace</title>
<style>
:root{font-family:system-ui,sans-serif;color:#172033;background:#f5f7fb}body{max-width:1000px;margin:0 auto;padding:24px}main{background:#fff;border:1px solid #dfe4ef;border-radius:12px;padding:20px;box-shadow:0 8px 28px #17203312}h1{font-size:1.35rem;margin-top:0}.toolbar,.actions,.progress{display:flex;gap:12px;align-items:center;flex-wrap:wrap}label{font-size:.9rem;color:#536079}select,button{font:inherit;padding:8px;border:1px solid #bbc5d8;border-radius:7px;background:#fff}button{cursor:pointer}button.primary{background:#243b73;color:#fff;border-color:#243b73}.card{margin-top:18px;padding:18px;border:1px solid #dfe4ef;border-radius:9px}.idea{padding:12px;background:#f5f7fb;border-radius:7px;margin-top:8px;white-space:pre-wrap;overflow-wrap:anywhere}.muted{color:#65718a;font-size:.9rem}.error{color:#9b1c31}.ok{color:#167044}.spacer{flex:1}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:700px){.grid{grid-template-columns:1fr}}
</style></head>
<body><main>
<h1>Semantic Merge Annotation Workspace</h1>
<p class="muted">Experimental local workspace. Decisions are saved explicitly outside the repository.</p>
<div class="toolbar"><label>Nuvem <select id="cloudFilter"><option value="all">Todas</option></select></label><label>Estado <select id="reviewFilter"><option value="all">Todos</option><option value="pending">Pendentes</option><option value="reviewed">Revisados</option></select></label><span class="spacer"></span><span id="progress" class="muted"></span></div>
<div id="cloudProgress" class="muted"></div>
<section class="card"><div id="question" class="muted"></div><div class="grid"><div><strong>Ideia 1</strong><div id="firstText" class="idea"></div></div><div><strong>Ideia 2</strong><div id="secondText" class="idea"></div></div></div></section>
<section class="card"><div class="toolbar"><label>Classificação <select id="label"><option value="equivalent">equivalent</option><option value="related_but_distinct">related_but_distinct</option><option value="general_vs_specific">general_vs_specific</option><option value="administrative_merge">administrative_merge</option><option value="uncertain">uncertain</option></select></label><label>Confiança <select id="confidence"><option value="high">high</option><option value="medium">medium</option><option value="low">low</option></select></label></div><div class="toolbar" style="margin-top:12px"><label>Adjudicação <select id="adjudication"><option value="unadjudicated">unadjudicated</option><option value="agreed">agreed</option><option value="adjudicated">adjudicated</option></select></label><label>Decisão administrativa <select id="administrative"><option value="not_recorded">not_recorded</option><option value="merge">merge</option><option value="keep_separate">keep_separate</option></select></label></div></section>
<div class="actions" style="margin-top:18px"><button id="previous">Anterior</button><button id="save" class="primary">Salvar decisão</button><button id="next">Próximo</button><span id="status" class="muted"></span></div>
</main>
<script>
(() => {
  const state = { data: null, filtered: [], index: 0 };
  const byId = (id) => document.getElementById(id);
  const setText = (id, value) => { byId(id).textContent = value || ""; };
  const annotationFor = (caseId) => state.data.annotations.find((item) => item.caseId === caseId);
  const refresh = () => {
    const cloud = byId("cloudFilter").value;
    const review = byId("reviewFilter").value;
    state.filtered = state.data.items.filter((item) => {
      if (cloud !== "all" && item.cloudPseudonym !== cloud) return false;
      if (review === "all") return true;
      const annotation = annotationFor(item.caseId);
      const reviewed = annotation && annotation.adjudicationStatus !== "unadjudicated";
      return review === "reviewed" ? reviewed : !reviewed;
    });
    state.index = Math.min(state.index, Math.max(0, state.filtered.length - 1));
    const item = state.filtered[state.index];
    setText("progress", state.data.annotations.length + " / " + state.data.items.length + " decisões");
    setText("cloudProgress", "Fila filtrada: " + state.filtered.length + " casos");
    if (!item) { setText("question", "Nenhum caso neste filtro."); setText("firstText", ""); setText("secondText", ""); return; }
    const current = state.data.cases.find((candidate) => candidate.caseId === item.caseId);
    setText("question", current.question); setText("firstText", current.firstText); setText("secondText", current.secondText);
    const annotation = annotationFor(item.caseId);
    byId("label").value = annotation?.humanLabel || "uncertain";
    byId("confidence").value = annotation?.confidence || "medium";
    byId("adjudication").value = annotation?.adjudicationStatus || "unadjudicated";
    byId("administrative").value = annotation?.administrativeDecision || "not_recorded";
    setText("status", "Caso " + (state.index + 1) + " de " + state.filtered.length);
  };
  const save = async () => {
    const item = state.filtered[state.index]; if (!item) return;
    const response = await fetch("/api/annotations/" + encodeURIComponent(item.caseId), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ humanLabel: byId("label").value, confidence: byId("confidence").value, adjudicationStatus: byId("adjudication").value, administrativeDecision: byId("administrative").value }) });
    if (!response.ok) { setText("status", "Falha ao salvar"); return; }
    state.data.annotations = (await response.json()).annotations; setText("status", "Salvo"); refresh();
  };
  byId("cloudFilter").addEventListener("change", () => { state.index = 0; refresh(); }); byId("reviewFilter").addEventListener("change", () => { state.index = 0; refresh(); });
  byId("previous").addEventListener("click", () => { state.index = Math.max(0, state.index - 1); refresh(); }); byId("next").addEventListener("click", () => { state.index = Math.min(Math.max(0, state.filtered.length - 1), state.index + 1); refresh(); }); byId("save").addEventListener("click", save);
  fetch("/api/state").then((response) => response.json()).then((data) => { state.data = data; [...new Set(data.items.map((item) => item.cloudPseudonym))].sort().forEach((cloud) => { const option = document.createElement("option"); option.value = cloud; option.textContent = cloud; byId("cloudFilter").appendChild(option); }); refresh(); }).catch(() => setText("status", "Falha ao carregar a fila"));
})();
</script></body></html>`;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += String(chunk);
    if (body.length > 16_384) throw new SemanticAnnotationWorkspaceError("Request body is too large.");
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new SemanticAnnotationWorkspaceError("Request body is not valid JSON.");
  }
}

async function loadOrCreateSalt(path: string): Promise<string> {
  try {
    const salt = await readFile(path, "utf8");
    if (!/^[a-f0-9]{32,512}$/u.test(salt.trim())) throw new SemanticAnnotationWorkspaceError("Salt file is invalid.");
    return salt.trim();
  } catch (error) {
    if (!(isRecord(error) && error.code === "ENOENT")) throw error;
    await mkdir(dirname(path), { recursive: true });
    const salt = randomBytes(32).toString("hex");
    try { await writeFile(path, `${salt}\n`, { encoding: "utf8", flag: "wx" }); return salt; }
    catch { return loadOrCreateSalt(path); }
  }
}

type WorkspaceCase = Readonly<{
  caseId: string;
  question: string;
  firstText: string;
  secondText: string;
  pairIdentity: string;
  cloudPseudonym: string;
}>;

function makeWorkspaceCases(
  benchmarkCases: readonly AcceptedMergeBenchmarkCase[],
  queue: SemanticMergeAnnotationQueue,
): readonly WorkspaceCase[] {
  const byId = new Map(benchmarkCases.map((benchmarkCase) => [benchmarkCase.caseId, benchmarkCase]));
  return queue.items.map((item) => {
    const benchmarkCase = byId.get(item.caseId);
    if (!benchmarkCase) throw new SemanticAnnotationWorkspaceError("Queue references an unknown case.");
    return {
      caseId: benchmarkCase.caseId,
      question: benchmarkCase.question,
      firstText: benchmarkCase.pair.first.text,
      secondText: benchmarkCase.pair.second.text,
      pairIdentity: benchmarkCase.pair.identity,
      cloudPseudonym: benchmarkCase.source.cloudPseudonym,
    };
  });
}

export type SemanticAnnotationWorkspaceOptions = Readonly<{
  corpusPath: string;
  annotationsPath: string;
  saltPath: string;
  port?: number;
}>;

export async function startSemanticAnnotationWorkspace(
  options: SemanticAnnotationWorkspaceOptions,
): Promise<ReturnType<typeof createServer>> {
  const corpusPath = requireExternalPath(options.corpusPath, "Corpus path");
  const annotationsPath = requireExternalPath(options.annotationsPath, "Annotation path");
  const saltPath = requireExternalPath(options.saltPath, "Salt path");
  const salt = await loadOrCreateSalt(saltPath);
  const fingerprint = saltFingerprint(salt);
  const exportData = await loadCalibrationExport(corpusPath);
  const imported = importCalibrationCorpus(exportData, salt);
  const queue = selectSemanticMergeAnnotationQueue(imported.acceptedMergeBenchmarkCases, 60);
  const cases = makeWorkspaceCases(imported.acceptedMergeBenchmarkCases, queue);
  let store = await readAnnotationStore(annotationsPath, fingerprint);
  const caseById = new Map(cases.map((item) => [item.caseId, item]));
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(renderAnnotationWorkspaceHtml());
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/state") {
        json(response, 200, { queue, items: queue.items, cases, annotations: store.annotations });
        return;
      }
      const match = url.pathname.match(/^\/api\/annotations\/([^/]+)$/u);
      if (request.method === "PUT" && match) {
        const caseId = decodeURIComponent(match[1]!);
        const workspaceCase = caseById.get(caseId);
        if (!workspaceCase) { json(response, 404, { error: "Unknown annotation case." }); return; }
        const body = await readJsonBody(request);
        if (!isRecord(body) || typeof body.humanLabel !== "string" || typeof body.confidence !== "string" || typeof body.adjudicationStatus !== "string" || typeof body.administrativeDecision !== "string") {
          json(response, 400, { error: "Annotation fields are required." }); return;
        }
        const next: SemanticAnnotationRecord = {
          benchmarkVersion: SEMANTIC_MERGE_BENCHMARK_VERSION,
          caseId,
          pairIdentity: workspaceCase.pairIdentity,
          humanLabel: body.humanLabel as SemanticMergeLabel,
          confidence: body.confidence as AnnotationConfidence,
          adjudicationStatus: body.adjudicationStatus as Exclude<AdjudicationStatus, "not_applicable">,
          administrativeDecision: body.administrativeDecision as AdministrativeDecision,
        };
        const annotations = consolidateAnnotationRecords([
          ...store.annotations.filter((annotation) => annotation.caseId !== caseId),
          next,
        ]);
        const nextStore: AnnotationStore = { ...store, annotations, updatedAt: new Date().toISOString() };
        await writeAnnotationStore(annotationsPath, nextStore);
        store = nextStore;
        json(response, 200, { annotations: store.annotations });
        return;
      }
      json(response, 404, { error: "Not found." });
    } catch (error) {
      const message = error instanceof SemanticAnnotationWorkspaceError ? error.message : "Workspace request failed.";
      json(response, 400, { error: message });
    }
  });
  await new Promise<void>((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? DEFAULT_WORKSPACE_PORT, "127.0.0.1", () => resolveServer());
  });
  return server;
}

async function main(): Promise<void> {
  const corpusPath = process.env.SEMANTIC_MERGE_CORPUS_PATH;
  const annotationsPath = process.env.SEMANTIC_MERGE_ANNOTATIONS_PATH;
  const saltPath = process.env.SEMANTIC_MERGE_SALT_PATH;
  if (!corpusPath || !annotationsPath || !saltPath) {
    throw new SemanticAnnotationWorkspaceError(
      "Set SEMANTIC_MERGE_CORPUS_PATH, SEMANTIC_MERGE_ANNOTATIONS_PATH and SEMANTIC_MERGE_SALT_PATH.",
    );
  }
  const server = await startSemanticAnnotationWorkspace({ corpusPath, annotationsPath, saltPath });
  console.log(`Semantic annotation workspace listening at http://127.0.0.1:${(server.address() as { port: number }).port}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Unable to start annotation workspace.");
    process.exitCode = 1;
  });
}
