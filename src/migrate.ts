import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';

/** Compiled production entrypoint: no tsx or development dependencies required. */
export async function migrate(databaseUrl = process.env.DATABASE_URL): Promise<void> {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('sayit-migrations',0))");
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of (await readdir('migrations')).filter(n => n.endsWith('.sql')).sort()) {
      const sql = await readFile('migrations/' + name, 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      const old = await client.query('SELECT checksum FROM schema_migrations WHERE name=$1', [name]);
      if (old.rows[0]) {
        if (old.rows[0].checksum !== hash) throw new Error('Applied migration changed: ' + name);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [name, hash]);
      console.log('Applied', name);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

await migrate();
