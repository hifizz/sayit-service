import type { CorrectionRecord, DictationRecord, FeedbackReceipt, StyleProfile, UpsertVocabulary, VocabularyEntry } from '../types.js';
export interface Storage {
  transaction<T>(userId:string, work:(tx:Storage)=>Promise<T>):Promise<T>;
  createDictation(record:DictationRecord):Promise<void>;
  getDictation(userId:string,id:string):Promise<DictationRecord|null>;
  findRequest(userId:string,key:string):Promise<DictationRecord|null>;
  setFeedback(userId:string,id:string,receipt:FeedbackReceipt):Promise<void>;
  deleteDictation(userId:string,id:string):Promise<boolean>;
  listVocabulary(userId:string):Promise<VocabularyEntry[]>;
  upsertVocabulary(input:UpsertVocabulary):Promise<VocabularyEntry>;
  deleteVocabulary(userId:string,id:string):Promise<boolean>;
  addCorrections(records:CorrectionRecord[]):Promise<void>;
  listRecentCorrections(userId:string,limit?:number):Promise<CorrectionRecord[]>;
  getStyleProfile(userId:string,scope?:string):Promise<StyleProfile|null>;
  saveStyleProfile(profile:StyleProfile):Promise<void>;
  personalizationEnabled(userId:string):Promise<boolean>;
  setPersonalization(userId:string,enabled:boolean):Promise<void>;
  resetPersonalization(userId:string):Promise<void>;
  deleteUserData(userId:string):Promise<void>;
  purgeExpired():Promise<number>;
  ping():Promise<void>;
  close():Promise<void>;
}
