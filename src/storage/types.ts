import type { CorrectionRecord, DictationRecord, StyleProfile, VocabularyEntry } from '../types.js';

export interface Storage {
  createDictation(record: DictationRecord): Promise<void>;
  getDictation(id: string): Promise<DictationRecord | null>;
  setFinalUserText(id: string, finalUserText: string): Promise<void>;

  listVocabulary(userId: string): Promise<VocabularyEntry[]>;
  upsertVocabulary(input: {
    userId: string;
    canonical: string;
    aliases?: string[];
    source: 'manual' | 'auto';
    confidence?: number;
  }): Promise<VocabularyEntry>;
  deleteVocabulary(userId: string, id: string): Promise<boolean>;

  addCorrections(records: CorrectionRecord[]): Promise<void>;
  listRecentCorrections(userId: string, limit?: number): Promise<CorrectionRecord[]>;

  getStyleProfile(userId: string): Promise<StyleProfile | null>;
  saveStyleProfile(profile: StyleProfile): Promise<void>;
  close?(): Promise<void>;
}
