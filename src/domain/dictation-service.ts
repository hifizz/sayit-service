import { createHash,randomUUID } from 'node:crypto';
import type { JsonLlm } from '../providers/llm.js';
import type { SttProvider } from '../providers/stt.js';
import type { Storage } from '../storage/types.js';
import type { DictationContext,DictationRecord,RewriteResult,VocabularyEntry } from '../types.js';
import { ServiceError } from '../errors.js';
import { CONSERVATIVE_REWRITE_SUFFIX,GUARD_SYSTEM_PROMPT,REWRITE_SYSTEM_PROMPT,POLICY_VERSION,PROMPT_HASH } from '../prompts.js';
import { guardOutput,guardSchema,rewriteOutput,rewriteSchema } from './schemas.js';
import { formatPersonalization,relevantCorrections,scopedVocabulary,selectKeyTerms } from './personalization.js';
export const sha256=(text:string|Uint8Array)=>createHash('sha256').update(text).digest('hex');
export const styleScope=(context?:DictationContext)=>JSON.stringify([context?.type??'ai_prompt',context?.projectId??'']);
export interface DictationInput {userId:string;audio?:Buffer;filename?:string;mimeType?:string;rawTranscript?:string;language?:string;context?:DictationContext;extraKeyTerms?:string[];requestKey?:string;signal?:AbortSignal}
export interface ServiceOptions {semanticGuardEnabled:boolean;metadata?:Record<string,unknown>}
export class DictationService {
  constructor(private readonly stt:SttProvider,private readonly llm:JsonLlm,private readonly storage:Storage,private readonly options:ServiceOptions){}
  /** Caller holds storage.transaction(userId), including idempotency lookup + commit. */
  async create(input:DictationInput):Promise<DictationRecord>{
    const started=performance.now();const requestHash=sha256(JSON.stringify({audio:input.audio?sha256(input.audio):undefined,text:input.rawTranscript,language:input.language,context:input.context,terms:input.extraKeyTerms??[]}));
    if(input.requestKey){const old=await this.storage.findRequest(input.userId,input.requestKey);if(old){if(old.requestHash!==requestHash)throw new ServiceError(409,'idempotency_key_reused');return old;}}
    const scope=input.context?.projectId??'';const vocabulary=scopedVocabulary(await this.storage.listVocabulary(input.userId),scope);
    const keyTerms=selectKeyTerms(vocabulary,input.extraKeyTerms,input.context?.surroundingText??'');
    const stt=input.rawTranscript!==undefined?{text:input.rawTranscript,language:input.language}:await this.stt.transcribe({audio:input.audio,filename:input.filename,mimeType:input.mimeType,language:input.language,keyTerms,signal:input.signal});
    const asrMs=performance.now()-started;
    const rewritten=await this.rewriteText({userId:input.userId,rawTranscript:stt.text,context:input.context,vocabulary,signal:input.signal});
    const now=new Date().toISOString();
    const record:DictationRecord={id:randomUUID(),userId:input.userId,rawTranscript:stt.text,outputText:rewritten.text,outputHash:sha256(rewritten.text),requestKey:input.requestKey,requestHash,language:stt.language,duration:stt.duration,context:input.context,appliedTerms:rewritten.appliedTerms,transformations:rewritten.transformations,guardStatus:rewritten.guardStatus,meta:{...this.options.metadata,policy_version:POLICY_VERSION,prompt_hash:PROMPT_HASH,input_type:input.rawTranscript!==undefined?'text':'audio',asr_ms:asrMs,total_ms:performance.now()-started,key_terms_count:keyTerms.length},createdAt:now,updatedAt:now};
    await this.storage.createDictation(record);return record;
  }
  async rewriteText(input:{userId:string;rawTranscript:string;context?:DictationContext;vocabulary?:VocabularyEntry[];signal?:AbortSignal}):Promise<RewriteResult>{
    const raw=input.rawTranscript;const fallback=(reason:string):RewriteResult=>({text:raw.trim(),appliedTerms:[],transformations:[reason],guardStatus:'fallback'});
    if(!raw.trim())return {text:'',appliedTerms:[],transformations:['silence'],guardStatus:'safe'};
    const vocabulary=input.vocabulary??scopedVocabulary(await this.storage.listVocabulary(input.userId),input.context?.projectId??'');
    const enabled=await this.storage.personalizationEnabled(input.userId);
    const recent=enabled?await this.storage.listRecentCorrections(input.userId,100):[];
    const style=enabled?await this.storage.getStyleProfile(input.userId,styleScope(input.context)):null;
    const payload={raw,context:input.context??{type:'ai_prompt'},personalization:formatPersonalization({vocabulary,corrections:relevantCorrections(raw,recent,5,input.context?.projectId??''),style})};
    const convert=(out:{final_text:string;applied_terms:string[];transformations:string[]},guardStatus:DictationRecord['guardStatus']):RewriteResult=>({text:out.final_text.trim(),appliedTerms:out.applied_terms.filter(t=>vocabulary.some(v=>v.canonical===t)&&out.final_text.includes(t)),transformations:out.transformations,guardStatus});
    try{
      const first=rewriteOutput.parse(await this.llm.generateJson({system:REWRITE_SYSTEM_PROMPT,user:JSON.stringify(payload),schemaName:'sayit_rewrite',schema:rewriteSchema,signal:input.signal}));
      if(!first.final_text.trim())return fallback('empty_rewrite');
      if(!this.options.semanticGuardEnabled)return convert(first,'disabled');
      const firstGuard=await this.audit(raw,first.final_text,vocabulary,input.signal);
      if(firstGuard.safe)return convert(first,'safe');
      // A failed auditor is not a license to rewrite without checking.
      if(firstGuard.reason==='guard_unavailable')return fallback('guard_unavailable');
      const repaired=rewriteOutput.parse(await this.llm.generateJson({system:REWRITE_SYSTEM_PROMPT+CONSERVATIVE_REWRITE_SUFFIX,user:JSON.stringify({...payload,rejected:first.final_text,reason:firstGuard.reason}),schemaName:'sayit_rewrite_repair',schema:rewriteSchema,signal:input.signal}));
      if((await this.audit(raw,repaired.final_text,vocabulary,input.signal)).safe)return convert({...repaired,transformations:[...repaired.transformations,'semantic_guard_repair']},'repaired');
      return fallback('semantic_guard_rejected');
    }catch{return fallback('rewrite_unavailable_or_invalid');}
  }
  private async audit(raw:string,rewritten:string,vocabulary:VocabularyEntry[],signal?:AbortSignal):Promise<{safe:boolean;reason:string}>{
    if(raw.trim()===rewritten.trim())return {safe:true,reason:'identical'};
    if(!rewritten.trim()||rewritten.length>Math.max(raw.length*3,raw.length+300))return {safe:false,reason:'empty_or_excessive_expansion'};
    try{
      const result=guardOutput.parse(await this.llm.generateJson({system:GUARD_SYSTEM_PROMPT,user:JSON.stringify({raw,rewritten,vocabulary:vocabulary.map(v=>({canonical:v.canonical,aliases:v.aliases}))}),schemaName:'sayit_semantic_guard',schema:guardSchema,signal}));
      const safe=result.safe&&!result.answered_user&&!result.added_facts&&!result.dropped_essential_meaning&&!result.modal_strengthened&&!result.negation_changed&&!result.numbers_changed;
      return {safe,reason:result.reason};
    }catch{return {safe:false,reason:'guard_unavailable'};}
  }
}
