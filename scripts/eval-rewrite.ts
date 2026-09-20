import 'dotenv/config';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { OpenAiCompatibleLlm } from '../src/providers/llm.js';
import { DictationService } from '../src/domain/dictation-service.js';
import { MemoryStorage } from '../src/storage/memory.js';
import { UnconfiguredStt } from '../src/providers/stt.js';
import { postEditCost,percentile } from '../src/domain/metrics.js';

const {values}=parseArgs({options:{dataset:{type:'string',default:'evaluation/cases.jsonl'},out:{type:'string',default:'reports/rewrite'},model:{type:'string'},'base-url':{type:'string'},'api-key-env':{type:'string',default:'LLM_API_KEY'},limit:{type:'string',default:'1000'},guard:{type:'boolean',default:true}}});
const datasetPath=resolve(values.dataset!),bytes=await readFile(datasetPath,'utf8');
const schema=z.object({id:z.string(),raw_transcript:z.string(),reference_text:z.string(),tags:z.array(z.string()).default([]),must_include:z.array(z.string()).default([]),must_not_include:z.array(z.string()).default([]),context:z.any().optional(),vocabulary:z.array(z.object({canonical:z.string(),aliases:z.array(z.string()).default([])})).default([])}).passthrough();
const cases=bytes.split(/\r?\n/).filter(Boolean).map(l=>schema.parse(JSON.parse(l))).slice(0,Number(values.limit));
const apiKey=process.env[values['api-key-env']!]||process.env.XAI_API_KEY;if(!apiKey)throw new Error('Missing LLM API key');
const baseUrl=values['base-url']??process.env.LLM_BASE_URL;if(!baseUrl)throw new Error('Missing --base-url or LLM_BASE_URL');
const model=values.model??process.env.LLM_MODEL;if(!model)throw new Error('Missing --model or LLM_MODEL');
const storage=new MemoryStorage();const llm=new OpenAiCompatibleLlm({apiKey,baseUrl,model,jsonMode:'json_object'});
const service=new DictationService(new UnconfiguredStt(),llm,storage,{semanticGuardEnabled:values.guard!});
const rows=[] as any[];
for(const item of cases){const user='rewrite_'+item.id;for(const v of item.vocabulary)await storage.upsertVocabulary({userId:user,...v,source:'manual'});
 const start=performance.now();try{const r=await service.rewriteText({userId:user,rawTranscript:item.raw_transcript,context:item.context});const failed=[...item.must_include.filter(t=>!r.text.includes(t)).map(t=>'missing:'+t),...item.must_not_include.filter(t=>r.text.includes(t)).map(t=>'forbidden:'+t)];
 rows.push({id:item.id,tags:item.tags,raw_transcript:item.raw_transcript,output_text:r.text,reference_text:item.reference_text,edit_cost:postEditCost(r.text,item.reference_text),exact:r.text===item.reference_text,constraint_pass:failed.length===0,failed_checks:failed,guard_status:r.guardStatus,latency_ms:performance.now()-start,error:null});
 }catch(e){rows.push({id:item.id,tags:item.tags,error:e instanceof Error?e.message:String(e),latency_ms:performance.now()-start});}}
const ok=rows.filter(r=>!r.error),costs=ok.map(r=>r.edit_cost).filter((x:any)=>x!==null);const mean=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const report={run:{stage:'rewrite',model,base_url_origin:new URL(baseUrl).origin,guard:values.guard,dataset_sha256:createHash('sha256').update(bytes).digest('hex'),created_at:new Date().toISOString()},summary:{total:rows.length,successful:ok.length,failures:rows.length-ok.length,reference_edit_cost_mean:mean(costs),reference_exact_rate:ok.length?ok.filter(r=>r.exact).length/ok.length:null,constraint_pass_rate:ok.length?ok.filter(r=>r.constraint_pass).length/ok.length:null,fallback_rate:ok.length?ok.filter(r=>r.guard_status==='fallback').length/ok.length:null,latency_p50_ms:percentile(ok.map(r=>r.latency_ms),.5),latency_p95_ms:percentile(ok.map(r=>r.latency_ms),.95)},rows};
await mkdir(values.out!,{recursive:true});await writeFile(resolve(values.out!,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report.summary));
