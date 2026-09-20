import { beforeEach,afterEach,describe,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PostgresStorage } from '../src/storage/postgres.js';
import { DictationService } from '../src/domain/dictation-service.js';
import { FakeStt,FakeLlm } from './helpers.js';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('real PostgreSQL storage',()=>{
  let storage:PostgresStorage;let user:string;
  beforeEach(()=>{storage=new PostgresStorage(url!);user='test_'+randomUUID();});
  afterEach(async()=>{await storage.transaction(user,tx=>tx.deleteUserData(user));await storage.close();});
  it('persists records and protects ownership across connections',async()=>{const d=await storage.transaction(user,tx=>new DictationService(new FakeStt(),new FakeLlm(),tx,{semanticGuardEnabled:true}).create({userId:user,rawTranscript:'测试'}));const second=new PostgresStorage(url!);try{expect((await second.getDictation(user,d.id))!.outputText).toBe('测试');expect(await second.getDictation('other',d.id)).toBeNull();}finally{await second.close();}});
  it('merges JSONB aliases without duplicates',async()=>{await storage.transaction(user,async tx=>{await tx.upsertVocabulary({userId:user,canonical:'ThreadChat',aliases:['thread chat'],source:'manual'});await tx.upsertVocabulary({userId:user,canonical:'ThreadChat',aliases:['thread chat','threadchat'],source:'manual'});});const terms=await storage.listVocabulary(user);expect(terms).toHaveLength(1);expect(terms[0]!.aliases.sort()).toEqual(['thread chat','threadchat']);});
  it('rolls back dictionary updates atomically',async()=>{await expect(storage.transaction(user,async tx=>{await tx.upsertVocabulary({userId:user,canonical:'Rollback',source:'manual'});throw Error('rollback');})).rejects.toThrow('rollback');expect(await storage.listVocabulary(user)).toHaveLength(0);});
  it('serializes duplicate request keys across transactions',async()=>{const llm=new FakeLlm();const run=()=>storage.transaction(user,tx=>new DictationService(new FakeStt(),llm,tx,{semanticGuardEnabled:true}).create({userId:user,rawTranscript:'测试',requestKey:'same-key-123'}));const [a,b]=await Promise.all([run(),run()]);expect(a.id).toBe(b.id);expect(llm.calls).toHaveLength(1);});
});
