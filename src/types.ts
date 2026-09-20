export type ContextType = 'ai_prompt' | 'message' | 'email' | 'document' | 'other';
export interface DictationContext { type?: ContextType; app?: string; projectId?: string; surroundingText?: string; selectedText?: string }
export interface SttWord { text: string; start: number; end: number; confidence?: number }
export interface SttResult { text: string; language?: string; duration?: number; words?: SttWord[] }
export interface VocabularyEntry {
  id: string; userId: string; canonical: string; aliases: string[]; scope: string;
  confidence: number; frequency: number; source: 'manual' | 'auto';
  status: 'candidate' | 'active' | 'blocked'; createdAt: string; updatedAt: string;
}
export type CorrectionType = 'TERM_CORRECTION' | 'ASR_CORRECTION' | 'SPELLING' | 'GRAMMAR' | 'PUNCTUATION' | 'FORMAT' | 'STYLE' | 'SELF_CORRECTION_FIX' | 'CONTENT_ADDITION' | 'CONTENT_REMOVAL' | 'MEANING_CHANGE' | 'UNKNOWN';
export interface CorrectionRecord {
  id: string; userId: string; dictationId: string; scope: string; before: string; after: string;
  type: CorrectionType; confidence: number; learn: boolean; reason?: string; createdAt: string;
}
export interface StyleProfile {
  userId: string; scope: string; verbosity: number; formality: number; bulletPreference: number;
  observations: number; updatedAt: string;
}
export interface FeedbackReceipt {
  eventId: string; fingerprint: string; status: 'learned' | 'no_change' | 'skipped';
  reason?: string; learnedVocabulary: string[]; candidateVocabulary: string[];
  corrections: CorrectionRecord[]; postEditCost: number | null; createdAt: string;
}
export interface DictationRecord {
  id: string; userId: string; rawTranscript: string; outputText: string; outputHash: string;
  requestKey?: string; requestHash?: string; language?: string; duration?: number;
  context?: DictationContext; appliedTerms: string[]; transformations: string[];
  guardStatus: 'safe' | 'repaired' | 'fallback' | 'disabled'; feedback?: FeedbackReceipt;
  meta: Record<string, unknown>; createdAt: string; updatedAt: string;
}
export interface RewriteResult { text: string; appliedTerms: string[]; transformations: string[]; guardStatus: DictationRecord['guardStatus'] }
export interface UpsertVocabulary {
  userId: string; canonical: string; aliases?: string[]; scope?: string;
  source: 'manual' | 'auto'; confidence?: number; activate?: boolean;
}
