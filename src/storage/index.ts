import { MemoryStorage } from './memory.js';
import { PostgresStorage } from './postgres.js';
export function createStorage(databaseUrl?:string,retentionHours=168){return databaseUrl?new PostgresStorage(databaseUrl,retentionHours):new MemoryStorage(retentionHours);}
