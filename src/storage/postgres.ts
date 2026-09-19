import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { CorrectionRecord, DictationRecord, StyleProfile, VocabularyEntry } from '../types.js';
import type { Storage } from './types.js';

function mapVocabulary(row: any): VocabularyEntry {
  return {
    id: row.id,
    userId: row.user_id,
    canonical: row.canonical,
    aliases: row.aliases || [],
    confidence: Number(row.confidence),
    frequency: Number(row.frequency),
    source: row.source,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

function mapDictation(row: any): DictationRecord {
  return {
    id: row.id,
    userId: row.user_id,
    rawTranscript: row.raw_transcript,
    outputText: row.output_text,
    finalUserText: row.final_user_text || undefined,
    language: row.language || undefined,
    duration: row.duration == null ? undefined : Number(row.duration),
    context: row.context || undefined,
    appliedTerms: row.applied_terms || [],
    guardStatus: row.guard_status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

export class PostgresStorage implements Storage {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async createDictation(record: DictationRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO dictations
       (id, user_id, raw_transcript, output_text, language, duration, context, applied_terms, guard_status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11)`,
      [
        record.id, record.userId, record.rawTranscript, record.outputText,
        record.language ?? null, record.duration ?? null,
        JSON.stringify(record.context ?? null), JSON.stringify(record.appliedTerms),
        record.guardStatus, record.createdAt, record.updatedAt
      ]
    );
  }

  async getDictation(id: string): Promise<DictationRecord | null> {
    const result = await this.pool.query('SELECT * FROM dictations WHERE id = $1', [id]);
    return result.rows[0] ? mapDictation(result.rows[0]) : null;
  }

  async setFinalUserText(id: string, finalUserText: string): Promise<void> {
    await this.pool.query(
      'UPDATE dictations SET final_user_text = $2, updated_at = now() WHERE id = $1',
      [id, finalUserText]
    );
  }

  async listVocabulary(userId: string): Promise<VocabularyEntry[]> {
    const result = await this.pool.query(
      'SELECT * FROM vocabulary WHERE user_id = $1 ORDER BY frequency DESC, confidence DESC, updated_at DESC',
      [userId]
    );
    return result.rows.map(mapVocabulary);
  }

  async upsertVocabulary(input: {
    userId: string;
    canonical: string;
    aliases?: string[];
    source: 'manual' | 'auto';
    confidence?: number;
  }): Promise<VocabularyEntry> {
    const id = randomUUID();
    const canonical = input.canonical.trim();
    const aliases = [...new Set((input.aliases || []).map((v) => v.trim()).filter(Boolean))];
    const confidence = input.confidence ?? (input.source === 'manual' ? 1 : 0.85);
    const result = await this.pool.query(
      `INSERT INTO vocabulary (id, user_id, canonical, aliases, confidence, frequency, source)
       VALUES ($1,$2,$3,$4::jsonb,$5,1,$6)
       ON CONFLICT (user_id, canonical)
       DO UPDATE SET
         aliases = (
           SELECT jsonb_agg(DISTINCT value)
           FROM jsonb_array_elements_text(vocabulary.aliases || EXCLUDED.aliases) AS value
         ),
         confidence = GREATEST(vocabulary.confidence, EXCLUDED.confidence),
         frequency = vocabulary.frequency + 1,
         source = CASE WHEN EXCLUDED.source = 'manual' THEN 'manual' ELSE vocabulary.source END,
         updated_at = now()
       RETURNING *`,
      [id, input.userId, canonical, JSON.stringify(aliases), confidence, input.source]
    );
    return mapVocabulary(result.rows[0]);
  }

  async deleteVocabulary(userId: string, id: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM vocabulary WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    return (result.rowCount || 0) > 0;
  }

  async addCorrections(records: CorrectionRecord[]): Promise<void> {
    for (const record of records) {
      await this.pool.query(
        `INSERT INTO corrections
         (id, user_id, dictation_id, before_text, after_text, correction_type, confidence, learn, reason, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          record.id, record.userId, record.dictationId, record.before, record.after,
          record.type, record.confidence, record.learn, record.reason ?? null, record.createdAt
        ]
      );
    }
  }

  async listRecentCorrections(userId: string, limit = 100): Promise<CorrectionRecord[]> {
    const result = await this.pool.query(
      'SELECT * FROM corrections WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, limit]
    );
    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      dictationId: row.dictation_id,
      before: row.before_text,
      after: row.after_text,
      type: row.correction_type,
      confidence: Number(row.confidence),
      learn: row.learn,
      reason: row.reason || undefined,
      createdAt: new Date(row.created_at).toISOString()
    }));
  }

  async getStyleProfile(userId: string): Promise<StyleProfile | null> {
    const result = await this.pool.query('SELECT * FROM style_profiles WHERE user_id = $1', [userId]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      userId: row.user_id,
      directness: Number(row.directness),
      verbosity: Number(row.verbosity),
      formality: Number(row.formality),
      bulletPreference: Number(row.bullet_preference),
      hedging: Number(row.hedging),
      technicalTerms: row.technical_terms,
      observations: Number(row.observations),
      updatedAt: new Date(row.updated_at).toISOString()
    };
  }

  async saveStyleProfile(profile: StyleProfile): Promise<void> {
    await this.pool.query(
      `INSERT INTO style_profiles
       (user_id, directness, verbosity, formality, bullet_preference, hedging, technical_terms, observations, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (user_id)
       DO UPDATE SET
         directness = EXCLUDED.directness,
         verbosity = EXCLUDED.verbosity,
         formality = EXCLUDED.formality,
         bullet_preference = EXCLUDED.bullet_preference,
         hedging = EXCLUDED.hedging,
         technical_terms = EXCLUDED.technical_terms,
         observations = EXCLUDED.observations,
         updated_at = EXCLUDED.updated_at`,
      [
        profile.userId, profile.directness, profile.verbosity, profile.formality,
        profile.bulletPreference, profile.hedging, profile.technicalTerms,
        profile.observations, profile.updatedAt
      ]
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
