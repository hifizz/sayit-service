import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type { CorrectionRecord, DictationRecord, FeedbackReceipt, StyleProfile, UpsertVocabulary, VocabularyEntry } from '../types.js';
import type { Storage } from './types.js';
import { ServiceError } from '../errors.js';
const iso=(v:unknown)=>new Date(v as string).toISOString();
function dictation(r:any):DictationRecord{return {id:r.id,userId:r.user_id,rawTranscript:r.raw_transcript,outputText:r.output_text,outputHash:r.output_hash,requestKey:r.request_key??undefined,requestHash:r.request_hash??undefined,language:r.language??undefined,duration:r.duration??undefined,context:r.context??undefined,appliedTerms:r.applied_terms,transformations:r.transformations,guardStatus:r.guard_status,feedback:r.feedback??undefined,meta:r.meta,createdAt:iso(r.created_at),updatedAt:iso(r.updated_at)};}
function vocabulary(r:any):VocabularyEntry{return {id:r.id,userId:r.user_id,canonical:r.canonical,aliases:r.aliases??[],scope:r.scope,confidence:Number(r.confidence),frequency:r.frequency,source:r.source,status:r.status,createdAt:iso(r.created_at),updatedAt:iso(r.updated_at)};}
export class PostgresStorage implements Storage {
  private readonly pool:Pool;
  constructor(url:string,private readonly retentionHours=168,private readonly client?:PoolClient,pool?:Pool){this.pool=pool??new Pool({connectionString:url,max:20,connectionTimeoutMillis:5000});}
  private q(sql:string,args:unknown[]=[]){return (this.client??this.pool).query(sql,args);}
  async transaction<T>(user:string,work:(tx:Storage)=>Promise<T>):Promise<T>{
    if(this.client)return work(this);
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');await client.query("SET LOCAL lock_timeout = '2000ms'");
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user]);
      const result=await work(new PostgresStorage('',this.retentionHours,client,this.pool));await client.query('COMMIT');return result;
    }catch(error){await client.query('ROLLBACK');if((error as {code?:string}).code==='55P03')throw new ServiceError(409,'user_request_in_progress');throw error;}finally{client.release();}
  }
  async createDictation(d:DictationRecord){await this.q(`INSERT INTO dictations (id,user_id,raw_transcript,output_text,output_hash,request_key,request_hash,language,duration,context,applied_terms,transformations,guard_status,meta,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14::jsonb,$15,$16)`,[d.id,d.userId,d.rawTranscript,d.outputText,d.outputHash,d.requestKey??null,d.requestHash??null,d.language??null,d.duration??null,JSON.stringify(d.context??null),JSON.stringify(d.appliedTerms),JSON.stringify(d.transformations),d.guardStatus,JSON.stringify(d.meta),d.createdAt,d.updatedAt]);}
  async getDictation(user:string,id:string){const r=await this.q("SELECT * FROM dictations WHERE user_id=$1 AND id=$2 AND created_at>now()-($3 * interval '1 hour')",[user,id,this.retentionHours]);return r.rows[0]?dictation(r.rows[0]):null;}
  async findRequest(user:string,key:string){const r=await this.q("SELECT * FROM dictations WHERE user_id=$1 AND request_key=$2 AND created_at>now()-($3 * interval '1 hour')",[user,key,this.retentionHours]);return r.rows[0]?dictation(r.rows[0]):null;}
  async setFeedback(user:string,id:string,receipt:FeedbackReceipt){await this.q('UPDATE dictations SET feedback=$3::jsonb,updated_at=now() WHERE user_id=$1 AND id=$2',[user,id,JSON.stringify(receipt)]);}
  async deleteDictation(user:string,id:string){const r=await this.q('DELETE FROM dictations WHERE user_id=$1 AND id=$2',[user,id]);return !!r.rowCount;}
  async listVocabulary(user:string){const r=await this.q('SELECT * FROM vocabulary WHERE user_id=$1 ORDER BY frequency DESC,updated_at DESC LIMIT 2000',[user]);return r.rows.map(vocabulary);}
  async upsertVocabulary(i:UpsertVocabulary){
    const r=await this.q(`INSERT INTO vocabulary (id,user_id,canonical,aliases,confidence,frequency,source,scope,status) VALUES ($1,$2,$3,$4::jsonb,$5,1,$6,$7,$8)
      ON CONFLICT (user_id,canonical,scope) DO UPDATE SET
      aliases=CASE WHEN vocabulary.status='blocked' AND EXCLUDED.source='auto' THEN vocabulary.aliases ELSE COALESCE((SELECT jsonb_agg(value) FROM (SELECT DISTINCT value FROM jsonb_array_elements_text(vocabulary.aliases || EXCLUDED.aliases) AS value LIMIT 20) a),'[]'::jsonb) END,
      frequency=vocabulary.frequency+CASE WHEN EXCLUDED.source='auto' THEN 1 ELSE 0 END,
      confidence=GREATEST(vocabulary.confidence,EXCLUDED.confidence),
      source=CASE WHEN EXCLUDED.source='manual' THEN 'manual' ELSE vocabulary.source END,
      status=CASE WHEN EXCLUDED.source='manual' THEN 'active' WHEN vocabulary.status='blocked' THEN 'blocked' WHEN EXCLUDED.status='active' THEN 'active' ELSE vocabulary.status END,updated_at=now() RETURNING *`,
      [randomUUID(),i.userId,i.canonical.trim(),JSON.stringify(i.aliases??[]),i.confidence??1,i.source,i.scope??'',i.source==='manual'||i.activate?'active':'candidate']);
    return vocabulary(r.rows[0]);
  }
  async deleteVocabulary(user:string,id:string){
    const r=await this.q("UPDATE vocabulary SET status='blocked',updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *",[user,id]);if(!r.rows[0])return false;
    const e=vocabulary(r.rows[0]);await this.q('DELETE FROM corrections WHERE user_id=$1 AND scope=$2 AND (after_text=$3 OR before_text=ANY($4::text[]))',[user,e.scope,e.canonical,e.aliases]);return true;
  }
  async addCorrections(records:CorrectionRecord[]){for(const r of records)await this.q('INSERT INTO corrections (id,user_id,dictation_id,before_text,after_text,correction_type,confidence,learn,reason,scope,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[r.id,r.userId,r.dictationId,r.before,r.after,r.type,r.confidence,r.learn,r.reason??null,r.scope,r.createdAt]);}
  async listRecentCorrections(user:string,limit=100){const r=await this.q("SELECT * FROM corrections WHERE user_id=$1 AND created_at>now()-($3 * interval '1 hour') ORDER BY created_at DESC LIMIT $2",[user,limit,this.retentionHours]);return r.rows.map((v):CorrectionRecord=>({id:v.id,userId:v.user_id,dictationId:v.dictation_id,scope:v.scope,before:v.before_text,after:v.after_text,type:v.correction_type,confidence:Number(v.confidence),learn:v.learn,reason:v.reason??undefined,createdAt:iso(v.created_at)}));}
  async getStyleProfile(user:string,scope=''){const r=await this.q('SELECT * FROM style_profiles WHERE user_id=$1 AND scope=$2',[user,scope]);const v=r.rows[0];return v?{userId:user,scope,verbosity:Number(v.verbosity),formality:Number(v.formality),bulletPreference:Number(v.bullet_preference),observations:v.observations,updatedAt:iso(v.updated_at)}:null;}
  async saveStyleProfile(p:StyleProfile){await this.q('INSERT INTO style_profiles (user_id,scope,verbosity,formality,bullet_preference,observations,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,scope) DO UPDATE SET verbosity=EXCLUDED.verbosity,formality=EXCLUDED.formality,bullet_preference=EXCLUDED.bullet_preference,observations=EXCLUDED.observations,updated_at=EXCLUDED.updated_at',[p.userId,p.scope,p.verbosity,p.formality,p.bulletPreference,p.observations,p.updatedAt]);}
  async personalizationEnabled(user:string){const r=await this.q('SELECT enabled FROM personalization_settings WHERE user_id=$1',[user]);return r.rows[0]?.enabled??true;}
  async setPersonalization(user:string,enabled:boolean){await this.q('INSERT INTO personalization_settings (user_id,enabled) VALUES ($1,$2) ON CONFLICT(user_id) DO UPDATE SET enabled=EXCLUDED.enabled',[user,enabled]);}
  async resetPersonalization(user:string){await this.q('DELETE FROM corrections WHERE user_id=$1',[user]);await this.q('DELETE FROM vocabulary WHERE user_id=$1',[user]);await this.q('DELETE FROM style_profiles WHERE user_id=$1',[user]);}
  async deleteUserData(user:string){await this.resetPersonalization(user);await this.q('DELETE FROM dictations WHERE user_id=$1',[user]);await this.q('DELETE FROM personalization_settings WHERE user_id=$1',[user]);}
  async purgeExpired(){const r=await this.q("DELETE FROM dictations WHERE created_at<=now()-($1 * interval '1 hour')",[this.retentionHours]);return r.rowCount??0;}
  async ping(){await this.q('SELECT 1');}
  async close(){if(!this.client)await this.pool.end();}
}
