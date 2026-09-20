import { z } from 'zod';
export const contextSchema = z.object({
  type: z.enum(['ai_prompt','message','email','document','other']).default('ai_prompt'),
  app: z.string().max(80).optional(), projectId: z.string().max(100).optional(),
  surroundingText: z.string().max(8000).optional(), selectedText: z.string().max(8000).optional()
}).strict();
export const rewriteOutput = z.object({
  final_text: z.string().max(24000), applied_terms: z.array(z.string().max(80)).max(100),
  transformations: z.array(z.string().max(100)).max(30)
}).strict();
export const guardOutput = z.object({
  safe: z.boolean(), answered_user: z.boolean(), added_facts: z.boolean(),
  dropped_essential_meaning: z.boolean(), modal_strengthened: z.boolean(),
  negation_changed: z.boolean(), numbers_changed: z.boolean(), reason: z.string().max(1000)
}).strict();
export const correctionTypes = ['TERM_CORRECTION','ASR_CORRECTION','SPELLING','GRAMMAR','PUNCTUATION','FORMAT','STYLE','SELF_CORRECTION_FIX','CONTENT_ADDITION','CONTENT_REMOVAL','MEANING_CHANGE','UNKNOWN'] as const;
export const feedbackOutput = z.object({
  items: z.array(z.object({ span_index: z.number().int().min(0), type: z.enum(correctionTypes), confidence: z.number().min(0).max(1), reason: z.string().max(500) }).strict()).max(80),
  style: z.object({ verbosity: z.number().min(0).max(1).nullable(), formality: z.number().min(0).max(1).nullable(), bulletPreference: z.number().min(0).max(1).nullable() }).strict()
}).strict();
const string = { type: 'string' }; const bool = { type: 'boolean' };
export const rewriteSchema = { type:'object', additionalProperties:false, properties:{ final_text:string, applied_terms:{type:'array',items:string}, transformations:{type:'array',items:string} }, required:['final_text','applied_terms','transformations'] };
const flags = ['safe','answered_user','added_facts','dropped_essential_meaning','modal_strengthened','negation_changed','numbers_changed'];
export const guardSchema = { type:'object', additionalProperties:false, properties:{...Object.fromEntries(flags.map(k=>[k,bool])),reason:string}, required:[...flags,'reason'] };
export const feedbackSchema = { type:'object', additionalProperties:false, properties:{
  items:{type:'array',items:{type:'object',additionalProperties:false,properties:{span_index:{type:'integer'},type:{type:'string',enum:correctionTypes},confidence:{type:'number'},reason:string},required:['span_index','type','confidence','reason']}},
  style:{type:'object',additionalProperties:false,properties:{verbosity:{type:['number','null']},formality:{type:['number','null']},bulletPreference:{type:['number','null']}},required:['verbosity','formality','bulletPreference']}
},required:['items','style'] };
