import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { timingSafeEqual,createHash } from 'node:crypto';
import { z } from 'zod';
import type { JsonLlm } from './providers/llm.js';
import type { SttProvider } from './providers/stt.js';
import type { Storage } from './storage/types.js';
import type { DictationRecord } from './types.js';
import { DictationService,styleScope } from './domain/dictation-service.js';
import { FeedbackService } from './domain/feedback-service.js';
import { contextSchema } from './domain/schemas.js';
import { ServiceError } from './errors.js';
export interface AppDependencies {storage:Storage;stt:SttProvider;llm:JsonLlm;serviceToken:string;semanticGuardEnabled?:boolean;maxAudioBytes?:number;maxRequestsPerMinute?:number;maxConcurrent?:number;requestBudgetMs?:number;logger?:boolean;metadata?:Record<string,unknown>}
const idSchema=z.object({id:z.string().uuid()});
const termsSchema=z.array(z.string().trim().min(1).max(50)).max(100);
const textSchema=z.object({raw_transcript:z.string().max(20000),context:contextSchema.optional(),language:z.string().max(20).optional(),key_terms:termsSchema.optional()}).strict();
const feedbackSchema=z.object({event_id:z.string().uuid(),output_sha256:z.string().regex(/^[a-f0-9]{64}$/),final_text:z.string().max(20000),attribution:z.enum(['dictation_span','whole_message']),confirmed_terms:z.array(z.object({before:z.string().min(1).max(50),after:z.string().min(1).max(50)}).strict()).max(20).optional()}).strict();
const vocabularySchema=z.object({canonical:z.string().trim().min(1).max(50),aliases:z.array(z.string().trim().min(1).max(50)).max(20).default([]),scope:z.string().max(100).default('')}).strict();
const tokenHash=(s:string)=>createHash('sha256').update(s).digest();
const serialize=(d:DictationRecord)=>({id:d.id,text:d.outputText,output_sha256:d.outputHash,raw_transcript:d.rawTranscript,meta:{...d.meta,language:d.language,duration:d.duration,terms_applied:d.appliedTerms,transformations:d.transformations,guard_status:d.guardStatus},created_at:d.createdAt});
export function buildApp(deps:AppDependencies){
  if(deps.serviceToken.length<32)throw new Error('Service token must be at least 32 characters');
  const maxAudioBytes=deps.maxAudioBytes??25*1024*1024;
  const app=Fastify({bodyLimit:maxAudioBytes+65536,requestTimeout:130000,logger:deps.logger?{redact:['req.headers.authorization','req.headers.cookie','req.headers.x-sayit-user-id'],serializers:{req:(req:any)=>({method:req.method,url:String(req.url).split('?')[0]}),res:(res:any)=>({statusCode:res.statusCode})}}:false});
  const users=new WeakMap<object,string>(),active=new WeakSet<object>();const rates=new Map<string,{start:number;count:number}>();let running=0;
  app.register(multipart,{limits:{fileSize:maxAudioBytes,files:1,fields:8,fieldSize:32768,parts:9}});
  const user=(request:object)=>users.get(request)!;
  const transact=<T>(request:object,work:(tx:Storage)=>Promise<T>)=>deps.storage.transaction(user(request),work);
  const dictations=(storage:Storage)=>new DictationService(deps.stt,deps.llm,storage,{semanticGuardEnabled:deps.semanticGuardEnabled??true,metadata:deps.metadata});
  const signal=()=>AbortSignal.timeout(deps.requestBudgetMs??115000);
  const requestKey=(header:unknown)=>header===undefined?undefined:z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/).parse(header);
  app.addHook('onRequest',async(request,reply)=>{
    if(request.url==='/health'||request.url==='/ready')return;
    const authorization=request.headers.authorization??'';
    if(!authorization.startsWith('Bearer ')||!timingSafeEqual(tokenHash(authorization.slice(7)),tokenHash(deps.serviceToken)))throw new ServiceError(401,'unauthorized');
    const uid=z.string().min(1).max(128).regex(/^[A-Za-z0-9:_-]+$/).parse(request.headers['x-sayit-user-id']);users.set(request,uid);
    const now=Date.now();for(const [key,value]of rates)if(now-value.start>60000)rates.delete(key);
    const rate=rates.get(uid)??{start:now,count:0};rate.count++;rates.set(uid,rate);
    if(rate.count>(deps.maxRequestsPerMinute??60)||rates.size>10000){reply.header('Retry-After','60');throw new ServiceError(429,'rate_limited');}
    if(running>=(deps.maxConcurrent??16))throw new ServiceError(503,'server_busy');running++;active.add(request);
  });
  app.addHook('onResponse',async(request)=>{if(active.has(request)){active.delete(request);running--;}});
  app.addHook('onSend',async(request,reply,payload)=>{reply.header('X-Request-Id',request.id).header('Cache-Control','no-store');return payload;});
  app.get('/health',async()=>({ok:true}));
  app.get('/ready',async()=>{await deps.storage.ping();return {ok:true};});
  app.post('/v1/dictations',async(request,reply)=>{
    if(!request.isMultipart())throw new ServiceError(415,'multipart_audio_required');
    const fields:Record<string,string>={};let audio:Buffer|undefined,filename:string|undefined,mimeType:string|undefined;
    for await(const part of request.parts()){
      if(part.type==='file'){if(part.fieldname!=='file')throw new ServiceError(400,'expected_file_field');audio=await part.toBuffer();filename=part.filename;mimeType=part.mimetype;}
      else {if(!['context','language','key_terms'].includes(part.fieldname)||part.fieldname in fields)throw new ServiceError(400,'invalid_or_duplicate_field');fields[part.fieldname]=String(part.value);}
    }
    if(!audio?.length)throw new ServiceError(400,'empty_audio');
    if(!filename||! /\.(wav|mp3|ogg|opus|flac|aac|mp4|m4a|mkv|webm)$/i.test(filename))throw new ServiceError(415,'unsupported_audio_container');
    const context=fields.context?contextSchema.parse(JSON.parse(fields.context)):undefined;
    const extraKeyTerms=fields.key_terms?termsSchema.parse(JSON.parse(fields.key_terms)):[];
    const language=fields.language?z.string().max(20).parse(fields.language):undefined;
    const key=requestKey(request.headers['idempotency-key']);
    const record=await transact(request,tx=>dictations(tx).create({userId:user(request),audio,filename,mimeType,context,language,extraKeyTerms,requestKey:key,signal:signal()}));
    return reply.code(201).send(serialize(record));
  });
  app.post('/v1/dictations/text',async(request,reply)=>{
    const body=textSchema.parse(request.body),key=requestKey(request.headers['idempotency-key']);
    const d=await transact(request,tx=>dictations(tx).create({userId:user(request),rawTranscript:body.raw_transcript,context:body.context,language:body.language,extraKeyTerms:body.key_terms,requestKey:key,signal:signal()}));
    return reply.code(201).send(serialize(d));
  });
  app.get('/v1/dictations/:id',async(request)=>{const {id}=idSchema.parse(request.params);const d=await deps.storage.getDictation(user(request),id);if(!d)throw new ServiceError(404,'dictation_not_found');return serialize(d);});
  app.delete('/v1/dictations/:id',async(request,reply)=>{const {id}=idSchema.parse(request.params);if(!await transact(request,tx=>tx.deleteDictation(user(request),id)))throw new ServiceError(404,'dictation_not_found');return reply.code(204).send();});
  app.post('/v1/dictations/:id/feedback',async(request)=>{const {id}=idSchema.parse(request.params),body=feedbackSchema.parse(request.body);return transact(request,tx=>new FeedbackService(deps.llm,tx).submit(user(request),id,body,signal()));});
  app.get('/v1/vocabulary',async(request)=>({items:(await deps.storage.listVocabulary(user(request))).filter(e=>e.status!=='blocked')}));
  app.post('/v1/vocabulary',async(request,reply)=>{
    const body=vocabularySchema.parse(request.body);const result=await transact(request,async tx=>{const all=await tx.listVocabulary(user(request));if(all.length>=1000&&!all.some(v=>v.canonical===body.canonical&&v.scope===body.scope))throw new ServiceError(409,'vocabulary_limit');return tx.upsertVocabulary({...body,userId:user(request),source:'manual',confidence:1});});return reply.code(201).send(result);
  });
  app.delete('/v1/vocabulary/:id',async(request,reply)=>{const {id}=idSchema.parse(request.params);if(!await transact(request,tx=>tx.deleteVocabulary(user(request),id)))throw new ServiceError(404,'vocabulary_not_found');return reply.code(204).send();});
  app.get('/v1/personalization',async(request)=>{const query=z.object({type:z.enum(['ai_prompt','message','email','document','other']).default('ai_prompt'),project_id:z.string().max(100).optional()}).strict().parse(request.query);return {enabled:await deps.storage.personalizationEnabled(user(request)),style:await deps.storage.getStyleProfile(user(request),styleScope({type:query.type,projectId:query.project_id}))};});
  app.patch('/v1/personalization',async(request)=>{const {enabled}=z.object({enabled:z.boolean()}).strict().parse(request.body);await transact(request,tx=>tx.setPersonalization(user(request),enabled));return {enabled};});
  app.delete('/v1/personalization',async(request,reply)=>{await transact(request,tx=>tx.resetPersonalization(user(request)));return reply.code(204).send();});
  app.delete('/v1/me/data',async(request,reply)=>{await transact(request,tx=>tx.deleteUserData(user(request)));return reply.code(204).send();});
  app.setErrorHandler((error,request,reply)=>{
    if(error instanceof ServiceError)return reply.code(error.status).send({error:error.code,request_id:request.id});
    if(error instanceof z.ZodError)return reply.code(400).send({error:'invalid_request',fields:error.issues.map(e=>e.path.join('.')),request_id:request.id});
    if(error instanceof SyntaxError)return reply.code(400).send({error:'invalid_json',request_id:request.id});
    const e=error as {code?:string;statusCode?:number};
    if(e.code==='23505')return reply.code(409).send({error:'conflict',request_id:request.id});
    if(e.statusCode&&e.statusCode>=400&&e.statusCode<500)return reply.code(e.statusCode).send({error:e.statusCode===413?'payload_too_large':'invalid_request',request_id:request.id});
    // Never log request bodies, audio, transcripts, credentials, or upstream response bodies.
    app.log.error({requestId:request.id,code:'internal_error'},'Request failed');
    return reply.code(500).send({error:'internal_error',request_id:request.id});
  });
  app.addHook('onClose',async()=>deps.storage.close());return app;
}
