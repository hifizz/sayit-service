import type { JsonLlm,JsonRequest } from '../src/providers/llm.js';
import type { SttProvider,TranscribeInput } from '../src/providers/stt.js';
import { MemoryStorage } from '../src/storage/memory.js';
import { buildApp,type AppDependencies } from '../src/app.js';
export const TOKEN='test-service-token-0000000000000000000000';
export const headers=(user='user_a')=>({authorization:'Bearer '+TOKEN,'x-sayit-user-id':user});
export const safeGuard=(overrides:Record<string,unknown>={})=>({safe:true,answered_user:false,added_facts:false,dropped_essential_meaning:false,modal_strengthened:false,negation_changed:false,numbers_changed:false,reason:'fixture',...overrides});
export class FakeLlm implements JsonLlm {
  calls:JsonRequest[]=[];
  constructor(public handler:(input:JsonRequest)=>unknown|Promise<unknown>=(input)=>{const data=JSON.parse(input.user);if(input.schemaName.startsWith('sayit_rewrite'))return {final_text:data.raw,applied_terms:[],transformations:[]};if(input.schemaName.includes('guard'))return safeGuard();return {items:data.spans.map((_:unknown,i:number)=>({span_index:i,type:'UNKNOWN',confidence:0,reason:'fixture'})),style:{verbosity:null,formality:null,bulletPreference:null}};}){}
  async generateJson<T>(input:JsonRequest):Promise<T>{this.calls.push(input);return await this.handler(input) as T;}
}
export class FakeStt implements SttProvider {calls:TranscribeInput[]=[];constructor(public text='测试服务。'){} async transcribe(input:TranscribeInput){this.calls.push(input);return {text:this.text,duration:1,language:'zh'};}}
export function makeApp(overrides:Partial<AppDependencies>={}){const storage=overrides.storage??new MemoryStorage();const llm=overrides.llm??new FakeLlm();const stt=overrides.stt??new FakeStt();return {storage,llm,stt,app:buildApp({storage,llm,stt,serviceToken:TOKEN,maxRequestsPerMinute:1000,...overrides})};}
export function multipartBody(fields:Record<string,string>,file=Buffer.from('fixture'),filename='audio.wav'){
  const boundary='sayit-test-boundary';const chunks:Buffer[]=[];
  for(const [name,value]of Object.entries(fields))chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/wav\r\n\r\n`),file,Buffer.from(`\r\n--${boundary}--\r\n`));
  return {payload:Buffer.concat(chunks),contentType:'multipart/form-data; boundary='+boundary};
}
