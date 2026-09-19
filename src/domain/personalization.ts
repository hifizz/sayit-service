import type { CorrectionRecord, StyleProfile, VocabularyEntry } from '../types.js';
import { riskyLexicalChange } from './diff.js';
export function scopedVocabulary(items:VocabularyEntry[],scope=''):VocabularyEntry[]{
  const eligible=items.filter(e=>e.status==='active' && (e.scope==='' || e.scope===scope));
  const overrides=new Set(eligible.filter(e=>e.scope===scope && scope!=='').map(e=>e.canonical.toLowerCase()));
  return eligible.filter(e=>e.scope!=='' || !overrides.has(e.canonical.toLowerCase()));
}
export function selectKeyTerms(items:VocabularyEntry[],extra:string[]=[],context=''):string[]{
  const ranked=[...items].filter(e=>e.status==='active').sort((a,b)=>{
    const score=(e:VocabularyEntry)=>(context.toLowerCase().includes(e.canonical.toLowerCase())?1000:0)+(e.source==='manual'?100:0)+Math.min(e.frequency,50);
    return score(b)-score(a);
  }).map(e=>e.canonical);
  return [...new Set([...extra,...ranked].map(t=>t.trim()).filter(t=>t && [...t].length<=50))].slice(0,100);
}
function tokens(text:string):Set<string>{
  const latin=text.toLowerCase().match(/[a-z0-9_+#.-]+/g)??[];const han=[...text].filter(c=>/\p{Script=Han}/u.test(c));
  return new Set([...latin,...han,...han.slice(1).map((c,i)=>han[i]+c)]);
}
export function relevantCorrections(text:string,items:CorrectionRecord[],limit=5,scope=''):CorrectionRecord[]{
  const target=tokens(text);
  return items.filter(e=>e.learn && (e.scope==='' || e.scope===scope) && ['TERM_CORRECTION','ASR_CORRECTION','SPELLING'].includes(e.type))
    .map(item=>{const terms=tokens(item.before+' '+item.after);let overlap=0;for(const t of terms)if(target.has(t))overlap++;return {item,score:overlap/(target.size+terms.size-overlap || 1)};})
    .filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,limit).map(x=>x.item);
}
/** One-pass, boundary-aware and conflict-abstaining; never chain replacements. */
export function applyVocabulary(raw:string,items:VocabularyEntry[]):string{
  const targets=new Map<string,Set<string>>();
  for(const e of items.filter(e=>e.status==='active'))for(const alias of [...e.aliases,e.canonical]){
    if(alias.length<2 || (e.source!=='manual' && riskyLexicalChange(alias,e.canonical)))continue;
    const key=alias.toLowerCase();const set=targets.get(key)??new Set<string>();set.add(e.canonical);targets.set(key,set);
  }
  const aliases=[...targets].filter(([,s])=>s.size===1).map(([a])=>a).sort((a,b)=>b.length-a.length);
  if(!aliases.length)return raw;
  const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const pattern=new RegExp(aliases.map(escape).join('|'),'giu');
  return raw.replace(pattern,(match:string,offset:number)=>{
    const left=raw[offset-1]??'',right=raw[offset+match.length]??'';
    if((/^[a-z0-9_]/i.test(match)&&/[a-z0-9_]/i.test(left))||(/[a-z0-9_]$/i.test(match)&&/[a-z0-9_]/i.test(right)))return match;
    return [...targets.get(match.toLowerCase())!][0]!;
  });
}
export function formatPersonalization(input:{vocabulary:VocabularyEntry[];corrections:CorrectionRecord[];style:StyleProfile|null}):Record<string,unknown>{
  return { vocabulary:input.vocabulary.slice(0,100).map(e=>({canonical:e.canonical,aliases:e.aliases})),
    corrections:input.corrections.map(e=>({before:e.before,after:e.after})),
    style:input.style && input.style.observations>=5 ? {verbosity:input.style.verbosity,formality:input.style.formality,bulletPreference:input.style.bulletPreference} : null };
}
export function defaultStyleProfile(userId:string,scope=''):StyleProfile{return {userId,scope,verbosity:0.5,formality:0.5,bulletPreference:0.5,observations:0,updatedAt:new Date().toISOString()};}
export function mergeStyleSignals(profile:StyleProfile,signals:{verbosity:number|null;formality:number|null;bulletPreference:number|null}):StyleProfile{
  const blend=(a:number,b:number|null)=>b===null?a:Math.max(0,Math.min(1,a*0.9+b*0.1));
  return {...profile,verbosity:blend(profile.verbosity,signals.verbosity),formality:blend(profile.formality,signals.formality),bulletPreference:blend(profile.bulletPreference,signals.bulletPreference),observations:profile.observations+1,updatedAt:new Date().toISOString()};
}
