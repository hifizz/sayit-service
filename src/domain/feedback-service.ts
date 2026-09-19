import { randomUUID } from 'node:crypto';
import type { JsonLlm } from '../providers/llm.js';
import type { Storage } from '../storage/types.js';
import type { CorrectionRecord,FeedbackReceipt } from '../types.js';
import { ServiceError } from '../errors.js';
import { FEEDBACK_SYSTEM_PROMPT,GUARD_SYSTEM_PROMPT } from '../prompts.js';
import { feedbackOutput,feedbackSchema,guardOutput,guardSchema } from './schemas.js';
import { defaultStyleProfile,mergeStyleSignals } from './personalization.js';
import { changedSpans,normalizedSpelling,riskyLexicalChange } from './diff.js';
import { postEditCost } from './metrics.js';
import { sha256,styleScope } from './dictation-service.js';
export interface FeedbackInput {event_id:string;output_sha256:string;final_text:string;attribution:'dictation_span'|'whole_message';confirmed_terms?:Array<{before:string;after:string}>}
const LEXICAL=new Set(['TERM_CORRECTION','ASR_CORRECTION','SPELLING']);
const PRESENTATION=new Set(['GRAMMAR','PUNCTUATION','FORMAT','STYLE']);
export class FeedbackService {
  constructor(private readonly llm:JsonLlm,private readonly storage:Storage){}
  /** Entire operation is committed atomically by the HTTP transaction wrapper. */
  async submit(userId:string,dictationId:string,input:FeedbackInput,signal?:AbortSignal):Promise<FeedbackReceipt>{
    const d=await this.storage.getDictation(userId,dictationId);if(!d)throw new ServiceError(404,'dictation_not_found');
    if(d.outputHash!==input.output_sha256)throw new ServiceError(409,'stale_dictation_output');
    const fingerprint=sha256(JSON.stringify({final:input.final_text,attribution:input.attribution,confirmed:input.confirmed_terms??[]}));
    if(d.feedback){if(d.feedback.fingerprint===fingerprint)return d.feedback;throw new ServiceError(409,'feedback_already_finalized');}
    const receipt:FeedbackReceipt={eventId:input.event_id,fingerprint,status:'skipped',learnedVocabulary:[],candidateVocabulary:[],corrections:[],postEditCost:input.attribution==='dictation_span'?postEditCost(d.outputText,input.final_text):null,createdAt:new Date().toISOString()};
    const finish=async(reason?:string)=>{receipt.reason=reason;await this.storage.setFeedback(userId,dictationId,receipt);return receipt;};
    if(input.attribution!=='dictation_span')return finish('unreliable_span_attribution');
    if(d.outputText===input.final_text){receipt.status='no_change';return finish();}
    if(!await this.storage.personalizationEnabled(userId))return finish('personalization_disabled');
    const spans=changedSpans(d.outputText,input.final_text);
    if(!spans || spans.length>80)return finish('edit_too_large_for_safe_learning');
    const analysis=feedbackOutput.parse(await this.llm.generateJson({system:FEEDBACK_SYSTEM_PROMPT,user:JSON.stringify({raw:d.rawTranscript,generated:d.outputText,final:input.final_text,context:{type:d.context?.type??'ai_prompt'},spans:spans.map((s,i)=>({...s,span_index:i}))}),schemaName:'sayit_feedback',schema:feedbackSchema,signal}));
    if(analysis.items.length!==spans.length||new Set(analysis.items.map(x=>x.span_index)).size!==spans.length||analysis.items.some(x=>x.span_index>=spans.length))throw new ServiceError(502,'invalid_feedback_alignment');
    const previous=await this.storage.listRecentCorrections(userId,500),scope=d.context?.projectId??'';
    const existingVocabulary=await this.storage.listVocabulary(userId);
    for(const item of analysis.items){
      const span=spans[item.span_index]!;const before=span.before.trim(),after=span.after.trim();
      const confirmed=input.confirmed_terms?.some(p=>p.before===before&&p.after===after)??false;
      const lexical=(LEXICAL.has(item.type)&&item.confidence>=0.95)||confirmed;
      const isEligible=lexical&&!riskyLexicalChange(before,after)&&before!==after;
      const priorPair=previous.some(c=>c.dictationId!==dictationId&&c.scope===scope&&LEXICAL.has(c.type)&&c.confidence>=0.95&&c.before.trim()===before&&c.after.trim()===after);
      const activate=isEligible&&(confirmed||normalizedSpelling(before)===normalizedSpelling(after)||priorPair);
      const record:CorrectionRecord={id:randomUUID(),userId,dictationId,scope,before:span.before,after:span.after,type:confirmed?'TERM_CORRECTION':item.type,confidence:confirmed?1:item.confidence,learn:false,reason:item.reason,createdAt:receipt.createdAt};
      if(isEligible && (existingVocabulary.length<1000||existingVocabulary.some(v=>v.canonical===after&&v.scope===scope))){
        // Do not activate every proposed alias when one alias is confirmed: candidates keep no aliases.
        const entry=await this.storage.upsertVocabulary({userId,canonical:after,aliases:activate?[before]:[],scope,source:'auto',confidence:record.confidence,activate});
        if(entry.status==='active'&&activate){record.learn=true;receipt.learnedVocabulary.push(entry.canonical);}
        else if(entry.status==='candidate')receipt.candidateVocabulary.push(entry.canonical);
      }
      receipt.corrections.push(record);
    }
    await this.storage.addCorrections(receipt.corrections);
    const styleCandidate=analysis.items.length>0&&analysis.items.every(x=>PRESENTATION.has(x.type)&&x.confidence>=0.95)&&Object.values(analysis.style).some(x=>x!==null);
    if(styleCandidate){
      // Independent equivalence gate: misclassified factual edits must not teach a style.
      try{
        const audit=guardOutput.parse(await this.llm.generateJson({system:GUARD_SYSTEM_PROMPT,user:JSON.stringify({raw:d.outputText,rewritten:input.final_text,vocabulary:[]}),schemaName:'sayit_feedback_guard',schema:guardSchema,signal}));
        if(audit.safe&&!audit.answered_user&&!audit.added_facts&&!audit.dropped_essential_meaning&&!audit.modal_strengthened&&!audit.negation_changed&&!audit.numbers_changed){
          const profile=await this.storage.getStyleProfile(userId,styleScope(d.context))??defaultStyleProfile(userId,styleScope(d.context));
          await this.storage.saveStyleProfile(mergeStyleSignals(profile,analysis.style));
        }
      }catch{/* Feedback remains usable; an unavailable style auditor contributes no signal. */}
    }
    receipt.learnedVocabulary=[...new Set(receipt.learnedVocabulary)];receipt.candidateVocabulary=[...new Set(receipt.candidateVocabulary)];
    receipt.status='learned';return finish();
  }
}
