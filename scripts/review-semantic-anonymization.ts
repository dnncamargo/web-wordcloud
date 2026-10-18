import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { rename, unlink, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  anonymizeEvaluationPlan,
  loadAnonymizationApprovals,
  loadAnonymizationDictionary,
  loadRunnerData,
  parseRunnerOptions,
  planEvaluationCalls,
  requireExternalPath,
  type EvaluationPlan,
} from "./evaluate-semantic-merges";
import {
  type AnonymizationApproval,
  type AnonymizationApprovalStore,
  validateApprovedAnonymizedText,
} from "./semantic-merge-anonymizer";

const APPROVAL_VERSION = "semantic-merge-anonymization-approval-v1" as const;

function isMainModule(): boolean {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function json(response: import("node:http").ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += String(chunk);
    if (body.length > 128_000) throw new Error("Request too large.");
  }
  return JSON.parse(body);
}

function page(): string {
  return [
    "<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>",
    "<title>Revisão local de anonimização</title><style>body{font:16px system-ui;max-width:1000px;margin:2rem auto;padding:0 1rem}.grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.text{white-space:pre-wrap;border:1px solid #bbb;padding:.7rem;min-height:3rem}.controls{display:flex;gap:.5rem;flex-wrap:wrap}textarea{width:100%;min-height:4rem}@media(max-width:700px){.grid{grid-template-columns:1fr}}</style>",
    "<h1>Revisão local de anonimização</h1><p id='meta'>Carregando contagens…</p><div class='controls'><select id='cloud'><option value=''>Todas as nuvens</option></select><select id='status'><option value=''>Todos</option><option value='pending'>Pendentes</option><option value='approved'>Aprovados</option><option value='rejected'>Rejeitados</option></select><button id='prev'>Anterior</button><button id='next'>Próximo</button></div><section id='card'></section>",
    "<script>const s={items:[],approvals:{},i:0,cloud:'',status:'',compatible:false};const e=id=>document.getElementById(id);const list=()=>s.items.filter(x=>(!s.cloud||x.cloudPseudonym===s.cloud)&&(!s.status||(s.approvals[x.reviewId]?.status===s.status)||(s.status==='pending'&&!s.approvals[x.reviewId])));function add(p,label,value){let w=document.createElement('div'),t=document.createElement('small'),v=document.createElement('div');t.textContent=label;v.className='text';v.textContent=value;w.append(t,v);p.append(w)}function render(){let l=list();s.i=Math.min(s.i,Math.max(l.length-1,0));let x=l[s.i],c=e('card');c.replaceChildren();e('meta').textContent='Itens: '+s.items.length+' | Pendentes: '+s.items.filter(x=>!s.approvals[x.reviewId]).length+' | Aprovados: '+s.items.filter(x=>s.approvals[x.reviewId]?.status==='approved').length+' | Compatível: '+s.compatible;if(!x){c.textContent='Nenhum item neste filtro.';return}let h=document.createElement('h2');h.textContent='Item '+(s.i+1)+' de '+l.length;c.append(h);add(c,'Contexto pseudonimizado',x.cloudPseudonym);add(c,'Texto original (somente localhost)',x.originalText);add(c,'Texto anonimizado atual',x.anonymizedText);let ta=document.createElement('textarea');ta.value=s.approvals[x.reviewId]?.approvedText||x.anonymizedText;c.append(ta);for(const status of ['approved','rejected']){let b=document.createElement('button');b.textContent=status==='approved'?'Aprovar':'Rejeitar';b.onclick=async()=>{let r=await fetch('/approval',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reviewId:x.reviewId,status,approvedText:ta.value})});if(!r.ok){alert('Aprovação não validada.');return}s.approvals[x.reviewId]=await r.json();render()};c.append(b)}}e('cloud').onchange=x=>{s.cloud=x.target.value;s.i=0;render()};e('status').onchange=x=>{s.status=x.target.value;s.i=0;render()};e('prev').onclick=()=>{s.i=Math.max(0,s.i-1);render()};e('next').onclick=()=>{s.i++;render()};fetch('/state').then(r=>r.json()).then(d=>{s.items=d.items;s.approvals=Object.fromEntries(d.approvals.map(x=>[x.reviewId,x]));s.compatible=d.storeCompatible;for(let c of [...new Set(s.items.map(x=>x.cloudPseudonym))]){let o=document.createElement('option');o.value=c;o.textContent=c;e('cloud').append(o)}render()})</script>",
  ].join("");
}

async function saveStore(path: string, store: AnonymizationApprovalStore): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.partial`;
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  try { await rename(temporary, path); } catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
}

function storeCompatible(plan: EvaluationPlan, store: AnonymizationApprovalStore | undefined): boolean {
  return !store || (store.version === APPROVAL_VERSION && store.corpusVersion === plan.anonymization?.corpusVersion && store.rulesFingerprint === plan.anonymization?.rulesFingerprint);
}

export async function startAnonymizationReviewServer(plan: EvaluationPlan, approvalPath: string, dictionary: ReadonlyMap<string, string>, port = Number(process.env.SEMANTIC_MERGE_REVIEW_PORT ?? "4317")) {
  const items = plan.anonymizationItems ?? [];
  let store = await loadAnonymizationApprovals(approvalPath, true);
  let compatible = storeCompatible(plan, store);
  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/") { response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); response.end(page()); return; }
      if (request.method === "GET" && request.url === "/state") { json(response, 200, { items, approvals: store?.approvals ?? [], storeCompatible: compatible, corpusVersion: plan.anonymization?.corpusVersion ?? "unknown" }); return; }
      if (request.method !== "POST" || request.url !== "/approval") { json(response, 404, { error: "not found" }); return; }
      if (!compatible) { json(response, 409, { error: "incompatible approval store" }); return; }
      const body = await readJson(request);
      if (body === null || typeof body !== "object" || Array.isArray(body)) { json(response, 400, { error: "invalid approval" }); return; }
      const value = body as Record<string, unknown>;
      const item = items.find((candidate) => candidate.reviewId === value.reviewId);
      if (!item || (value.status !== "approved" && value.status !== "rejected") || typeof value.approvedText !== "string" || !validateApprovedAnonymizedText(value.approvedText, dictionary)) { json(response, 422, { error: "approval failed local validation" }); return; }
      const approval: AnonymizationApproval = { reviewId: item.reviewId, sourceTextFingerprint: item.sourceTextFingerprint, baseAnonymizedTextFingerprint: item.anonymizedTextFingerprint, approvedText: value.approvedText, approvedTextFingerprint: hash(value.approvedText), status: value.status };
      const approvals = [...(store?.approvals ?? []).filter((candidate) => candidate.reviewId !== item.reviewId), approval];
      const next: AnonymizationApprovalStore = { version: APPROVAL_VERSION, corpusVersion: plan.anonymization!.corpusVersion!, rulesFingerprint: plan.anonymization!.rulesFingerprint!, approvals };
      await saveStore(approvalPath, next); store = next; compatible = true; json(response, 200, approval);
    } catch { json(response, 500, { error: "local review operation failed" }); }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return server;
}

async function main(): Promise<void> {
  const options = parseRunnerOptions(["--dry-run", "--strategy", "both"]);
  const data = await loadRunnerData(options);
  const rawPlan = planEvaluationCalls(data.imported.acceptedMergeBenchmarkCases, data.queue, "both", data.annotatedCases);
  const dictionary = await loadAnonymizationDictionary(options.anonymizationDictionaryPath);
  const plan = anonymizeEvaluationPlan(rawPlan, dictionary);
  const approvalValue = process.env.SEMANTIC_MERGE_ANONYMIZATION_APPROVALS_PATH;
  if (!approvalValue) throw new Error("Set SEMANTIC_MERGE_ANONYMIZATION_APPROVALS_PATH outside the repository.");
  const approvalPath = requireExternalPath(approvalValue, "Anonymization approvals path");
  await startAnonymizationReviewServer(plan, approvalPath, dictionary);
  console.log(`Local anonymization review: http://127.0.0.1:${process.env.SEMANTIC_MERGE_REVIEW_PORT ?? "4317"}`);
}

if (isMainModule()) main().catch(() => { process.exitCode = 1; });
