import type { AppConfig } from '../config.js';
import type { Storage } from './types.js';
import { MemoryStorage } from './memory.js';
import { PostgresStorage } from './postgres.js';

export function createStorage(config: AppConfig): Storage {
  if (config.DATABASE_URL) return new PostgresStorage(config.DATABASE_URL);
  return new MemoryStorage();
}
