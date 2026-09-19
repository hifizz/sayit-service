import { randomUUID } from 'node:crypto';
import type { CorrectionRecord, DictationRecord, FeedbackReceipt, StyleProfile, UpsertVocabulary, VocabularyEntry } from '../types.js';
import type { Storage } from './types.js';
interface State { dictations:Map<string,DictationRecord>; vocabulary:Map<string,VocabularyEntry>; corrections:CorrectionRecord[]; styles:Map<string,StyleProfile>; settings:Map<string,boolean> }
const initial=():State=>({dictations:new Map(),vocabulary:new Map(),corrections:[],styles:new Map(),settings:new Map()});
export class MemoryStorage implements Storage {
  private data:State=initial(); private queue:Promise<void>=Promise.resolve();
  constructor(private readonly retentionHours=168,private readonly nested=false){}
  async transaction<T>(_user:string,work:(tx:Storage)=>Promise<T>):Promise<T>{
    if(this.nested)return work(this);
    const previous=this.queue;let release!:()=>void;this.queue=new Promise<void>(resolve=>{release=resolve;});await previous;
    const tx=new MemoryStorage(this.retentionHours,true);tx.data=structuredClone(this.data);
    try{const result=await work(tx);this.data=tx.data;return result;}finally{release();}
  }
  private alive(d:DictationRecord):boolean{return Date.parse(d.createdAt)>Date.now()-this.retentionHours*3600000;}
  async createDictation(d:DictationRecord){this.data.dictations.set(d.id,structuredClone(d));}
  async getDictation(user:string,id:string){const d=this.data.dictations.get(id);return d?.userId===user&&this.alive(d)?structuredClone(d):null;}
  async findRequest(user:string,key:string){
    for(const d of [...this.data.dictations.values()])if(d.userId===user&&d.requestKey===key&&!this.alive(d))await this.deleteDictation(user,d.id);
    const d=[...this.data.dictations.values()].find(x=>x.userId===user&&x.requestKey===key);return d?structuredClone(d):null;
  }
  async setFeedback(user:string,id:string,receipt:FeedbackReceipt){const d=this.data.dictations.get(id);if(d?.userId===user){d.feedback=structuredClone(receipt);d.updatedAt=new Date().toISOString();}}
  async deleteDictation(user:string,id:string){const d=this.data.dictations.get(id);if(d?.userId!==user)return false;this.data.dictations.delete(id);this.data.corrections=this.data.corrections.filter(c=>c.dictationId!==id);return true;}
  async listVocabulary(user:string){return structuredClone([...this.data.vocabulary.values()].filter(e=>e.userId===user));}
  async upsertVocabulary(input:UpsertVocabulary){
    const scope=input.scope??'',canonical=input.canonical.trim();const existing=[...this.data.vocabulary.values()].find(e=>e.userId===input.userId&&e.scope===scope&&e.canonical===canonical);
    const now=new Date().toISOString();
    const entry:VocabularyEntry=existing??{id:randomUUID(),userId:input.userId,canonical,scope,aliases:[],frequency:0,confidence:0,source:input.source,status:'candidate',createdAt:now,updatedAt:now};
    if(entry.status==='blocked'&&input.source==='auto')return structuredClone(entry);
    // Explicitly restoring a removed term starts with the supplied aliases only.
    const oldAliases=entry.status==='blocked'&&input.source==='manual'?[]:entry.aliases;
    entry.aliases=[...new Set([...oldAliases,...(input.aliases??[])].map(a=>a.trim()).filter(Boolean))].slice(0,20);
    entry.frequency+=input.source==='auto'?1:entry.frequency===0?1:0;entry.confidence=Math.max(entry.confidence,input.confidence??1);
    if(input.source==='manual'){entry.source='manual';entry.status='active';}else if(input.activate){entry.status='active';}
    entry.updatedAt=now;this.data.vocabulary.set(entry.id,entry);return structuredClone(entry);
  }
  async deleteVocabulary(user:string,id:string){const e=this.data.vocabulary.get(id);if(e?.userId!==user)return false;e.status='blocked';e.updatedAt=new Date().toISOString();this.data.corrections=this.data.corrections.filter(c=>!(c.userId===user&&c.scope===e.scope&&(c.after===e.canonical||e.aliases.includes(c.before))));return true;}
  async addCorrections(records:CorrectionRecord[]){this.data.corrections.push(...structuredClone(records));}
  async listRecentCorrections(user:string,limit=100){return structuredClone(this.data.corrections.filter(c=>c.userId===user&&Date.parse(c.createdAt)>Date.now()-this.retentionHours*3600000).slice(-limit).reverse());}
  async getStyleProfile(user:string,scope=''){return structuredClone(this.data.styles.get(JSON.stringify([user,scope]))??null);}
  async saveStyleProfile(profile:StyleProfile){this.data.styles.set(JSON.stringify([profile.userId,profile.scope]),structuredClone(profile));}
  async personalizationEnabled(user:string){return this.data.settings.get(user)??true;}
  async setPersonalization(user:string,enabled:boolean){this.data.settings.set(user,enabled);}
  async resetPersonalization(user:string){for(const [id,e]of this.data.vocabulary)if(e.userId===user)this.data.vocabulary.delete(id);this.data.corrections=this.data.corrections.filter(c=>c.userId!==user);for(const [id,p]of this.data.styles)if(p.userId===user)this.data.styles.delete(id);}
  async deleteUserData(user:string){await this.resetPersonalization(user);for(const [id,d]of this.data.dictations)if(d.userId===user)this.data.dictations.delete(id);this.data.settings.delete(user);}
  async purgeExpired(){let count=0;for(const d of [...this.data.dictations.values()])if(!this.alive(d)){await this.deleteDictation(d.userId,d.id);count++;}return count;}
  async ping(){} async close(){}
}
