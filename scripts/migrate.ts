import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const sql = await readFile(new URL('../migrations/001_init.sql', import.meta.url), 'utf8');
const pool = new Pool({ connectionString: databaseUrl });

try {
  await pool.query(sql);
  console.log('Migration complete');
} finally {
  await pool.end();
}
