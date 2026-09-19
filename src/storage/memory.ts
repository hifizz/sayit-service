import { randomUUID } from 'node:crypto';
import type { CorrectionRecord, DictationRecord, StyleProfile, VocabularyEntry } from '../types.js';
import type { Storage } from './types.js';

export class MemoryStorage implements Storage {
  private dictations = new Map<string, DictationRecord>();
  private vocabulary = new Map<string, VocabularyEntry>();
  private corrections: CorrectionRecord[] = [];
  private styles = new Map<string, StyleProfile>();

  async createDictation(record: DictationRecord): Promise<void> {
    this.dictations.set(record.id, structuredClone(record));
  }

  async getDictation(id: string): Promise<DictationRecord | null> {
    const item = this.dictations.get(id);
    return item ? structuredClone(item) : null;
  }

  async setFinalUserText(id: string, finalUserText: string): Promise<void> {
    const item = this.dictations.get(id);
    if (!item) return;
    item.finalUserText = finalUserText;
    item.updatedAt = new Date().toISOString();
  }

  async listVocabulary(userId: string): Promise<VocabularyEntry[]> {
    return [...this.vocabulary.values()]
      .filter((item) => item.userId === userId)
      .sort((a, b) => (b.frequency - a.frequency) || (b.confidence - a.confidence))
      .map((item) => structuredClone(item));
  }

  async upsertVocabulary(input: {
    userId: string;
    canonical: string;
    aliases?: string[];
    source: 'manual' | 'auto';
    confidence?: number;
  }): Promise<VocabularyEntry> {
    const canonical = input.canonical.trim();
    const existing = [...this.vocabulary.values()].find(
      (item) => item.userId === input.userId && item.canonical.toLowerCase() === canonical.toLowerCase()
    );
    const now = new Date().toISOString();
    const aliases = [...new Set((input.aliases || []).map((v) => v.trim()).filter(Boolean))];

    if (existing) {
      existing.aliases = [...new Set([...existing.aliases, ...aliases])];
      existing.frequency += 1;
      existing.confidence = Math.max(existing.confidence, input.confidence ?? existing.confidence);
      if (input.source === 'manual') existing.source = 'manual';
      existing.updatedAt = now;
      return structuredClone(existing);
    }

    const created: VocabularyEntry = {
      id: randomUUID(),
      userId: input.userId,
      canonical,
      aliases,
      confidence: input.confidence ?? (input.source === 'manual' ? 1 : 0.85),
      frequency: 1,
      source: input.source,
      createdAt: now,
      updatedAt: now
    };
    this.vocabulary.set(created.id, created);
    return structuredClone(created);
  }

  async deleteVocabulary(userId: string, id: string): Promise<boolean> {
    const entry = this.vocabulary.get(id);
    if (!entry || entry.userId !== userId) return false;
    return this.vocabulary.delete(id);
  }

  async addCorrections(records: CorrectionRecord[]): Promise<void> {
    this.corrections.push(...records.map((record) => structuredClone(record)));
  }

  async listRecentCorrections(userId: string, limit = 100): Promise<CorrectionRecord[]> {
    return this.corrections
      .filter((item) => item.userId === userId)
      .slice(-limit)
      .reverse()
      .map((item) => structuredClone(item));
  }

  async getStyleProfile(userId: string): Promise<StyleProfile | null> {
    const item = this.styles.get(userId);
    return item ? structuredClone(item) : null;
  }

  async saveStyleProfile(profile: StyleProfile): Promise<void> {
    this.styles.set(profile.userId, structuredClone(profile));
  }
}
