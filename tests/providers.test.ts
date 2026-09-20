import { describe,it,expect } from 'vitest';
import { XaiSttProvider } from '../src/providers/stt.js';
import { OpenAiCompatibleLlm } from '../src/providers/llm.js';
import { loadConfig } from '../src/config.js';
import { TOKEN } from './helpers.js';
describe('xAI REST contract',()=>{
  it('uses /v1/stt, repeated keyterm, pinned 2.0 and file-last multipart',async()=>{let seen:RequestInit|undefined,url:unknown;const provider=new XaiSttProvider({apiKey:'test-key',baseUrl:'https://api.x.ai/v1',model:'grok-voice-transcribe-2.0',fetchImpl:(async(u,init)=>{url=u;seen=init;return Response.json({text:'测试',duration:1});}) as typeof fetch});await provider.transcribe({audio:Buffer.from('fixture'),filename:'sample.wav',language:'zh',keyTerms:['E2B','ThreadChat']});expect(url).toBe('https://api.x.ai/v1/stt');const form=seen!.body as FormData;expect(form.getAll('keyterm')).toEqual(['E2B','ThreadChat']);expect([...form.keys()].at(-1)).toBe('file');expect(form.get('model')).toBe('grok-voice-transcribe-2.0');expect(form.get('language')).toBeNull();expect(form.get('format')).toBe('false');expect(form.get('filler_words')).toBe('true');});
  it('accepts a valid silent transcript',async()=>{const p=new XaiSttProvider({apiKey:'x',baseUrl:'https://api.x.ai/v1',model:'x',fetchImpl:(async()=>Response.json({text:'',duration:1})) as typeof fetch});expect((await p.transcribe({audio:Buffer.from('a'),keyTerms:[]})).text).toBe('');});
  it('does not expose upstream error bodies or retry billable requests',async()=>{let calls=0;const p=new XaiSttProvider({apiKey:'x',baseUrl:'https://api.x.ai/v1',model:'x',fetchImpl:(async()=>{calls++;return new Response('secret-token',{status:429});}) as typeof fetch});await expect(p.transcribe({audio:Buffer.from('a'),keyTerms:[]})).rejects.toThrow('provider_unavailable');expect(calls).toBe(1);});
  it('rejects malformed provider output',async()=>{const p=new XaiSttProvider({apiKey:'x',baseUrl:'https://api.x.ai/v1',model:'x',fetchImpl:(async()=>Response.json({text:123})) as typeof fetch});await expect(p.transcribe({audio:Buffer.from('a'),keyTerms:[]})).rejects.toThrow('invalid_stt_response');});
});
describe('LLM transport',()=>{
  const request={system:'system',user:'{}',schemaName:'test',schema:{type:'object'}};
  it.each(['json_object','json_schema'] as const)('supports %s with runtime-domain validation',async(mode)=>{let body:any;const p=new OpenAiCompatibleLlm({apiKey:'x',baseUrl:'https://provider.test/v1',model:'model',jsonMode:mode,fetchImpl:(async(_u,init)=>{body=JSON.parse(init!.body as string);return Response.json({choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]});}) as typeof fetch});expect(await p.generateJson(request)).toEqual({ok:true});expect(body.response_format.type).toBe(mode);});
  it('rejects truncated JSON completions',async()=>{const p=new OpenAiCompatibleLlm({apiKey:'x',baseUrl:'https://provider.test/v1',model:'x',fetchImpl:(async()=>Response.json({choices:[{finish_reason:'length',message:{content:'{}'}}]})) as typeof fetch});await expect(p.generateJson(request)).rejects.toThrow('invalid_provider_json');});
});
describe('deployment configuration',()=>{
  it('requires a non-placeholder service credential',()=>{expect(()=>loadConfig({SAYIT_SERVICE_TOKEN:'replace-with-example-token-000000000'})).toThrow();});
  it('does not allow volatile production data storage',()=>expect(()=>loadConfig({SAYIT_SERVICE_TOKEN:TOKEN,NODE_ENV:'production'})).toThrow('DATABASE_URL'));
  it('requires credentials for live mode',()=>expect(()=>loadConfig({SAYIT_SERVICE_TOKEN:TOKEN,SAYIT_MODE:'live'})).toThrow('XAI_API_KEY'));
  it('starts in visibly mock mode without provider credentials',()=>expect(loadConfig({SAYIT_SERVICE_TOKEN:TOKEN}).SAYIT_MODE).toBe('mock'));
});
