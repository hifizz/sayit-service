import 'dotenv/config';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve,dirname,basename } from 'node:path';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { XaiSttProvider } from '../src/providers/stt.js';
import { editDistance,percentile } from '../src/domain/metrics.js';

const {values}=parseArgs({options:{dataset:{type:'string'},out:{type:'string',default:'reports/asr'},provider:{type:'string',default:'xai'},model:{type:'string'},'base-url':{type:'string'},'api-key-env':{type:'string',default:'XAI_API_KEY'},limit:{type:'string',default:'1000'}}});
if(!values.dataset)throw new Error('--dataset is required');
const provider=z.enum(['xai']).parse(values.provider);
const datasetPath=resolve(values.dataset),datasetBytes=await readFile(datasetPath,'utf8');
const schema=z.object({id:z.string(),audio_path:z.string(),reference_asr:z.string(),language:z.string().optional(),key_terms:z.array(z.string()).default([]),term_set:z.array(z.string()).default([]),tags:z.array(z.string()).default([])}).strict();
const all=datasetBytes.split(/\r?\n/).filter(Boolean).map(l=>schema.parse(JSON.parse(l)));
const rows=[] as any[];const apiKey=process.env[values['api-key-env']!];if(!apiKey)throw new Error('Missing API key env '+values['api-key-env']);
const baseUrl=values['base-url']??process.env.XAI_BASE_URL??'https://api.x.ai/v1';const model=values.model??process.env.XAI_STT_MODEL??'grok-voice-transcribe-2.0';
const stt=provider==='xai'?new XaiSttProvider({apiKey,baseUrl,model}):null;
for(const item of all.slice(0,Number(values.limit))){
 const audio=await readFile(resolve(dirname(datasetPath),item.audio_path));const start=performance.now();
 try{const r=await stt!.transcribe({audio,filename:basename(item.audio_path),keyTerms:item.key_terms,language:item.language});const latency=performance.now()-start;
  const d=editDistance(r.text,item.reference_asr);const refLen=Math.max([...item.reference_asr].length,1);
  const termHits=item.term_set.filter(t=>r.text.includes(t)).length;
  rows.push({id:item.id,tags:item.tags,transcript:r.text,reference_asr:item.reference_asr,cer:d===null?null:d/refLen,term_exact: item.term_set.length?termHits/item.term_set.length:null,terms:item.term_set,latency_ms:latency,error:null});
 }catch(e){rows.push({id:item.id,tags:item.tags,transcript:null,reference_asr:item.reference_asr,cer:null,term_exact:null,terms:item.term_set,latency_ms:performance.now()-start,error:e instanceof Error?e.message:String(e)});}
}
const ok=rows.filter(r=>!r.error),measured=ok.filter(r=>r.cer!==null),terms=ok.filter(r=>r.term_exact!==null);
const mean=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const report={run:{stage:'asr',provider,model,base_url_origin:new URL(baseUrl).origin,dataset_sha256:createHash('sha256').update(datasetBytes).digest('hex'),created_at:new Date().toISOString()},summary:{total:rows.length,successful:ok.length,failures:rows.length-ok.length,cer_mean:mean(measured.map(r=>r.cer)),technical_term_exact_mean:mean(terms.map(r=>r.term_exact)),latency_p50_ms:percentile(ok.map(r=>r.latency_ms),.5),latency_p95_ms:percentile(ok.map(r=>r.latency_ms),.95)},rows};
await mkdir(values.out!,{recursive:true});await writeFile(resolve(values.out!,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report.summary));
