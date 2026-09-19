import 'dotenv/config';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve,dirname,basename } from 'node:path';
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryStorage } from '../src/storage/memory.js';
import { OpenAiCompatibleLlm,PassthroughLlm } from '../src/providers/llm.js';
import { XaiSttProvider,UnconfiguredStt } from '../src/providers/stt.js';
import { postEditCost,percentile } from '../src/domain/metrics.js';
import { sha256 } from '../src/domain/dictation-service.js';
import { POLICY_VERSION,PROMPT_HASH } from '../src/prompts.js';
import { contextSchema } from '../src/domain/schemas.js';
const {values}=parseArgs({options:{mode:{type:'string',default:'mock'},dataset:{type:'string',default:'evaluation/cases.jsonl'},out:{type:'string',default:'reports/latest'},limit:{type:'string',default:'100'},'fail-on-checks':{type:'boolean',default:false}}});
const mode=z.enum(['mock','live']).parse(values.mode),limit=z.coerce.number().int().min(1).max(1000).parse(values.limit);
const caseSchema=z.object({id:z.string().regex(/^[a-zA-Z0-9_-]+$/),split:z.enum(['calibration','test']).default('test'),tags:z.array(z.string()).default([]),raw_transcript:z.string().max(20000).optional(),audio_path:z.string().optional(),reference_text:z.string(),reference_asr:z.string().optional(),must_include:z.array(z.string()).default([]),must_not_include:z.array(z.string()).default([]),context:contextSchema.optional(),vocabulary:z.array(z.object({canonical:z.string(),aliases:z.array(z.string()).default([])})).default([])}).strict();
const datasetPath=resolve(values.dataset!),datasetBytes=await readFile(datasetPath,'utf8');
const all=datasetBytes.split(/\r?\n/).filter(line=>line.trim()).map(line=>caseSchema.parse(JSON.parse(line)));
if(new Set(all.map(c=>c.id)).size!==all.length)throw new Error('Duplicate dataset IDs');
if(all.some(c=>(c.raw_transcript===undefined)===(c.audio_path===undefined)))throw new Error('Each case needs exactly one of raw_transcript/audio_path');
const cases=all.slice(0,limit);const token=randomBytes(32).toString('hex');
const c=loadConfig({...process.env,NODE_ENV:'test',SAYIT_SERVICE_TOKEN:token,SAYIT_MODE:mode});
const live=mode==='live';const storage=new MemoryStorage();
const app=buildApp({storage,serviceToken:token,maxRequestsPerMinute:1000,
  stt:live?new XaiSttProvider({apiKey:c.XAI_API_KEY!,baseUrl:c.XAI_BASE_URL,model:c.XAI_STT_MODEL}):new UnconfiguredStt(),
  llm:live?new OpenAiCompatibleLlm({apiKey:c.LLM_API_KEY||c.XAI_API_KEY!,baseUrl:c.LLM_BASE_URL,model:c.LLM_MODEL,jsonMode:c.LLM_JSON_MODE}):new PassthroughLlm(),
  metadata:{mode,asr_model:live?c.XAI_STT_MODEL:null,llm_model:live?c.LLM_MODEL:null}});
interface Row {id:string;split:string;tags:string[];input_sha256:string;audio_sha256?:string;output_text:string|null;raw_transcript?:string;reference_text:string;reference_edit_cost:number|null;reference_exact:boolean;asr_cer:number|null;checked_constraints_pass:boolean|null;failed_checks:string[];guard_status:string|null;latency_ms:number;error?:string}
const rows:Row[]=[];
try{
  for(const item of cases){
    // Every held-out item has an isolated identity. No gold/final reference is fed back into learning.
    const user='eval_'+item.id,headers={authorization:'Bearer '+token,'x-sayit-user-id':user};
    for(const term of item.vocabulary)await storage.upsertVocabulary({userId:user,...term,source:'manual'});
    let audio:Buffer|undefined;
    if(item.audio_path){if(!live)throw new Error('Mock evaluation refuses real audio; use --mode live');audio=await readFile(resolve(dirname(datasetPath),item.audio_path));if(audio.length>c.MAX_AUDIO_BYTES)throw new Error('Audio exceeds configured size');}
    const inputHash=sha256(audio??item.raw_transcript!);const started=performance.now();
    let response;
    if(audio){const boundary='sayit-eval-'+randomBytes(8).toString('hex');const prefix=Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="context"\r\n\r\n${JSON.stringify(item.context??{type:'ai_prompt'})}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${basename(item.audio_path!)}"\r\nContent-Type: application/octet-stream\r\n\r\n`);response=await app.inject({method:'POST',url:'/v1/dictations',headers:{...headers,'content-type':'multipart/form-data; boundary='+boundary},payload:Buffer.concat([prefix,audio,Buffer.from(`\r\n--${boundary}--\r\n`)])});}
    else response=await app.inject({method:'POST',url:'/v1/dictations/text',headers,payload:{raw_transcript:item.raw_transcript,context:item.context}});
    const elapsed=performance.now()-started;const body=response.json();const output=response.statusCode===201?body.text as string:null;
    const failed:string[]=[];
    if(output!==null){for(const term of item.must_include)if(!output.includes(term))failed.push('missing:'+term);for(const term of item.must_not_include)if(output.includes(term))failed.push('forbidden:'+term);}
    rows.push({id:item.id,split:item.split,tags:item.tags,input_sha256:inputHash,audio_sha256:audio?inputHash:undefined,output_text:output,raw_transcript:body.raw_transcript,reference_text:item.reference_text,reference_edit_cost:output===null?null:postEditCost(output,item.reference_text),reference_exact:output===item.reference_text,asr_cer:item.reference_asr&&typeof body.raw_transcript==='string'?postEditCost(body.raw_transcript,item.reference_asr):null,checked_constraints_pass:output===null||item.must_include.length+item.must_not_include.length===0?null:failed.length===0,failed_checks:failed,guard_status:body.meta?.guard_status??null,latency_ms:elapsed,error:output===null?String(body.error??'request_failed'):undefined});
  }
}finally{await app.close();}
let commit='unknown';try{commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
const successful=rows.filter(r=>r.output_text!==null),costs=successful.map(r=>r.reference_edit_cost).filter((x):x is number=>x!==null),checked=rows.filter(r=>r.checked_constraints_pass!==null);
const report={run:{mode,quality_claim:mode==='mock'?'NONE: passthrough harness smoke only':'UNVERIFIED: reference diagnostics, not Typeless parity',created_at:new Date().toISOString(),commit,dataset_sha256:sha256(datasetBytes),policy_version:POLICY_VERSION,prompt_hash:PROMPT_HASH,asr_model:live?c.XAI_STT_MODEL:null,llm_model:live?c.LLM_MODEL:null,llm_origin:new URL(c.LLM_BASE_URL).origin},summary:{total:rows.length,successful:successful.length,failures:rows.length-successful.length,reference_exact_rate:rows.length?rows.filter(r=>r.reference_exact).length/rows.length:null,reference_edit_cost_mean:costs.length?costs.reduce((a,b)=>a+b,0)/costs.length:null,reference_edit_cost_measured:costs.length,checked_constraint_pass_rate:checked.length?checked.filter(r=>r.checked_constraints_pass).length/checked.length:null,checked_cases:checked.length,fallback_rate:successful.length?successful.filter(r=>r.guard_status==='fallback').length/successful.length:null,latency_p50_ms:percentile(rows.map(r=>r.latency_ms),0.5),latency_p95_ms:percentile(rows.map(r=>r.latency_ms),0.95),observed_zero_edit_rate:null,observed_post_edit_cost:null,semantic_violation_rate:null,typeless_parity:null},rows};
await mkdir(values.out!,{recursive:true});await writeFile(resolve(values.out!,'report.json'),JSON.stringify(report,null,2));
const s=report.summary;await writeFile(resolve(values.out!,'report.md'),`# SayIt evaluation\n\nMode: **${mode}**. ${report.run.quality_claim}\n\nCases: ${s.total}; successful: ${s.successful}; failures: ${s.failures}.\n\nReference edit cost: ${s.reference_edit_cost_mean??'unmeasured'} (NOT observed user editing).\nReference exact rate: ${s.reference_exact_rate??'unmeasured'} (NOT zero-edit acceptance).\nChecked constraint pass rate: ${s.checked_constraint_pass_rate??'unmeasured'} across ${s.checked_cases} cases (NOT complete semantic accuracy).\nFallback rate: ${s.fallback_rate??'unmeasured'}.\n\nActual user post-edit cost, semantic violations and Typeless parity require audio/human annotations and remain unmeasured.\n\nDataset SHA256: ${report.run.dataset_sha256}\nPrompt SHA256: ${PROMPT_HASH}\nCommit: ${commit}\n`);
console.log(JSON.stringify({mode,summary:s,report:resolve(values.out!,'report.json')}));
if(s.failures>0||(values['fail-on-checks']&&rows.some(r=>r.checked_constraints_pass===false)))process.exitCode=1;
